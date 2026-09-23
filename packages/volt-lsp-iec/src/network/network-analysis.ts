/**
 * network-text diagnostics (Layer F, F.2c) — the graphical branch of the analysis orchestrator. Two streams, both
 * lifted into the same `DiagnosticItem` the ST checks emit so the server merges them onto one
 * `PublishDiagnostics`:
 *   1. STRUCTURAL — the LSP-ownable subset of the bridge's `NETWORK_*` codes (parse · not-closed · duplicate
 *      network/name). The canonical/round-trip gate stays the bridge's. Vendor-neutral, PROVISIONAL text.
 *   2. CODE CORRECTNESS — a sink `target := value` is an assignment, so it runs the SAME assignment-type
 *      check as ST (`assignmentPairError`), against a scope where `LET` wires are inferred pseudo-vars.
 *      Byte-identical wording per vendor; the corpus 0-FP gate covers it. Sinks nested in EN/ENO boxes and
 *      the assignments inside EXECUTE boxes are checked too.
 *
 * Type checks mirrored for network text (all share the ST per-pair/per-node helpers so wording stays byte-identical):
 * assignment mismatch + sink narrowing (`checkStatements`/`checkPair`), binary-operator (`checkBinaryOps`), and
 * conversion-argument narrowing/sign-change (`checkConversionArgs`). ponytail: not every ST type check runs on
 * network text yet — the remainder is added the same way (per-node helper over `operandExprs`) as corpus cases surface.
 *
 * network-undeclared-identifier: an operand naming something declared nowhere reachable — the network-text analogue of ST's
 * unresolved-identifier, sharing its exact resolution rules (`unresolvedInExprs`), against the per-network
 * scope (POU + `LET` wires). Error severity, so the corpus 0-FP gate covers it.
 */
import {
  type BodySpan,
  type Document,
  type Expr,
  graphicalBodies,
  isTrivia,
  stmtExprs,
  walkExpr,
  walkStatements,
} from "../syntax/index.js"
import { inferExprType, renderType, resolveCallee } from "../types/index.js"
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
  type WorkspaceRefs,
} from "../analysis/index.js"
import { EMPTY_WORKSPACE_REFS } from "../analysis/index.js"
import { hasUnresolvedBase, type Scope } from "../symbols/index.js"
import { analyzeNetworkText } from "./network-analyze.js"
import { networkStatements, type NetworkTextNetwork, type NetworkTextStatement } from "../network-text/ast.js"
import { ASSIGN_OPS } from "../network-text/parser.js"

export function computeNetworkTextDiagnostics(
  doc: Document,
  project: Scope,
  messages: Messages,
  references: WorkspaceRefs = EMPTY_WORKSPACE_REFS,
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const { unit, body } of graphicalBodies(doc.parseResult.units)) {
    const analysis = analyzeNetworkText(unit, body, project, doc.uri)
    for (const d of analysis.vg.diagnostics) {
      out.push({ severity: "error", span: d.span, source: SOURCE, code: d.code, message: d.message })
    }
    // `??? := <a call that returns nothing>` — the marker sits in the TARGET slot but the compiler does not
    // answer about the target. Gathered BEFORE the marker walk, which is token-based and cannot see it.
    const voidCallTargets: { start: number; end: number }[] = []
    for (const [network, scope] of analysis.networkScopes)
      collectVoidCallTargets(network.statements, scope, project, voidCallTargets)
    checkUnresolvedBoxes(body, messages, out, voidCallTargets)

    for (const [network, scope] of analysis.networkScopes) {
      // A network's FORMAT still has to be right whether or not it is disabled — it round-trips either way — so
      // the metadata check runs first and unconditionally.
      checkMetadataPlacement(network, out)
      // …but a DISABLED network is not compiled, so nothing inside it can be a compile error. The flag was parsed
      // and then read by nobody, which made every disabled network's contents a source of false positives:
      // `ng_network_disabled` puts an undeclared name in one and CODESYS reports nothing at all.
      if (network.disabled) continue
      checkStatements(network.statements, scope, project, messages, out)
      checkBinaryOps(network.statements, scope, project, messages, out)
      checkConversionArgs(network.statements, scope, project, messages, out)
      checkUndeclared(network.statements, scope, project, references, messages, out)
      checkPins(network.statements, scope, project, messages, out)
      checkHoles(network.statements, scope, project, messages, out) // LAST — it reads what the others found
    }

    // Labels are resolved across the WHOLE BODY, not per network — see checkLabels.
    checkLabels(analysis.networkScopes, messages, out)
  }
  return out
}

