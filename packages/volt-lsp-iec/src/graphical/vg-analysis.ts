/**
 * VG diagnostics (Layer F, F.2c) — the graphical branch of the analysis orchestrator. Two streams, both
 * lifted into the same `DiagnosticItem` the ST checks emit so the server merges them onto one
 * `PublishDiagnostics`:
 *   1. STRUCTURAL — the LSP-ownable subset of the bridge's `VG_*` codes (parse · not-closed · duplicate
 *      network/name). The canonical/round-trip gate stays the bridge's. Vendor-neutral, PROVISIONAL text.
 *   2. CODE CORRECTNESS — a sink `target := value` is an assignment, so it runs the SAME assignment-type
 *      check as ST (`assignmentPairError`), against a scope where `LET` wires are inferred pseudo-vars.
 *      Byte-identical wording per vendor; the corpus 0-FP gate covers it. Sinks nested in EN/ENO boxes and
 *      the assignments inside EXECUTE boxes are checked too.
 *
 * ponytail: only the assignment type-check is mirrored for VG so far — narrowing/binary-operator checks
 * aren't factored into per-pair helpers yet; adding them is a follow-on.
 *
 * vg-undeclared-identifier: an operand naming something declared nowhere reachable — the VG analogue of ST's
 * unresolved-identifier, sharing its exact resolution rules (`unresolvedInExprs`), against the per-network
 * scope (POU + `LET` wires). Error severity, so the corpus 0-FP gate covers it.
 */
import {
  unitBodies,
  isGraphicalBody,
  stmtExprs,
  walkExpr,
  walkStatements,
  type Expr,
} from "../syntax/index.js"
import { inferExprType } from "../types/index.js"
import {
  assignmentPairError,
  narrowingPairError,
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
import { analyzeVgBody } from "./vg-analyze.js"
import type { VgStatement } from "./text/ast.js"

export function computeVgDiagnostics(
  doc: Document,
  project: Scope,
  messages: Messages,
  references: WorkspaceRefs = EMPTY_WORKSPACE_REFS,
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const unit of doc.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (!isGraphicalBody(body)) continue
      const analysis = analyzeVgBody(unit, body, project, doc.uri)
      for (const d of analysis.vg.diagnostics) {
        out.push({ severity: "error", span: d.span, source: SOURCE, code: d.code, message: d.message })
      }
      for (const [network, scope] of analysis.networkScopes) {
        checkStatements(network.statements, scope, project, messages, out)
        checkBinaryOps(network.statements, scope, project, messages, out)
        checkUndeclared(network.statements, scope, project, references, messages, out)
        checkLabels(network.statements, out)
        checkPins(network.statements, scope, project, out)
      }
    }
  }
  return out
}

/**
 * VG operand MODIFIER words (vg-language.md §Modifier words / operand grammar), lowercased. Trailing
 * `SET`/`RESET` (coil storage) + `RISING`/`FALLING` (edge) are graphical keywords the lean operand parser
 * leaves in the expression, not identifiers — so the undeclared check must skip them. (`NOT`, the leading
 * modifier, already resolves via the reference catalog's boolean operator.)
 */
const VG_MODIFIER_WORDS: ReadonlySet<string> = new Set(["set", "reset", "rising", "falling"])

/**
 * vg-undeclared-identifier + vg-unknown-member: resolve every operand identifier in the network against its
 * POU+wire scope (bare names), then type-check every member access (`a.b`) against the base's type — the SAME
 * `unresolvedInExprs`/`unresolvedMembers` the ST check uses, so VG matches ST byte-for-byte. Member access was
 * held pending a corpus re-harvest; the blocker was actually a binder bug (qualified_only GVL members leaking
 * into the bare namespace — the lenze `Mach1` collision), now fixed, so it ships at 0-FP.
 */
function checkUndeclared(
  statements: readonly VgStatement[],
  scope: Scope,
  project: Scope,
  references: WorkspaceRefs,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  const exprs = operandExprs(statements)
  for (const ref of unresolvedInExprs(exprs, scope, project, references)) {
    if (VG_MODIFIER_WORDS.has(ref.name.toLowerCase())) continue
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "vg-undeclared-identifier",
      message: messages.undefinedIdentifier(ref.name),
    })
  }
  for (const ref of unresolvedMembers(exprs, scope, project)) {
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "vg-unknown-member",
      message: messages.notAMember(ref.member, ref.typeName),
    })
  }
}

