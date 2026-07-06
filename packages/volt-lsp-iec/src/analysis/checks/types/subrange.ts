/**
 * subrange-out-of-range (D.3 · types/). A scalar constant initializer outside its declared subrange
 * type's `(lo..hi)` bounds (`x : INT(0..100) := 150`). Uniquely enabled by the structured subrange node
 * (A.2) + `const-eval`. Conservative: only foldable `bigint` bounds + value are checked → zero-FP.
 *
 * NOTE: the message is PROVISIONAL (the range-bounds fixtures have no bridge recording) — locked at the
 * T.1 bridge pass, exactly like `overflow`.
 */
import { constEval } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkSubrange(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.type.kind !== "named_type" || decl.type.subrange === undefined) continue
        if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
        const lo = constEval(decl.type.subrange.lo, scope)
        const hi = constEval(decl.type.subrange.hi, scope)
        const value = constEval(decl.init, scope)
        if (typeof value !== "bigint" || typeof lo !== "bigint" || typeof hi !== "bigint") continue
        if (value >= lo && value <= hi) continue
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "subrange-out-of-range",
          message: ctx.messages.subrangeOutOfRange(value.toString(), lo.toString(), hi.toString()),
        })
      }
    }
  }
}
