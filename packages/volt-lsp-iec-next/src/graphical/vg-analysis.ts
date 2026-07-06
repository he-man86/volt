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
 * aren't factored into per-pair helpers yet; adding them is a follow-on. `vg-undeclared-identifier` waits
 * on the library/device catalogs (like ST's unresolved check) to stay false-positive-free.
 */
import { unitBodies, isGraphicalBody, walkStatements, type Expr } from "../syntax/index.js"
import { assignmentPairError, SOURCE, type DiagnosticItem, type Messages } from "../analysis/index.js"
import type { Scope } from "../symbols/index.js"
import type { Document } from "../services/index.js"
import { analyzeVgBody } from "./vg-analyze.js"
import type { VgStatement } from "./text/ast.js"

export function computeVgDiagnostics(doc: Document, project: Scope, messages: Messages): DiagnosticItem[] {
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
      }
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
