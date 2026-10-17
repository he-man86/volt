/**
 * The network-text BOX checks (`network-analysis.ts` runs them per network): the vendor's unconnected-slot marker
 * `???`, an FB instance's pins, and what the build answers for a call box the push builds (`checkCallBoxes`).
 */
import { type NetworkEno, type NetworkTextStatement, type NetworkValue, type Span, callReading, walkValues } from "../../../frontend/syntax/index.js"
import { headIsVariable, inferExprType, instanceFb, renderType, resolveCallee } from "../../../frontend/types/index.js"
import { extendsChain, hasUnresolvedBase, isLibrarySymbol, type Scope } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import type { Messages } from "../../messages/index.js"

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
export function checkPins(
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
 * The CALL BOX checks (ld-fbd-coverage 2R.4 and its gate): what CODESYS's build answers for a box Volt's push builds from
 * the text. The push names a PROJECT FUNCTION's positional pins from its declaration and gives it its CallType
 * (`NetworkDerivation`); it has no declaration of a LIBRARY function or of a METHOD, so their positional pins stay
 * unnamed, and a box of the FB's own METHOD (no instance) gets no CallType. Each answer is recorded (`ng_m_*`, SP21):
 *
 *   project FUNCTION, pins ≠ its inputs   `y := F(v, w);` `y := F2(v);` `y := F(v, i := w);`
 *                                         "Function 'F' requires exactly 'n' inputs" — the ST check's message
 *   METHOD of an instance, a positional   `y := fbm.M(v);`  the same, of the method (CODESYS); TwinCAT "'' is no input
 *                                         of 'M'"
 *   LIBRARY function read through ENO     `LEN(t)` ⏎ `x := ENO;` "'ENO' is no component of 'LEN'" and the coil's
 *                                         "Cannot convert type 'Unknown type: 'LEN.ENO'' to type 'BOOL'" (CODESYS)
 *
 * A function's count is the ST check's (`complete`, `positionalArity`); too few counts only an input with no default
 * (one with a default is unmeasured). Any other call kind and shape is unmeasured here, and nothing is said.
 *
 * NOT SAID: the FB's own METHOD called without an instance (`y := M(k := v);`) — CODESYS answers the pushed box "The
 * assignment source is incorrect." (no CallType: the push holds no declaration of the POU's members) and TwinCAT builds it
 * (`ng_m_own_method`); niche, accepted loss (0 own-method boxes in the corpora). And a LIBRARY function's box whose value is consumed (`y := LEN(t);`) — CODESYS answers the pushed box "The
 * assignment source is incorrect." (`ng_m_library_function`), but the box the editor DRAWS builds (bakon-nano's
 * `REPLACE`/`DELETE` boxes, clean in its recorded build), and a pulled text cannot tell the two apart. The defect is
 * the push's (it builds the box without the CallType the editor gives it), not the text's — ld-fbd-coverage 2R.4 gate.
 */
export function checkCallBoxes(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of statements)
    for (const v of walkValues(s)) {
      if (v.kind === "eno") {
        enoOfALibraryFunction(s, v, scope, project, messages, out)
        continue
      }
      if (v.kind !== "call") continue
      const call = callReading(v)
      if (call?.kind !== "call") continue
      const callee = resolveCallee(call, scope, project)
      if (callee === undefined) continue
      const inputs = call.args.filter((a) => !a.output)
      const positional = inputs.filter((a) => a.param === undefined)
      const library = isLibrarySymbol(callee.sym)
      const error = (span: Span, code: string, message: string): void => {
        out.push({ severity: "error", span, source: SOURCE, code, message })
      }
      if (callee.sym.kind === "function" && callee.complete) {
        const excess = positional[callee.positionalArity] ?? (library ? undefined : inputs[callee.positionalArity])
        const required = callee.positional.filter((p) => p.inOut || callee.params.find((q) => q.name === p.name)?.hasDefault !== true).length
        if (excess !== undefined) error(excess.span, "function-argument-count", messages.functionRequiresInputs(callee.sym.name, callee.positionalArity))
        else if (!library && inputs.length < required)
          error(v.head.span, "function-argument-count", messages.functionRequiresInputs(callee.sym.name, callee.positionalArity))
        continue
      }
      if (callee.sym.kind === "method" && v.head.text.includes(".") && positional.length > 0)
        error(positional[0]!.span, "function-argument-count", messages.methodBoxPositionalPins(callee.sym.name, callee.positionalArity))
    }
}

