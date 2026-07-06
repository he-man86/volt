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
  walkStatements,
  type Expr,
} from "../syntax/index.js"
import {
  assignmentPairError,
  unresolvedInExprs,
  SOURCE,
  type DiagnosticItem,
  type Messages,
  type WorkspaceRefs,
} from "../analysis/index.js"
import { EMPTY_WORKSPACE_REFS } from "../analysis/index.js"
import type { Scope } from "../symbols/index.js"
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
        checkUndeclared(network.statements, scope, project, references, messages, out)
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

/** vg-undeclared-identifier: resolve every operand identifier in the network against its POU+wire scope. */
function checkUndeclared(
  statements: readonly VgStatement[],
  scope: Scope,
  project: Scope,
  references: WorkspaceRefs,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const ref of unresolvedInExprs(operandExprs(statements), scope, project, references)) {
    if (VG_MODIFIER_WORDS.has(ref.name.toLowerCase())) continue
    out.push({
      severity: "error",
      span: ref.span,
      source: SOURCE,
      code: "vg-undeclared-identifier",
      message: messages.undefinedIdentifier(ref.name),
    })
  }
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

/** Sink assignment type-checks, recursing into EN/ENO boxes and EXECUTE (inline-ST) boxes. */
function checkStatements(
  statements: readonly VgStatement[],
  scope: Scope,
  project: Scope,
  messages: Messages,
  out: DiagnosticItem[],
): void {
  for (const s of statements) {
    if (s.kind === "sink") {
      if (s.target !== undefined && s.value !== undefined && !isBoxOutput(s.value)) {
        const d = assignmentPairError(s.target, s.value, scope, project, messages)
        if (d !== undefined) out.push(d)
      }
    } else if (s.kind === "en_eno_if") {
      checkStatements(s.body, scope, project, messages, out)
    } else if (s.kind === "execute" && s.ok) {
      walkStatements(s.statements, (st) => {
        if (st.kind === "assign" && st.op === undefined && !isBoxOutput(st.value)) {
          const d = assignmentPairError(st.target, st.value, scope, project, messages)
          if (d !== undefined) out.push(d)
        }
      })
    }
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
