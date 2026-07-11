/**
 * new-in-expression (flow/ · C0454). CODESYS forbids using a `__NEW` assignment-expression inside another
 * expression (e.g. `IF (p := __NEW(T)) = 0`) — the allocation must be its own statement, then the pointer
 * variable used. An `assign_expr` node IS the nested assignment-as-expression form (a top-level `x := v;` is a
 * separate `Assignment` statement), so any `assign_expr` whose value is a `__NEW` call is this error.
 *
 * Zero-FP: `__NEW` allocation on a bare statement (`p := __NEW(T);`) is an `Assignment`, never an `assign_expr`,
 * so it never fires. Distinct from C0509 (a chained `a := b := __NEW(...)` statement).
 */
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkNewInExpression(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e) => {
    if (e.kind !== "assign_expr") return
    const v = e.value
    if (v.kind !== "call" || v.callee.kind !== "ident_expr" || v.callee.name.toUpperCase() !== "__NEW") return
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "new-in-expression",
      message: ctx.messages.newInExpression(),
    })
  })
}
