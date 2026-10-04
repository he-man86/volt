/**
 * network-text diagnostics (Layer F, F.2c) — the graphical branch of the analysis orchestrator. Two streams, both
 * lifted into the same `DiagnosticItem` the ST checks emit so the server merges them onto one
 * `PublishDiagnostics`:
 *   1. STRUCTURAL — the bridge gate's `NETWORK_*` findings (`network-text/parser`, a port of the bridge reader, which
 *      asks the POU's scope what the bridge reader asks it, and holds a wire's declared type to its producer as the
 *      reader does). Canonical form is no finding: the push writes any spelling that reads (bridge-refusal-review 2.12).
 *   2. CODE CORRECTNESS — an assign `target := value` is an assignment, so it runs the SAME assignment-type check as ST
 *      (`assignmentPairError`), against a scope where the network's `VAR_TEMP` wires are declared variables. Byte-identical
 *      wording per vendor; the corpus 0-FP gate covers it. The assignments inside EXECUTE boxes are checked too.
 *
 * Type checks mirrored for network text (all share the ST per-pair/per-node helpers so wording stays byte-identical):
 * assignment mismatch + narrowing (`checkStatements`/`checkPair`), binary-operator (`checkBinaryOps`), and
 * conversion-argument narrowing/sign-change (`checkConversionArgs`). ponytail: not every ST type check runs on
 * network text yet — the remainder is added the same way (per-node helper over `operandExprs`) as corpus cases surface.
 *
 * network-undeclared-identifier: an operand naming something declared nowhere reachable — the network-text analogue of
 * ST's unresolved-identifier, sharing its exact resolution rules (`unresolvedInExprs`), against the per-network scope
 * (POU + the network's wires). Error severity, so the corpus 0-FP gate covers it.
 */
import {
  type Expr,
  type Span,
  graphicalBodies,
  stmtExprs,
  walkExpr,
  walkStatements,
} from "../frontend/syntax/index.js"
import { inferExprType, renderType, resolveCallee } from "../frontend/types/index.js"
import { compilerExprText } from "../analysis/expr-echo.js"
import { isHole, reported } from "../analysis/hole.js"
import {
  assignmentPairError,
  narrowingPairError,
  conversionArgError,
  binaryOpError,
  unresolvedInExprs,
  unresolvedMembers,
  SOURCE,
  type DiagnosticItem,
  type Messages,
} from "../analysis/index.js"
import { extendsChain, hasUnresolvedBase, type Scope } from "../frontend/symbols/index.js"
import { analyzeNetworkText, headIsVariable, instanceFb } from "./network-analyze.js"
import { walkValues, type NetworkName, type NetworkTextNetwork, type NetworkTextStatement, type NetworkValue } from "../network-text/ast.js"
import { callReading, executeBoxes, networkValueExpr, statementExprs } from "../network-text/exprs.js"
import { SYMBOL_TO_TYPE } from "../network-text/lexer.js"
import type { Document } from "../services/shared/index.js"

export function computeNetworkTextDiagnostics(
  doc: Document,
  project: Scope,
  messages: Messages,
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const { unit, body } of graphicalBodies(doc.parseResult.units)) {
    const analysis = analyzeNetworkText(unit, body, project, doc.uri)
    for (const d of analysis.vg.diagnostics) {
      out.push({ severity: "error", span: d.span, source: SOURCE, code: d.code, message: d.message })
    }
    for (const [network, scope] of analysis.networkScopes) {
      // A DISABLED network is not compiled, so nothing inside it can be a compile error — its `???` included. The flag
      // was parsed and then read by nobody once, which made every disabled network's contents a source of false
      // positives: `ng_network_disabled` puts an undeclared name in one and CODESYS reports nothing at all.
      if (network.disabled) continue
      checkUnresolvedBoxes(network.statements, scope, project, messages, out)
      checkStatements(network.statements, scope, project, messages, out)
      checkBinaryOps(network.statements, scope, project, messages, out)
      checkConversionArgs(network.statements, scope, project, messages, out)
      checkUndeclared(network.statements, scope, project, messages, out)
      checkPins(network.statements, scope, project, messages, out)
      checkEnoWithoutEn(network.statements, scope, project, messages, out)
      checkHoles(network.statements, scope, project, messages, out) // LAST — it reads what the others found
    }

    // Labels are resolved across the WHOLE BODY, not per network — see checkLabels.
    checkLabels(analysis.vg.networks, messages, out)
  }
  return out
}

