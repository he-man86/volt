/**
 * constant-overflow (D.2/D.3 · types/). A scalar constant initializer whose folded value falls
 * outside its declared integer type's range (`x : INT := 40000;`). Uniquely enabled by the rebuild:
 * literals are valued in layer A and `const-eval` folds const-refs/arithmetic exactly (`bigint`), so
 * the range check reads `types/elementary` ranges directly. Conservative: only a foldable `bigint`
 * against an elementary type with a range is checked; anything non-const skips → zero-FP (corpus-proven).
 *
 * NOTE: the message is PROVISIONAL — the overflow fixtures have no bridge recording yet, so it is not
 * confirmed byte-identical. The "record → mirror → replay" step (T.1 bridge pass) locks it.
 */
import { constEval, resolveTypeExpr } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkConstantOverflow(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
        const t = resolveTypeExpr(decl.type, ctx.project)
        if (t.kind !== "elementary" || t.elem.range === undefined) continue
        const value = constEval(decl.init, scope)
        if (typeof value !== "bigint") continue // non-const or non-integer → skip
        if (value >= t.elem.range.min && value <= t.elem.range.max) continue
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "constant-overflow",
          message: ctx.messages.overflow(value.toString(), t.name),
        })
      }
    }
  }
}
