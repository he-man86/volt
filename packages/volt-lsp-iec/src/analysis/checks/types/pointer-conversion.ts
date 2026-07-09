/**
 * pointer-conversion (C0033 · types/). A WARNING that both compilers emit when a pointer value is implicitly
 * assigned to a non-pointer (elementary) target (`dw := ptr`) — it may not be portable across 32/64-bit targets.
 *
 * Zero-FP: only a KNOWN pointer RHS into a KNOWN elementary LHS fires; pointer→pointer (the legal case) and any
 * undecidable side are skipped. It is a warning, so it never affects the error-severity corpus gate.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { inferExprType, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkPointerConversion(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const rhs = inferExprType(s.value, scope, ctx.project)
      if (rhs.kind !== "pointer") return
      const lhs = inferExprType(s.target, scope, ctx.project)
      if (lhs.kind !== "elementary") return
      out.push({
        severity: "warning",
        span: s.target.span,
        source: SOURCE,
        code: "pointer-not-convertible",
        message: ctx.messages.pointerNotConvertible(renderType(rhs), renderType(lhs)),
      })
    })
  }
}
