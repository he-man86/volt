/**
 * subrange-out-of-range (D.3 · types/). A scalar constant initializer outside its declared subrange
 * type's `(lo..hi)` bounds (`x : INT(0..100) := 150`). Uniquely enabled by the structured subrange node
 * (A.2) + `const-eval`. Conservative: only foldable `bigint` bounds + value are checked → zero-FP.
 *
 * Both compilers report this as a type-CONVERSION error against the subrange target — confirmed live
 * byte-identical (`Cannot convert type '200' to type 'INT (1..100)'`, note the SPACE before the paren and the
 * base type name, NOT any alias). So it reuses the shared `cannotConvert` wording, not a bespoke message.
 */
import { scopeForUnit } from "../../../symbols/index.js"
import { constEval } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkSubrange(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(ctx.project, unit)
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
          // The compilers render the target as `<BASE> (<lo>..<hi>)` (space before the paren, base type name).
          message: ctx.messages.cannotConvert(value.toString(), `${decl.type.name.text} (${lo}..${hi})`),
        })
      }
    }
  }
}
