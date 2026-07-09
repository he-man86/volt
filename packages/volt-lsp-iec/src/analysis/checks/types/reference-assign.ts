/**
 * reference-assign (C0140 · types/). The `REF=` reference-assignment target is not a `REFERENCE TO` variable
 * (`i REF= x`).
 *
 * Zero-FP: fires only when the target's type is KNOWN and not a reference; an unknown target is skipped.
 * (C0141 "RHS must be writable" is NOT done — `r REF= 0` is a valid way to null a reference, so a literal RHS
 * is not an error.)
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkReferenceAssign(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== "REF=") return
      const target = inferExprType(s.target, scope, ctx.project)
      if (target.kind !== "reference" && target.kind !== "unknown")
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "reference-assign-target", message: ctx.messages.referenceAssignTarget() }) // C0140
    })
  }
}