/**
 * network-undeclared-identifier + network-unknown-member: resolve every operand identifier in the network against its
 * POU+wire scope (bare names), then type-check every member access (`a.b`) against the base's type — the SAME
 * `unresolvedInExprs`/`unresolvedMembers` the ST check uses, so network text matches ST byte-for-byte.
 *
 * No word of the text reaches it as an identifier any more: an edge is `R_EDGE(x)`, a flag on `x` that reads as an
 * opaque BOOL whose operand is still resolved (`network-text/exprs`), where v1 left a trailing `RISING`/`FALLING` in
 * the operand for this check to skip by name.
 */
function checkUndeclared(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const exprs = operandExprs(statements)
  for (const ref of unresolvedInExprs(exprs, scope)) {
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "network-undeclared-identifier",
      message: messages.undefinedIdentifier(ref.name),
    })
  }
  for (const ref of unresolvedMembers(exprs, scope, project)) {
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "network-unknown-member",
      message: messages.notAMember(ref.member, ref.typeName),
    })
  }
}

/**
 * Labels and jumps, at parity with the builds census 1.15 recorded on both vendors (DIALECT N19;
 * `nwl-labels.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log`), `tc-labels-edge-names.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log`)). Both IDEs HOLD every shape below, so none is a gate
 * refusal; the build reports them, and so does the LSP — with the build's words and nothing more:
 *
 *   a JMP to a label no ENABLED network carries   error    No such label 'X' within the scope of the JMP statement
 *                                                          (TwinCAT adds a full stop)
 *   one label on two enabled networks             error    The label 'X' is a duplicate          (any case)
 *   an enabled label no enabled JMP names         warning  The label 'X' has not been referenced (once per name)
 *
 * A DISABLED network is not compiled: its label is no jump target (a jump to it is "No such label"), and a JMP inside
 * it references nothing (its label reads "not referenced"). SCOPE IS THE BODY, NOT THE NETWORK — a jump in FBD/LD
 * exists to leave its network, so a legitimate jump names a label its own network does not carry. Labels match
 * case-insensitively, as IEC names do (measured on both vendors: `JMP DONE` to `LABEL: Done` builds clean).
 *
 * The TwinCAT half used to be silent (measured 2026-07-07 on v1 text). Census 1.15 re-measured it on network text v2
 * and TwinCAT does report a missing label, so the vendor exception went with the text that produced it.
 *
 * The codes are the ST label check's (`checks/flow/jump-labels`): one compiler rule (C0116-C0118), so one slug, one
 * `Cnnnn` on the wire and one configuration switch — a label unreferenced in a ladder is the warning the project's
 * configuration says it is, exactly as in ST. (The network check had a slug of its own, `network-undefined-label`,
 * on the unmapped list; it is gone from there.)
 */
function checkLabels(networks: readonly NetworkTextNetwork[], messages: Messages, out: DiagnosticItem[]): void {
  const enabled = networks.filter((n) => !n.disabled)
  const labels = new Map<string, NetworkName>() // upper-cased name → its first enabled occurrence
  for (const n of enabled) {
    if (n.label === undefined) continue
    const key = n.label.text.toUpperCase()
    if (labels.has(key))
      out.push({ severity: "error", span: n.label.span, source: SOURCE, code: "jump-label-duplicate", message: messages.jumpLabelDuplicate(n.label.text) })
    else labels.set(key, n.label)
  }
  const referenced = new Set<string>()
  for (const n of enabled)
    for (const s of n.statements) {
      if (s.kind !== "jump") continue
      const key = s.target.text.toUpperCase()
      referenced.add(key)
      if (!labels.has(key))
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "jump-label-undefined", message: messages.jumpLabelUndefined(s.target.text) })
    }
  for (const [key, label] of labels)
    if (!referenced.has(key))
      out.push({ severity: "warning", span: label.span, source: SOURCE, code: "jump-label-unreferenced", message: messages.jumpLabelUnreferenced(label.text) })
}

