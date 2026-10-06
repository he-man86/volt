/**
 * subrange-out-of-range (D.3 · types/). A scalar CONSTANT stored outside a subrange type's `(lo..hi)` — an initializer
 * (`x : INT(0..100) := 150`) or an assignment, to a variable or to a member (`rec.f := 20` with `f : INT(0..10)`,
 * `dt_subrange_member_assign`). The range is the Type's (`types/type` `subrange`, rule DT3): the declared type of the
 * initialized variable, the inferred type of the assigned target — an alias of a subrange is one too. Conservative: only a
 * folding `bigint` value against folded bounds is checked → zero-FP.
 *
 * Both compilers report this as a type-CONVERSION error against the subrange target — confirmed live
 * byte-identical (`Cannot convert type '200' to type 'INT (1..100)'`, note the SPACE before the paren and the
 * base type name, NOT any alias). So it reuses the shared `cannotConvert` wording, not a bespoke message.
 *
 * An ASSIGNMENT out of range is the same error, but CODESYS spells a positive lower bound typed there — `INT (INT#1..100)`
 * — where its own declaration form says `INT (1..100)`. TwinCAT says the bare form in both. That is recorded, not chosen
 * (`subrange_init_above_range` vs `subrange_assign_const_out`), so the spelling is vendor data in `messages`, not a flag here.
 */
import { walkStatements } from "../../../frontend/syntax/index.js"
import { bodies, scopeForUnit } from "../../../frontend/symbols/index.js"
import { constEval, inferExprType, renderType, resolveTypeExpr } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkSubrange(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    const scope = scopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    for (const section of unit.varSections) {
      for (const decl of section.decls) {
        if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
        const type = resolveTypeExpr(decl.type, ctx.project, 0, scope)
        const range = type.kind === "elementary" ? type.subrange : undefined
        if (range === undefined) continue
        const value = constEval(decl.init, scope)
        if (typeof value !== "bigint" || (value >= range.lower && value <= range.upper)) continue
        out.push({
          severity: "error",
          span: decl.init.span,
          source: SOURCE,
          code: "subrange-out-of-range",
          message: ctx.messages.cannotConvert(value.toString(), renderType(type, { form: "compiler" })),
        })
      }
    }
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return
      const type = inferExprType(s.target, scope, ctx.project)
      if (type.kind !== "elementary" || type.subrange === undefined) return
      const range = type.subrange
      const value = constEval(s.value, scope)
      if (typeof value !== "bigint" || (value >= range.lower && value <= range.upper)) return
      out.push({
        severity: "error",
        span: s.value.span,
        source: SOURCE,
        code: "subrange-out-of-range",
        message: ctx.messages.cannotConvert(value.toString(), ctx.messages.subrangeAssignTarget(type.name, range.lower, range.upper)),
      })
    })
  }
}
