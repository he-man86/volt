/**
 * array-index-out-of-bounds (D.3 · types/). A CONSTANT index outside its array dimension's `lo..hi`
 * bounds (`a[5]` where `a : ARRAY[0..3] OF …`). Uniquely enabled by the structured array dims (A.1) +
 * `const-eval` + `infer`. Conservative: a variable index (non-foldable), a dynamic `ARRAY[*]` dim, or
 * non-`bigint` bounds skip → zero-FP.
 *
 * NOTE: the message is PROVISIONAL (bridge-gated), like `overflow`/`subrange`.
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { constEval, inferExprType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkArrayBounds(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "index") return
      const base = inferExprType(e.base, scope, ctx.project)
      if (base.kind !== "array") return
      e.indices.forEach((idx, dim) => {
        const d = base.dims[dim]
        if (d === undefined || d.dynamic || d.lower === undefined || d.upper === undefined) return
        const lo = constEval(d.lower, scope)
        const hi = constEval(d.upper, scope)
        const value = constEval(idx, scope)
        if (typeof value !== "bigint" || typeof lo !== "bigint" || typeof hi !== "bigint") return
        if (value >= lo && value <= hi) return
        out.push({
          severity: "error",
          span: idx.span,
          source: SOURCE,
          code: "array-index-out-of-bounds",
          message: ctx.messages.arrayIndexOutOfBounds(value.toString(), lo.toString(), hi.toString()),
        })
      })
    })
  }
}