/**
 * network-unknown-pin: an FB-instance box `inst(PIN := arg, …)` passing a PIN the FB doesn't declare → error
 * (both compilers reject it). Conservative to a fault (zero-FP): the check runs ONLY when the callee
 * resolves to a project FB whose ENTIRE `EXTENDS` chain is resolved — an unresolvable base (a library FB) is
 * an unknown pin set, so the whole call is skipped rather than guessed. Pins = the FB's VAR_INPUT/OUTPUT/
 * IN_OUT members + PROPERTY accessors (all bare-settable on a box), inherited members included. The message is the
 * recorded build's (conformance `cc_vg_unknown_pin`).
 *
 * Pins are checked on an FB INSTANCE only (`instanceFb`, the one answer the parser's construct check asks too): the
 * pins of an instance are its FB's, while a head that names a POU is a function or the vendor's own box.
 */
function checkPins(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of statements)
    for (const v of walkValues(s)) {
      if (v.kind !== "call") continue
      const call = callReading(v) // its own pins, whatever consumes it — `.ENO` included
      if (call?.kind !== "call") continue
      const t = instanceFb(call.callee, scope, project)
      if (t?.scope === undefined) continue // not a project FB instance → skip
      const pins = pinSet(t.scope)
      if (pins === undefined) continue // an unresolved EXTENDS base → don't guess
      for (const arg of call.args) {
        if (arg.param === undefined) continue
        if (!pins.has(arg.param.name.toLowerCase())) {
          out.push({
            severity: "error",
            span: arg.param.span,
            source: SOURCE,
            code: "network-unknown-pin",
            // Both compilers: "'<pin>' is no input of '<FB TYPE, UPPERCASED>'" (confirmed live) — the ST check's
            // `messages.noInput`, no second copy of the wording. The FB's TYPE name (t.name), not the instance expression.
            message: messages.noInput(arg.param.name, t.name.toUpperCase()),
          })
          // The compiler then looks the pin name up as an ordinary identifier, and does not find it either
          // (conformance `cc_vg_unknown_pin`).
          out.push({
            severity: "error",
            span: arg.param.span,
            source: SOURCE,
            code: "network-undeclared-identifier",
            message: messages.undefinedIdentifier(arg.param.name),
          })
        }
      }
    }
}

/**
 * network-missing-en: `.ENO` read on a box with no EN that is no FB call. The push writes the box the text describes
 * (openspec bridge-refusal-review 1.5) and CODESYS's build answers it, by the box's kind (SP21, 2026-10-04):
 *
 *   an operator box  `x := ADD(a, b).ENO;`              "… (Missing EN pin). …" (`rcc_network_eno_without_en`; N21)
 *   a FUNCTION's box `x := FUN(a, b).ENO;`              "The assignment source is incorrect."
 *                                                       (`rcc_network_eno_function_without_en`)
 *
 * The operator boxes are the bridge's `CallKind.Operator` — the infix table's types and NOT (`NetworkSpelling.KindOf`);
 * ADD is the one measured. A FUNCTION's box is a head that resolves to a declared callable (`isRealCall`, the same
 * resolution the `??? :=` rule splits on), a namespace-qualified one included. An FB call may declare ENO without EN
 * (Lenze `Dryer`, N16): there `.ENO` is the FB's own output — a box headed by a variable (`headIsVariable`, whether or
 * not its FB type resolves) or the vendor's unnamed instance `??? : TYPE(…)`, and nothing is said. Any other head (a
 * MOVE, a SEL, a name nothing declares) is unmeasured, and nothing is said either.
 *
 * The build ALSO reports an operator box's data output against the target (`Cannot convert type 'INT' to type 'BOOL'`
 * for an ADD into a BOOL): not given — an operator box has no ST reading here (`callReading`), and the shape is a known
 * divergence, niche (`rcc_network_eno_without_en`).
 */
function checkEnoWithoutEn(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of statements)
    for (const v of walkValues(s)) {
      if (v.kind !== "call" || !v.eno) continue
      if (v.pins.some((p) => p.kind === "input" && p.name?.text.toUpperCase() === "EN")) continue
      if (v.unnamedType !== undefined) continue
      if (v.headExpr === undefined || headIsVariable(v.headExpr, scope, project)) continue
      const message = isRealCall(v, scope, project)
        ? messages.assignmentSourceIncorrect()
        : OPERATOR_BOXES.has(v.head.text.toUpperCase())
          ? messages.missingEnPin()
          : undefined
      if (message !== undefined) out.push({ severity: "error", span: v.span, source: SOURCE, code: "network-missing-en", message })
    }
}