/** `LEN(t)` ⏎ `x := ENO;` — see `checkCallBoxes`: a LIBRARY function's box with no EN, read through its ENO. */
function enoOfALibraryFunction(
  s: NetworkTextStatement,
  v: NetworkEno,
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const box = v.box
  if (box.kind !== "call" || box.en !== undefined || box.unnamedType !== undefined) return
  if (box.headExpr === undefined || headIsVariable(box.headExpr, scope, project)) return
  const call = callReading(box)
  const callee = call?.kind === "call" ? resolveCallee(call, scope, project) : undefined
  if (callee?.sym.kind !== "function" || !isLibrarySymbol(callee.sym)) return
  const member = messages.enoOfALibraryFunction(callee.sym.name)
  if (member === undefined) return
  out.push({ severity: "error", span: box.span, source: SOURCE, code: "network-missing-en", message: member })
  // the coil the ENO drives is typed against the member the build could not find (measured on a coil only)
  const target = s.kind === "assign" && s.value === v ? s.targets[s.targets.length - 1]?.expr : undefined
  if (target === undefined) return
  const to = renderType(inferExprType(target, scope, project), { form: "compiler" })
  out.push({ severity: "error", span: v.span, source: SOURCE, code: "network-missing-en", message: messages.cannotConvert(messages.unknownType(`${box.head.text}.ENO`), to) })
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
export function checkUnresolvedBoxes(
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
    // A TARGET MARKER — measured, not reasoned (live SP21; the network_unnamed_* fixtures, re-recorded 2026-10-16 on
    // the boxes 2R.3's push builds):
    //
    //   `??? := a`                         variable          -> "The assignment target is not specified."
    //   `NOT(IN := a) EN` / `??? := ENO;`  operator via ENO  -> the same, plus two about an implicit temp
    //   `P() EN go` / `??? := ENO;`        PROGRAM via ENO   -> "The assignment target is not specified."
    //   `F(a) EN` / `??? := ENO;`          FUNCTION via ENO  -> the same
    //
    // So a coil read off THOSE heads' ENO is a target complaint (`enoHeadRecorded`); an FB instance's or an EXECUTE
    // box's ENO has no recording and says nothing (gate 2R.3). (Before 2R.3 the push built the call box
    // without its output list and the build answered "The assignment source is incorrect." instead.) A coil over a
    // CALL'S OWN VALUE (`??? := P();`) has no recording, so nothing is emitted for it: a missing diagnostic is a
    // reported coverage gap; a wrong one is a hard failure. The corpora hold neither — lenze-mid's four vendor
    // drawings are unconnected output pins, `P(=> ???) EN`, which is no coil (below).
    if (s.kind === "assign" && (s.value.kind === "eno" ? enoHeadRecorded(s.value.box, scope, project) : !isRealCall(s.value, scope, project)))
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
 * Whether a `??? := ENO` coil reads a box of a RECORDED head: an operator (a call-form head resolving to no declared
 * callable, or a word), a PROGRAM or a FUNCTION. Not an FB instance (a variable head, or the vendor's unnamed
 * `??? : TYPE(…)`) and not an EXECUTE box — neither is recorded, so neither is reported.
 */
function enoHeadRecorded(box: NetworkEno["box"], scope: Scope, project: Scope): boolean {
  if (box.kind === "execute") return false
  if (box.kind !== "call") return true
  if (box.unnamedType !== undefined) return false
  return box.headExpr === undefined || !headIsVariable(box.headExpr, scope, project)
}

/**
 * Whether a `??? :=` coil's value is a real CALL's own value — see `checkUnresolvedBoxes` (an ENO read is decided
 * there, before this). RESOLUTION IS THE TEST, and it is what separates a CALL from an OPERATOR: `NOT(IN := a)` and
 * `MOVE b` read as calls too, and resolve to no declared callable.
 */
function isRealCall(value: NetworkValue, scope: Scope, project: Scope): boolean {
  const call = value.kind === "call" ? callReading(value) : undefined
  return call?.kind === "call" && resolveCallee(call, scope, project) !== undefined
}
