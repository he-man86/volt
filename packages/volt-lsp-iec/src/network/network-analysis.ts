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
  unitBodies,
  isGraphicalBody,
  stmtExprs,
  walkExpr,
  walkStatements,
  type BodySpan,
  type Expr,
} from "../syntax/index.js"
import { inferExprType } from "../types/index.js"
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
import type { Document } from "../services/index.js"
import { analyzeNetworkText } from "./network-analyze.js"
import type { NetworkTextNetwork, NetworkTextStatement } from "./text/ast.js"

export function computeNetworkTextDiagnostics(
  doc: Document,
  project: Scope,
  messages: Messages,
  references: WorkspaceRefs = EMPTY_WORKSPACE_REFS,
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const unit of doc.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (!isGraphicalBody(body)) continue
      const analysis = analyzeNetworkText(unit, body, project, doc.uri)
      for (const d of analysis.vg.diagnostics) {
        out.push({ severity: "error", span: d.span, source: SOURCE, code: d.code, message: d.message })
      }
      checkUnresolvedBoxes(body, out)

      for (const [network, scope] of analysis.networkScopes) {
        checkStatements(network.statements, scope, project, messages, out)
        checkBinaryOps(network.statements, scope, project, messages, out)
        checkConversionArgs(network.statements, scope, project, messages, out)
        checkUndeclared(network.statements, scope, project, references, messages, out)
        checkPins(network.statements, scope, project, out)
        checkMetadataPlacement(network, out)
      }

      // Labels are resolved across the WHOLE BODY, not per network — see checkLabels.
      checkLabels(analysis.networkScopes, out)
    }
  }
  return out
}

/**
 * Network-text operand MODIFIER words (network-text.md §Modifier words / operand grammar), lowercased. Trailing
 * `SET`/`RESET` (coil storage) + `RISING`/`FALLING` (edge) are graphical keywords the lean operand parser
 * leaves in the expression, not identifiers — so the undeclared check must skip them. (`NOT`, the leading
 * modifier, already resolves via the reference catalog's boolean operator.)
 */
const NETWORK_MODIFIER_WORDS: ReadonlySet<string> = new Set(["set", "reset", "rising", "falling"])

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
 * control to the network carrying it. The bridge writes that label as `name:` at the top of the DESTINATION
 * network's statements (from `Network.Label`, which both drivers read and write), so a legitimate forward jump
 * names a label the jumping network does not contain. Resolving per network therefore flagged every real jump and
 * accepted only a jump to a label in its own network — an infinite loop or a no-op.
 *
 * Labels + jumps are gathered through EN/ENO boxes too, since a jump inside one still reaches the body's labels.
 * ponytail: message PROVISIONAL/bridge-gated — network text has no conformance recording yet (like the NETWORK_* codes).
 */
function checkLabels(
  networkScopes: Iterable<readonly [{ statements: readonly NetworkTextStatement[] }, unknown]>,
  out: DiagnosticItem[],
): void {
  const networks = [...networkScopes].map(([network]) => network)

  const labels = new Set<string>()
  for (const network of networks) collectLabels(network.statements, labels)
  for (const network of networks) checkJumps(network.statements, labels, out)
}

function collectLabels(statements: readonly NetworkTextStatement[], labels: Set<string>): void {
  for (const s of statements) {
    if (s.kind === "label") labels.add(s.name.text.toLowerCase())
    else if (s.kind === "en_eno_if") collectLabels(s.body, labels)
  }
}