/** The bridge's `CallKind.Operator` boxes: the infix table's types (`SYMBOL_TO_TYPE`) and NOT. */
const OPERATOR_BOXES: ReadonlySet<string> = new Set([...SYMBOL_TO_TYPE.values(), "NOT"])

/**
 * An FB's settable pin names (lowercased), inherited included — or `undefined` if any EXTENDS base is
 * unresolved.
 *
 * `EN`/`ENO` are seeded because they are IMPLICIT: every box in FBD/LD carries the enable input and its
 * output, and neither is declared in the FB, so a pin set built only from declared members reports a legal
 * `inst(EN := …)` as unknown. Measured, not assumed — lenze-mid drives `EN` on four different project FBs and
 * its recorded CODESYS build has no complaint about any of them.
 */
function pinSet(fbScope: Scope): Set<string> | undefined {
  if (hasUnresolvedBase(fbScope)) return undefined // an incomplete pin set — don't guess
  const pins = new Set<string>(["en", "eno"])
  for (const s of extendsChain(fbScope))
    for (const [, syms] of s.symbols) {
      for (const sym of syms) {
        if (sym.kind === "property" || isPinSection(sym.varSection)) pins.add(sym.name.toLowerCase())
      }
    }
  return pins
}

function isPinSection(section: string | undefined): boolean {
  return section === "VAR_INPUT" || section === "VAR_OUTPUT" || section === "VAR_IN_OUT"
}

/**
 * NETWORK_UNRESOLVED_BOX: an operand of `???`, which is a COMPILE ERROR the IDE will raise — reported here at
 * the keystroke instead.
 *
 * CODESYS writes `???` into any graphical slot nobody filled: a call box whose instance was never named, a
 * coil with no target, a pin it cannot name. It is not a placeholder Volt invented and
 * not something to normalise away: it is the vendor's own marker, it reaches the workspace verbatim, and the
 * project does not build while it is there. One real project carried five, one of them an assignment TARGET
 * (`??? := ioAxis.xVirtual;`). It is also why network text has no `?` token of its own — a sigil for the
 * unconnected pin was tried and withdrawn precisely because `???` was already content.
 *
 * Read off the parse, which records the marker in every slot it can stand in — a target, an operand, a `=> ???` pin,
 * the instance of `??? : TYPE(…)` — so the slot is a fact of the tree, not something re-derived from the tokens
 * around the marker. A `???` in a TITLE, a comment or backticked text is no slot, and a statement the push refuses is
 * not read, so the build never meets its marker either.
 *
 * THE MESSAGE IS THE COMPILER'S OWN, and it depends on the SLOT. Measured live on SP21 (scripts/audit-check.ts in
 * this package):
 *
 *   operand / input pin / unnamed instance   `Expression expected instead of '?'`  (+ `Unexpected token '?'
 *                                            found`, and for an instance two more — the LSP emits the first)
 *   assignment target                        `The assignment target is not specified.`
 *
 * Every shape is pinned in `test/conformance/fixtures/graphical/network-unresolved.ts` against a recording of the
 * real compiler.
 */