/**
 * vg-undefined-label: a `JMP` whose target names no `LABEL` in the same network → error. Both compilers
 * reject it. Labels + jumps are gathered across EN/ENO boxes too (a jump reaches any label in its network).
 * ponytail: message PROVISIONAL/bridge-gated — VG has no conformance recording yet (like the VG_* codes).
 */
function checkLabels(statements: readonly VgStatement[], out: DiagnosticItem[]): void {
  const labels = new Set<string>()
  collectLabels(statements, labels)
  checkJumps(statements, labels, out)
}

function collectLabels(statements: readonly VgStatement[], labels: Set<string>): void {
  for (const s of statements) {
    if (s.kind === "label") labels.add(s.name.text.toLowerCase())
    else if (s.kind === "en_eno_if") collectLabels(s.body, labels)
  }
}

function checkJumps(statements: readonly VgStatement[], labels: ReadonlySet<string>, out: DiagnosticItem[]): void {
  for (const s of statements) {
    if (s.kind === "jump") {
      if (!labels.has(s.target.text.toLowerCase())) {
        out.push({
          severity: "error",
          span: s.target.span,
          source: SOURCE,
          code: "vg-undefined-label",
          message: `Jump target '${s.target.text}' is not a label in this network`,
        })
      }
    } else if (s.kind === "en_eno_if") {
      checkJumps(s.body, labels, out)
    }
  }
}

/**
 * vg-unknown-pin: an FB-instance box `inst(PIN := arg, …)` passing a PIN the FB doesn't declare → error
 * (both compilers reject it). Conservative to a fault (zero-FP): the check runs ONLY when the callee
 * resolves to a project FB whose ENTIRE `EXTENDS` chain is resolved — an unresolvable base (a library FB) is
 * an unknown pin set, so the whole call is skipped rather than guessed. Pins = the FB's VAR_INPUT/OUTPUT/
 * IN_OUT members + PROPERTY accessors (all bare-settable on a box), inherited members included.
 * ponytail: message PROVISIONAL/bridge-gated (VG has no conformance recording yet).
 */
function checkPins(statements: readonly VgStatement[], scope: Scope, project: Scope, out: DiagnosticItem[]): void {
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
          code: "vg-unknown-pin",
          message: `'${arg.param.name}' is not a pin of '${renderCallee(s.call.callee)}'`,
        })
      }
    }
  }
}

/** An FB's settable pin names (lowercased), inherited included — or `undefined` if any EXTENDS base is unresolved. */
function pinSet(fbScope: Scope): Set<string> | undefined {
  if (hasUnresolvedBase(fbScope)) return undefined // an incomplete pin set — don't guess
  const pins = new Set<string>()
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

/** Source-like text of a box callee, for the diagnostic. */
function renderCallee(e: Expr): string {
  if (e.kind === "ident_expr") return e.name
  if (e.kind === "member") return `${renderCallee(e.base)}.${e.member.name}`
  if (e.kind === "paren") return renderCallee(e.inner)
  return "instance"
}

/** Every operand `Expr` a network carries, recursing into EN/ENO boxes and EXECUTE (inline-ST) boxes. */
function operandExprs(statements: readonly VgStatement[]): Expr[] {
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
  statements: readonly VgStatement[],
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
  return value.kind === "ident_expr" && VG_MODIFIER_WORDS.has(value.name.toLowerCase())
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
  statements: readonly VgStatement[],
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

/**
 * A value that is a function/FB box OUTPUT (`box(...)`) rather than a direct expression. In FBD/LD such a
 * sink is a graph wire from a box pin, whose type is the IDE/bridge's remit (the box's declared pin type,
 * possibly through EN/ENO), not an ST assignment — so the LSP does not apply its assignment-type rule to
 * it (avoids false positives on box wiring the graphical editor owns).
 */
function isBoxOutput(value: Expr): boolean {
  return value.kind === "call" || (value.kind === "paren" && isBoxOutput(value.inner))
}