function checkJumps(statements: readonly NetworkTextStatement[], labels: ReadonlySet<string>, out: DiagnosticItem[]): void {
  for (const s of statements) {
    if (s.kind === "jump") {
      if (!labels.has(s.target.text.toLowerCase())) {
        out.push({
          severity: "error",
          span: s.target.span,
          source: SOURCE,
          code: "network-undefined-label",
          // CODESYS wording, confirmed live (label UPPERCASED). TwinCAT does NOT flag a network-text JMP to a missing
          // label at all — so the fixture is a TwinCAT KNOWN_DIVERGENCE in the conformance replay.
          message: `No such label '${s.target.text.toUpperCase()}' within the scope of the JMP statement`,
        })
      }
    } else if (s.kind === "en_eno_if") {
      checkJumps(s.body, labels, out)
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
function checkPins(statements: readonly NetworkTextStatement[], scope: Scope, project: Scope, out: DiagnosticItem[]): void {
  for (const s of statements) {
    if (s.kind === "en_eno_if") {
      checkPins(s.body, scope, project, out)
      continue
    }
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
          // Both compilers: "'<pin>' is no input of '<FB TYPE, UPPERCASED>'" (confirmed live). Use the FB's
          // TYPE name (t.name), not the instance expression.
          message: `'${arg.param.name}' is no input of '${t.name.toUpperCase()}'`,
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
 * CODESYS writes `???` into a box whose instance it could not resolve. It is not a placeholder Volt invented and
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
 * The lexer emits `?` as three separate `punct` tokens, so adjacency is checked on the spans: only `???` written
 * with nothing between the marks is the vendor's marker.
 */
function checkUnresolvedBoxes(body: BodySpan, out: DiagnosticItem[]): void {
  const toks = body.tokens
  for (let i = 0; i + 2 < toks.length; i++) {
    const [a, b, c] = [toks[i]!, toks[i + 1]!, toks[i + 2]!]
    if (a.kind !== "punct" || a.text !== "?") continue
    if (b.kind !== "punct" || b.text !== "?" || c.kind !== "punct" || c.text !== "?") continue
    if (a.span.end !== b.span.start || b.span.end !== c.span.start) continue // `? ? ?` is not `???`
    out.push({
      severity: "error",
      span: { ...a.span, end: c.span.end },
      source: SOURCE,
      code: "NETWORK_UNRESOLVED_BOX",
      message:
        "`???` marks a box whose instance the IDE could not resolve — the project will not compile until it is " +
        "replaced with a real operand.",
    })
    i += 2 // one diagnostic per marker, not three overlapping ones
  }
}

/**
 * The three placement rules for a network's LABEL and COMMENT — reported here so an engineer sees them while
 * typing rather than when the push refuses.
 *
 * A network carries exactly ONE label and ONE comment, both per-network metadata on `INetwork` (and both
 * distinct from the network's TITLE, the quoted string in the header). The text grammar admits them as ordinary
 * statements, so it accepts bodies the model cannot hold.
 *
 * **These are RELOCATIONS, not new rules** — measured 2026-09-03 and pinned by the engine's
 * `MetadataPlacementTests`: the push already refuses all three. A second label is rejected by the reader; a
 * label or comment after a statement fails the canonical-form check, because the re-emit moves it to the network
 * head and the text no longer matches. So the wording here REUSES the reader's rather than inventing a second
 * phrasing for one fact, and the messages name the round-trip consequence instead of the grammar rule: what the
 * engineer will actually see is a body that comes back different from the one they wrote.
 *
 * Severity follows the push. The duplicate is an ERROR because the reader refuses outright and one of the two
 * labels cannot exist; the misplacements are WARNINGS because the content survives — only its position does not.
 *
 * NOT reported: several `//` lines before the first statement. `Network.Comment` is multi-line, the lines are
 * joined, and the round trip is exact — a warning there would fire on correct content. The proposal called that
 * one data loss; it is not.
 */
function checkMetadataPlacement(network: NetworkTextNetwork, out: DiagnosticItem[]): void {
  let firstReal: number | undefined
  let label: { text: string } | undefined

  network.statements.forEach((stmt, i) => {
    if (stmt.kind !== "label" && stmt.kind !== "comment") {
      firstReal ??= i
      return
    }

    if (stmt.kind === "label") {
      if (label !== undefined) {
        out.push({
          severity: "error",
          span: stmt.name.span,
          source: SOURCE,
          code: "NETWORK_DUPLICATE_NAME",
          message:
            `label '${stmt.name.text}' - the network already declares the label '${label.text}'; ` +
            "a network is a single jump target",
        })
        return
      }
      label = { text: stmt.name.text }
    }

    if (firstReal === undefined) return // metadata before any statement is where it belongs

    out.push(
      stmt.kind === "label"
        ? {
            severity: "warning",
            span: stmt.span,
            source: SOURCE,
            code: "NETWORK_LABEL_NOT_FIRST",
            message:
              "a label's position is not stored - this one moves to the head of the network on the next pull, " +
              "so the pushed text and the project stop matching",
          }
        : {
            severity: "warning",
            span: stmt.span,
            source: SOURCE,
            code: "NETWORK_COMMENT_NOT_FIRST",
            message:
              "a comment's position is not stored - this one moves to the head of the network on the next pull, " +
              "so the pushed text and the project stop matching",
          },
    )
  })
}

function operandExprs(statements: readonly NetworkTextStatement[]): Expr[] {
  const out: Expr[] = []
  for (const s of statements) {
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
        out.push(...operandExprs(s.body))
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

/** Sink pair type-checks (assignment mismatch + narrowing), recursing into EN/ENO + EXECUTE boxes. */
function checkStatements(
  statements: readonly NetworkTextStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of statements) {
    if (s.kind === "sink") {
      if (s.target !== undefined && s.value !== undefined && !isBoxOutput(s.value) && !isModifierValue(s.value)) {
        checkPair(s.target, s.value, scope, project, messages, out)
      }
    } else if (s.kind === "en_eno_if") {
      checkStatements(s.body, scope, project, messages, out)
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
 * A sink value that is a bare LD coil/edge MODIFIER word (`out := RESET` = a reset coil), NOT an assigned
 * expression. The parser leaves it as a plain identifier, and it can COLLIDE with a project enum member of
 * the same name (`DEVICE_TRANSITION_STATE.RESET`), so the assignment/narrowing rules must skip it — else a
 * reset coil reads as `enum → BOOL`. (The undeclared check skips the same set.)
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
