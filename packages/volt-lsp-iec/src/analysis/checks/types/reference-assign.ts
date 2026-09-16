/**
 * reference-assign (C0140 · types/). The `REF=` reference-assignment target is not a `REFERENCE TO` variable
 * (`i REF= x`).
 *
 * Zero-FP: fires only when the target's type is KNOWN and not a reference; an unknown target is skipped.
 *
 * C0141 "RHS needs write access" (re-verified live 2026-07-21 — the earlier "literal RHS is always fine" note
 * was wrong): a `REF=` RHS must be a writable variable. A non-zero literal (`REF= 314`) or a constant (`REF= K`)
 * errors; the sole exception is the literal `0`, the null-reference idiom (`REF= 0` stays valid). We flag only a
 * RHS that classifies as `constant` and does not fold to 0, so a writable var / unknown never false-positives.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, constancyOf, constEval } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkReferenceAssign(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== "REF=") return
      const target = inferExprType(s.target, scope, ctx.project)
      if (target.kind !== "reference" && target.kind !== "unknown") {
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "reference-assign-target", message: ctx.messages.referenceAssignTarget() }) // C0140
        return
      }
      // C0141 — the RHS must be writable. `0` is the null idiom (skip); a named CONSTANT has no write access.
      // A plain LITERAL is not this error: `r REF= 7` is a type error to CODESYS, "Cannot convert type 'SINT' to type
      // 'REFERENCE TO INT'" (conformance `cc3_reference_assign`), and C0141 fired beside it as a false positive.
      if (constEval(s.value, scope) === 0n || s.value.kind === "literal") return
      if (constancyOf(s.value, scope) === "constant")
        out.push({ severity: "error", span: s.value.span, source: SOURCE, code: "reference-assign-write", message: ctx.messages.referenceAssignWriteAccess() })
    })
  }
}
