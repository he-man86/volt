/**
 * indexing checks (types/) on `[]` application:
 *   C0047 indexing-non-array — `[]` on a non-indexable value (`i[1]` on an `INT`).
 *   C0048 array-index-count  — an array indexed with the wrong number of indices (`arr[1]` on `ARRAY[..,..]`).
 *   C0126 pointer-index-arity — a pointer indexed with a count other than 1 (`pt[1,2]`).
 * The compiler accepts `[]` on arrays (exactly one index per dimension) and on pointers (exactly one index).
 *
 * Zero-FP: C0047 fires only on a concrete ELEMENTARY base; C0048 on a concrete array whose dimension count
 * differs from the index count (an array-of-array has `dims.length === 1`, so `arr[i]` on it is fine); C0126 on
 * a concrete pointer base.
 */
import { inferExprType, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { forEachExpr, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkIndexing(ctx: CheckContext, out: DiagnosticItem[]): void {
  forEachExpr(ctx.parseResult, ctx.project, (e, scope) => {
    if (e.kind !== "index") return
    const base = inferExprType(e.base, scope, ctx.project)
    if (base.kind === "pointer") {
      if (e.indices.length !== 1)
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "pointer-index-arity", message: ctx.messages.pointerIndexArity(renderType(base)) }) // C0126
      return
    }
    if (base.kind === "array") {
      if (e.indices.length !== base.dims.length)
        out.push({ severity: "error", span: e.span, source: SOURCE, code: "array-index-count", message: ctx.messages.arrayIndexCount(base.dims.length) }) // C0048
      return
    }
    if (base.kind !== "elementary" || base.elem.family === "string") return
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "indexing-non-array",
      message: ctx.messages.indexingNonArray(base.name),
    })
  })
}