function checkUnresolvedBoxes(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const found: DiagnosticItem[] = []
  const error = (span: Span, message: string): void => {
    found.push({ severity: "error", span, source: SOURCE, code: "NETWORK_UNRESOLVED_BOX", message })
  }
  // AN OPERAND MARKER GETS BOTH OF THE COMPILER'S MESSAGES, because it emits both for the one marker and both are
  // reproducible: they name the position and the token, and neither embeds anything invented. The spans differ so
  // they say WHICH is which (and so the corpus gate's no-duplicate-(range,code) rule is satisfied): the position
  // message covers `???`, the token message the `?` it choked on.
  //
  // The other positions stay a SUBSET on purpose. An unnamed INSTANCE answers with four, one of them a duplicate and
  // one spelling a placeholder (`!!!'ERROR'!!!`); a target behind an unconnected enable answers with three, two of
  // which name a temp the compiler invents (`__FB__ImpVar15`) whose number no offline check can reproduce. Emitting
  // those would be imitating parser recovery, not matching a fact.
  const operand = (span: Span): void => {
    error(span, messages.unresolvedOperand())
    error({ ...span, end: span.start + 1, endLine: span.startLine, endCol: span.startCol + 1 }, messages.unresolvedOperandToken())
  }
  for (const s of statements) {
    // A TARGET MARKER OVER A CALL IS NOT A TARGET COMPLAINT — measured, not reasoned. Four shapes were recorded on
    // live SP21 (2026-09-06) and they split cleanly on ONE thing — whether the assigned value is a real CALL:
    //
    //   `??? := a`               variable   -> "The assignment target is not specified."
    //   `??? := NOT(a)`          operator   -> the same, plus two about an implicit temp
    //   `??? := <PROGRAM>()`     void call  -> "The assignment source is incorrect."
    //   `??? := <FUNCTION:BOOL>()` valued   -> the same source answer
    //
    // So over a call the compiler answers about the SOURCE and never about the target, and the target message is one
    // it does not emit. Voidness looked like the line and is not: a `FUNCTION : BOOL` gets the same answer as a
    // `PROGRAM` (`network_unnamed_target_of_void_call` / `_of_valued_call`). Nothing is emitted in its place: one of
    // the two messages names an implicit temp whose number cannot be known, and the other belongs to an
    // assignment-source rule that does not exist yet. A missing diagnostic is a reported coverage gap; a wrong one is
    // a hard failure.
    if (s.kind === "assign" && !isRealCall(s.value, scope, project))
      for (const t of s.targets) if (t.unnamed) error(t.span, messages.unresolvedAssignTarget())
    for (const v of walkValues(s)) {
      if (v.kind === "operand" && v.unnamed) operand(v.span)
      // `??? : TYPE(…)` — the marker is the instance's name, which the compiler parses as an operand.
      if (v.kind === "call" && v.unnamedType !== undefined) operand(v.head.span)
      // AN OUTPUT PIN WIRED TO THE MARKER (`f(x, => ???)`, `f(Q => ???)`) IS NO COMPLAINT AT ALL: a box whose result
      // pin the author left unnamed. The vendor stores the operand `'???'` on the box's output slot, and CODESYS
      // compiles that without a word — lenze-mid holds four (`AHWF` network 6, `Mach1_MIDS`) and its recorded build
      // is clean. So a `=> ???` target is not visited here.
    }
  }
  out.push(...found.sort((x, y) => x.span.start - y.span.start))
}

/**
 * Whether a `??? :=` coil's value is a real CALL — see `checkUnresolvedBoxes`. The call may be consumed through its ENO
 * (`??? := f(EN := c).ENO;`): the value is the box either way, and the marker sits in the same target slot.
 * RESOLUTION IS THE TEST, and it is what separates a CALL from an OPERATOR: `NOT(a)` and `MOVE(x)` read as calls too,
 * and the compiler DOES answer about the target for those (`_behind_enable`) — they resolve to no declared callable.
 */
function isRealCall(value: NetworkValue, scope: Scope, project: Scope): boolean {
  const call = value.kind === "call" ? callReading(value) : undefined
  return call?.kind === "call" && resolveCallee(call, scope, project) !== undefined
}

/** Every ST expression the network's statements carry, EXECUTE boxes' ST included. */
function operandExprs(statements: readonly NetworkTextStatement[]): Expr[] {
  const out: Expr[] = []
  for (const s of statements) {
    out.push(...statementExprs(s))
    for (const x of executeBoxes(s)) if (x.ok) walkStatements(x.statements, (st) => out.push(...stmtExprs(st)))
  }
  return out
}

/**
 * The `target := value` pairs an assignment rule applies to: an assign's value against the target it is written to,
 * and the plain assignments inside EXECUTE boxes.
 *
 * NOT a pair: a value that is a box's OUTPUT — `x := f(…)`, `x := f(…).ENO`, an EXECUTE box — nor a box's `=> v` pin.
 * In FBD/LD such a target is a wire from a box pin, whose type is the IDE's remit (the box's declared pin type, through
 * EN/ENO), not an ST assignment; the LSP applying its assignment rule there invented errors on box wiring the editor
 * owns. Whether a value IS a box is a fact of the tree (`call`, `execute`), never a guess from its ST reading: an edge
 * is no box (`x := R_EDGE(a)` pairs as `x := <BOOL>`, its opaque reading), backticked text is an operand whatever it
 * spells, and an EXECUTE box's own lines are ST the IDE compiles as ST, `o := F(k);` included. Nor a wire's
 * definition: the vendor's Demux holds no type, so a wire is no assignment target a build checks — its producer flows
 * to its consumers, which are typed as the build types them (`network-analyze` `usesTypeOf`). Nor a value with no ST
 * reading (`PARALLEL`, a group with an empty slot): its type is no expression's.
 */