/**
 * Network-text operand MODIFIER words (network-text.html#whitespace), lowercased. Trailing `RISING`/`FALLING`
 * (edge) are graphical keywords the lean operand parser leaves in the expression, not identifiers — so the
 * undeclared check must skip them. (`NOT`, the leading modifier, already resolves via the reference catalog's
 * boolean operator.)
 *
 * `set`/`reset` USED TO BE HERE, and dropping them is the point rather than a tidy-up. Coil storage is the
 * assignment operator now (`out S= v`), so those two are ordinary names again — and exempting them was never
 * free: `RESET` is a perfectly good enum member (`DEVICE_TRANSITION_STATE.RESET`), so every real use of one
 * was silently skipped by the undeclared check in order to keep a coil modifier quiet.
 */
const NETWORK_MODIFIER_WORDS: ReadonlySet<string> = new Set(["rising", "falling"])

/**
 * network-undeclared-identifier + network-unknown-member: resolve every operand identifier in the network against its
 * POU+wire scope (bare names), then type-check every member access (`a.b`) against the base's type — the SAME
 * `unresolvedInExprs`/`unresolvedMembers` the ST check uses, so network text matches ST byte-for-byte. Member access was
 * held pending a corpus re-harvest; the blocker was actually a binder bug (qualified_only GVL members leaking
 * into the bare namespace — the lenze `Mach1` collision), now fixed, so it ships at 0-FP.
 */
function checkUndeclared(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  references: WorkspaceRefs,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const exprs = operandExprs(statements)
  for (const ref of unresolvedInExprs(exprs, scope, project, references)) {
    if (NETWORK_MODIFIER_WORDS.has(ref.name.toLowerCase())) continue
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
 * network-undefined-label: a `JMP` whose target names no `LABEL` ANYWHERE IN THE BODY → error.
 *
 * SCOPE IS THE BODY, NOT THE NETWORK — and it used to be the network, which rejected the normal case. A jump in
 * FBD/LD exists precisely to leave the current network: each network may carry one label, and `JMP name` transfers
 * control to the network carrying it. The bridge writes that label on the DESTINATION network's header
 * (`LABEL:`, from `Network.Label`, which both drivers read and write), so a legitimate forward jump names a
 * label the jumping network does not carry. Resolving per network therefore flagged every real jump and
 * accepted only a jump to a label in its own network — an infinite loop or a no-op.
 *
 * Jumps are gathered through EN/ENO boxes too, since one inside a branch still reaches the body's labels.
 * ponytail: message PROVISIONAL/bridge-gated — network text has no conformance recording yet (like the NETWORK_* codes).
 */
function checkLabels(
  networkScopes: Iterable<readonly [NetworkTextNetwork, unknown]>,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const networks = [...networkScopes].map(([network]) => network)

  // A label is a property of the network (`NETWORK 0 LD LABEL: skipRest`), so the jump targets are the
  // networks' own labels — no statement walk, and no way for one to hide inside an EN/ENO branch.
  const labels = new Set<string>()
  for (const network of networks) if (network.label !== undefined) labels.add(network.label.toLowerCase())
  for (const network of networks) checkJumps(network.statements, labels, messages, out)
}

function checkJumps(
  statements: readonly NetworkTextStatement[],
  labels: ReadonlySet<string>,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of networkStatements(statements)) {
    if (s.kind === "jump") {
      // CODESYS reports it (label UPPERCASED); TwinCAT does not flag a network-text JMP to a missing label at all, so the
      // message is undefined there. This hard-coded the CODESYS text for both vendors — a TwinCAT false positive the
      // replay hid as a "known divergence" (consolidate-lsp-structure A7).
      const message = labels.has(s.target.text.toLowerCase()) ? undefined : messages.networkJumpLabelUndefined(s.target.text)
      if (message !== undefined)
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "network-undefined-label", message })
    }
  }
}