function assignmentPairs(statements: readonly NetworkTextStatement[]): Assignment[] {
  const pairs: Assignment[] = []
  for (const s of statements) {
    if (s.kind === "assign") {
      // A CHAINED assignment (`a := b S= v;`) writes ONE value to every target: each target is its own assignment to
      // type-check, but the value — and so a hole in it — is one (see `checkHoles`).
      // The value's own box is the IDE's, through `.ENO` too: `x := f(…).ENO` reads BOOL for what CONSUMES it (a
      // group, a NOT), but the assignment is still a wire from the box's pin, not an ST assignment.
      const box = s.value.kind === "call" || s.value.kind === "execute"
      const value = networkValueExpr(s.value)
      if (value !== undefined && !box) pairs.push({ targets: s.targets.flatMap((t) => (t.expr === undefined ? [] : [t.expr])), value })
    }
    for (const x of executeBoxes(s))
      if (x.ok)
        walkStatements(x.statements, (st) => {
          if (st.kind === "assign" && st.op === undefined)
            pairs.push({ targets: [st.target], value: st.value })
        })
  }
  return pairs
}

/** One value and the targets it is written to — several for a chained assignment. */
type Assignment = { readonly targets: readonly Expr[]; readonly value: Expr }

/**
 * network-unknown-source: an assignment whose SOURCE the compiler could not type carries the hole to the destination,
 * exactly as an ST assignment does (conformance `cc_vg_undeclared`, `cc_vg_unknown_member`). `analysis/hole` holds
 * the one definition of "could not type", and it reads the evidence the earlier checks left in `out` — so this runs
 * LAST, after `checkUndeclared`, for the same reason `unknown-source` is the last ST check.
 *
 * Reported once per VALUE: a chained assignment's targets share the value's one range, and a message per target put
 * one code on that range several times — which the corpus gate refuses and no build was measured to give (lenze-mid,
 * task 5.5). The destination named is the target the value is written to, the last.
 */
function checkHoles(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const seen = reported(out)
  for (const { targets, value } of assignmentPairs(statements)) {
    if (!isHole(value, scope, project, seen)) continue
    const target = targets[targets.length - 1]
    if (target === undefined) continue
    const dest = inferExprType(target, scope, project)
    if (dest.kind === "unknown") continue
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "network-unknown-source",
      message: messages.cannotConvert(messages.unknownType(compilerExprText(value)), renderType(dest)),
    })
  }
}

/** Assignment pair type-checks (assignment mismatch + narrowing), EXECUTE boxes included. */
function checkStatements(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const { targets, value } of assignmentPairs(statements))
    for (const target of targets) checkPair(target, value, scope, project, messages, out)
}

/** Run the shared per-pair rules (assignment mismatch → error, narrowing → warning) on one `target := value`. */
function checkPair(target: Expr, value: Expr, scope: Scope, project: Scope, messages: Messages, out: DiagnosticItem[]): void {
  const mismatch = assignmentPairError(target, value, scope, project, messages)
  if (mismatch !== undefined) out.push(mismatch)
  const narrowing = narrowingPairError(target, value, scope, project, messages)
  if (narrowing !== undefined) out.push(narrowing)
}

/** vg binary-operator-type-mismatch: run the shared per-node rule on every binary node in the operands. */
function checkBinaryOps(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const e of operandExprs(statements)) {
    walkExpr(e, (x) => {
      if (x.kind !== "binary") return
      const d = binaryOpError(x, scope, project, messages)
      if (d !== undefined) out.push(d)
    })
  }
}

/** vg conversion-argument narrowing/sign-change: an operand `<SRC>_TO_<DST>(arg)` implicitly converts `arg` to
 *  `<SRC>` — the SAME C0195/C0197 the ST check emits, so a graphical `UINT_TO_WORD(anINT)` operand warns exactly
 *  as textual code would. (Sink narrowing is already covered by `checkPair`; this closes the operand case.) */
function checkConversionArgs(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const e of operandExprs(statements)) {
    walkExpr(e, (x) => {
      const d = conversionArgError(x, scope, project, messages)
      if (d !== undefined) out.push(d)
    })
  }
}