/**
 * network-unknown-pin: an FB-instance box `inst(PIN := arg, …)` passing a PIN the FB doesn't declare → error
 * (both compilers reject it). Conservative to a fault (zero-FP): the check runs ONLY when the callee
 * resolves to a project FB whose ENTIRE `EXTENDS` chain is resolved — an unresolvable base (a library FB) is
 * an unknown pin set, so the whole call is skipped rather than guessed. Pins = the FB's VAR_INPUT/OUTPUT/
 * IN_OUT members + PROPERTY accessors (all bare-settable on a box), inherited members included.
 * ponytail: message PROVISIONAL/bridge-gated (network text has no conformance recording yet).
 */
function checkPins(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of networkStatements(statements)) {
    if (s.kind !== "fb_call" || s.call?.kind !== "call") continue
    const t = inferExprType(s.call.callee, scope, project)
    if (t.kind !== "function_block" || t.scope === undefined) continue // not a project FB instance → skip
    const pins = pinSet(t.scope)
    if (pins === undefined) continue // an unresolved EXTENDS base → don't guess
    for (const arg of s.call.args) {
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
  const seen = new Set<Scope>()
  let s: Scope | undefined = fbScope
  while (s !== undefined && !seen.has(s)) {
    seen.add(s)
    for (const [, syms] of s.symbols) {
      for (const sym of syms) {
        if (sym.kind === "property" || isPinSection(sym.varSection)) pins.add(sym.name.toLowerCase())
      }
    }
    s = s.baseScope
  }
  return pins
}

function isPinSection(section: string | undefined): boolean {
  return section === "VAR_INPUT" || section === "VAR_OUTPUT" || section === "VAR_IN_OUT"
}

/** Every operand `Expr` a network carries, recursing into EN/ENO boxes and EXECUTE (inline-ST) boxes. */
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
 * Walked over TOKENS rather than the parsed operands, for two reasons. The lean operand parser drops it (before
 * this, `???` produced no diagnostic at all, anywhere). And the lexer has already separated comments and string
 * literals into single tokens, so a `???` inside a network TITLE or a `//` comment is skipped for free — which a
 * text scan would have to re-derive, wrongly, at least once.
 *
 * THE MESSAGE IS THE COMPILER'S OWN, and it depends on the SLOT — which is why this check reads one token of
 * lookahead. Measured live on SP21 (scripts/audit-check.ts in this package):
 *
 *   operand / input pin / unnamed instance   `Expression expected instead of '?'`  (+ `Unexpected token '?'
 *                                            found`, and for an instance two more — the LSP emits the first)
 *   assignment target                        `The assignment target is not specified.`
 *
 * It used to emit ONE string for all of them, and that string said "a box whose instance the IDE could not
 * resolve" — which is false on an input pin and on a coil, where there is no instance at all. Every shape is
 * pinned in `test/conformance/fixtures/network-unresolved.ts` against a recording of the real compiler.
 *
 * The lexer emits `?` as three separate `punct` tokens, so adjacency is checked on the spans: only `???` written
 * with nothing between the marks is the vendor's marker.
 */
function checkUnresolvedBoxes(
  body: BodySpan,
  messages: Messages,
  out: DiagnosticItem[],
  voidCallTargets: readonly { start: number; end: number }[] = [],
): void {
  const toks = body.tokens
  for (let i = 0; i + 2 < toks.length; i++) {
    const [a, b, c] = [toks[i]!, toks[i + 1]!, toks[i + 2]!]
    if (a.kind !== "punct" || a.text !== "?") continue
    if (b.kind !== "punct" || b.text !== "?" || c.kind !== "punct" || c.text !== "?") continue
    if (a.span.end !== b.span.start || b.span.end !== c.span.start) continue // `? ? ?` is not `???`

    // WHICH SLOT the marker sits in, decided by the token that FOLLOWS it. An assignment operator there
    // means the marker is the TARGET (`??? := a;`, `??? S= a;`) and the compiler answers semantically;
    // anywhere else it is an operand and the compiler's PARSER answers instead. One token of lookahead is
    // enough because the grammar is fully parenthesised (docs/network-text.html#grammar): every operand sits
    // between two structural marks, so nothing else can follow a marker that is about to be assigned to.
    // SKIP TRIVIA to reach it: `body.tokens` carries whitespace and comments, so the token at i+3 is the
    // SPACE in `??? := a` rather than the operator. Reading it raw classified every target as an operand.
    let n = i + 3
    while (n < toks.length && isTrivia(toks[n]!.kind)) n++
    const next = toks[n]
    const isTarget = next !== undefined && ASSIGN_OPS.has(next.text)
    const marker = { ...a.span, end: c.span.end }

    // A TARGET MARKER OVER A VOID CALL IS NOT A TARGET COMPLAINT — measured, not reasoned.
    //
    // Four shapes were recorded on live SP21 (2026-09-06) and they split cleanly on ONE thing — whether the
    // assigned value is a real CALL:
    //
    //   `??? := a`               variable   -> "The assignment target is not specified."
    //   `??? := NOT(a)`          operator   -> the same, plus two about an implicit temp
    //   `??? := <PROGRAM>()`     void call  -> "The assignment source is incorrect."
    //   `??? := <FUNCTION:BOOL>()` valued   -> the same source answer
    //
    // So over a call the compiler answers about the SOURCE and never about the target, and the target message
    // is one it does not emit — a false positive. Voidness looked like the line and is not: a `FUNCTION : BOOL`
    // gets the same answer as a `PROGRAM`. This was fixed once on the narrower void-only rule and the valued
    // case then had to be measured to correct it, which is why both fixtures are committed rather than one.
    //
    // It accounts for all four of lenze-mid's divergences, and for why the recorded build reports success over
    // them: they were never errors. `Mach1_MIDS` IS live — `General.prg:29` calls it and `general` is a task
    // root — so this is not the excluded-from-build gap it was briefly taken for.
    //
    // WHY THE FIXTURE AND THE CORPUS CAN BOTH BE RIGHT, which took a while to see. CODESYS never reads network
    // text: the recorder pushes the fixture through the BRIDGE, which writes PlcOpen XML, and the compiler reads
    // that. So the fixture's answer is about the XML the bridge makes of a `???`, and lenze-mid's clean build is
    // about the XML its author actually drew — an unconnected output pin, which is legal. The two differ, and
    // that difference is a ROUND-TRIP fidelity question for `volt-cli`, not a rule this analysis can hold: the
    // marker is Volt's own word for "nothing is connected here", and flagging it would flag the vendor's drawing.
    //
    // Nothing is emitted in its place: of the compiler's two messages one names an implicit temp whose number
    // cannot be known (the same reason the instance case emits a subset), and the other belongs to an
    // assignment-source rule that does not exist yet and would have to fire for a plain `x := VoidProg()` too.
    // A missing diagnostic is a reported coverage gap; a wrong one is a hard failure.
    if (isTarget && voidCallTargets.some((sp) => marker.start >= sp.start && marker.start < sp.end)) continue

    // AN OPERAND MARKER GETS BOTH OF THE COMPILER'S MESSAGES, because it emits both for the one marker and
    // both are reproducible: they name the position and the token, and neither embeds anything invented.
    // The spans differ so they say WHICH is which (and so the corpus gate's no-duplicate-(range,code) rule
    // is satisfied): the position message covers `???`, the token message the `?` it choked on.
    //
    // The other positions stay a SUBSET on purpose. An unnamed INSTANCE answers with four, one of them a
    // duplicate and one spelling a placeholder (`!!!'ERROR'!!!`); a target behind an unconnected enable
    // answers with three, two of which name a temp the compiler invents (`__FB__ImpVar15`) whose number no
    // offline check can reproduce. Emitting those would be imitating parser recovery, not matching a fact.
    if (isTarget) {
      out.push({
        severity: "error",
        span: marker,
        source: SOURCE,
        code: "NETWORK_UNRESOLVED_BOX",
        message: messages.unresolvedAssignTarget(),
      })
    } else {
      out.push({
        severity: "error",
        span: marker,
        source: SOURCE,
        code: "NETWORK_UNRESOLVED_BOX",
        message: messages.unresolvedOperand(),
      })
      out.push({
        severity: "error",
        span: { ...a.span },
        source: SOURCE,
        code: "NETWORK_UNRESOLVED_BOX",
        message: messages.unresolvedOperandToken(),
      })
    }
    i += 2 // one diagnostic per marker, not three overlapping ones
  }
}



/**
 * The placement rule for a network's COMMENT — reported here so an engineer sees it while typing rather than
 * when the push refuses.
 *
 * A network carries exactly ONE comment, per-network metadata on `INetwork`. The text grammar admits it as an
 * ordinary statement, so it accepts bodies the model cannot hold.
 *
 * The LABEL used to be checked here too, for the same reason and with two more rules (one label per network,
 * and it must come first). Both became unrepresentable when the label moved onto the header as `LABEL:` — a
 * header field cannot appear twice or in the wrong place — so the checks went with it rather than being
 * rewritten. That is the point of moving it: the model stopped admitting the mistake.
 *
 * **These are RELOCATIONS, not new rules** — measured 2026-09-03 and pinned by the engine's
 * `MetadataPlacementTests`: the push already refuses all three. A second label is rejected by the reader; a
 * label or comment after a statement fails the canonical-form check, because the re-emit moves it to the network
 * head and the text no longer matches. So the wording here REUSES the reader's rather than inventing a second
 * phrasing for one fact, and the messages name the round-trip consequence instead of the grammar rule: what the
 * engineer will actually see is a body that comes back different from the one they wrote.
 *
 * Severity follows the push: a WARNING, because the content survives — only its position does not.
 *
 * NOT reported: several `//` lines before the first statement. `Network.Comment` is multi-line, the lines are
 * joined, and the round trip is exact — a warning there would fire on correct content. The proposal called that
 * one data loss; it is not.
 */
function checkMetadataPlacement(network: NetworkTextNetwork, out: DiagnosticItem[]): void {
  let firstReal: number | undefined

  network.statements.forEach((stmt, i) => {
    if (stmt.kind !== "comment") {
      firstReal ??= i
      return
    }
    if (firstReal === undefined) return // a comment before any statement is where it belongs

    out.push({
      severity: "warning",
      span: stmt.span,
      source: SOURCE,
      code: "NETWORK_COMMENT_NOT_FIRST",
      message:
        "a comment's position is not stored - this one moves to the head of the network on the next pull, " +
        "so the pushed text and the project stop matching",
    })
  })
}

/** Spans of `??? := <call>` sinks whose callee returns NOTHING — see the note in `checkUnresolvedBoxes`.
 *  The parser drops the marker, so such a sink is exactly one with NO target and a call for its value. */
function collectVoidCallTargets(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  out: { start: number; end: number }[],
): void {
  for (const s of networkStatements(statements)) {
    if (s.kind !== "sink" || s.target !== undefined || s.value?.kind !== "call") continue
    // RESOLUTION IS THE TEST, and it is what separates a CALL from an OPERATOR. `NOT(a)` and `MOVE(x)` parse
    // as calls too, and the compiler DOES answer about the target for those (`_behind_enable`) — they resolve
    // to no declared callable. A name that resolves to a real POU is a real call, and voidness does not enter
    // into it: measured, a `PROGRAM` and a `FUNCTION : BOOL` get the same source answer.
    if (resolveCallee(s.value, scope, project) !== undefined) out.push(s.span)
  }
}

function operandExprs(statements: readonly NetworkTextStatement[]): Expr[] {
  const out: Expr[] = []
  for (const s of networkStatements(statements)) {
    switch (s.kind) {
      case "wire_def":
        if (s.producer !== undefined) out.push(s.producer)
        break
      case "sink":
        if (s.target !== undefined) out.push(s.target)
        if (s.value !== undefined) out.push(s.value)
        break
      case "fb_call":
        if (s.call !== undefined) out.push(s.call)
        break
      case "en_eno_if":
        if (s.en !== undefined) out.push(s.en)
        break
      case "execute":
        if (s.ok) walkStatements(s.statements, (st) => out.push(...stmtExprs(st)))
        break
      case "jump":
        if (s.condition !== undefined) out.push(s.condition)
        break
      case "return":
        if (s.condition !== undefined) out.push(s.condition)
        break
    }
  }
  return out
}

/**
 * network-unknown-source: a sink whose SOURCE the compiler could not type carries the hole to the destination,
 * exactly as an ST assignment does (conformance `cc_vg_undeclared`, `cc_vg_unknown_member`). `analysis/hole` holds
 * the one definition of "could not type", and it reads the evidence the earlier checks left in `out` — so this runs
 * LAST, after `checkUndeclared`, for the same reason `unknown-source` is the last ST check.
 */
function checkHoles(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const seen = reported(out)
  const pair = (target: Expr, value: Expr): void => {
    if (!isHole(value, scope, project, seen)) return
    const dest = inferExprType(target, scope, project)
    if (dest.kind === "unknown") return
    out.push({
      severity: "error",
      span: value.span,
      source: SOURCE,
      code: "network-unknown-source",
      message: messages.cannotConvert(messages.unknownType(compilerExprText(value)), renderType(dest)),
    })
  }
  for (const s of networkStatements(statements)) {
    if (s.kind === "sink") {
      if (s.target !== undefined && s.value !== undefined && !isBoxOutput(s.value) && !isModifierValue(s.value)) pair(s.target, s.value)
    } else if (s.kind === "execute" && s.ok) {
      walkStatements(s.statements, (st) => {
        if (st.kind === "assign" && st.op === undefined && !isBoxOutput(st.value)) pair(st.target, st.value)
      })
    }
  }
}

/** Sink pair type-checks (assignment mismatch + narrowing), recursing into EN/ENO + EXECUTE boxes. */
function checkStatements(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of networkStatements(statements)) {
    if (s.kind === "sink") {
      if (s.target !== undefined && s.value !== undefined && !isBoxOutput(s.value) && !isModifierValue(s.value)) {
        checkPair(s.target, s.value, scope, project, messages, out)
      }
    } else if (s.kind === "execute" && s.ok) {
      walkStatements(s.statements, (st) => {
        if (st.kind === "assign" && st.op === undefined && !isBoxOutput(st.value)) {
          checkPair(st.target, st.value, scope, project, messages, out)
        }
      })
    }
  }
}

/**
 * A sink value that is a bare edge MODIFIER word (`out := clk RISING`), NOT an assigned expression. The parser
 * leaves it as a plain identifier, so the assignment/narrowing rules must skip it. (The undeclared check skips
 * the same set.)
 */
function isModifierValue(value: Expr): boolean {
  return value.kind === "ident_expr" && NETWORK_MODIFIER_WORDS.has(value.name.toLowerCase())
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

/**
 * A value that is a function/FB box OUTPUT (`box(...)`) rather than a direct expression. In FBD/LD such a
 * sink is a graph wire from a box pin, whose type is the IDE/bridge's remit (the box's declared pin type,
 * possibly through EN/ENO), not an ST assignment — so the LSP does not apply its assignment-type rule to
 * it (avoids false positives on box wiring the graphical editor owns).
 */
function isBoxOutput(value: Expr): boolean {
  return value.kind === "call" || (value.kind === "paren" && isBoxOutput(value.inner))
}
