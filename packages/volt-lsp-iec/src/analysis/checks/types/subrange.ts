/**
 * subrange-out-of-range (D.3 · types/). A scalar constant initializer outside its declared subrange
 * type's `(lo..hi)` bounds (`x : INT(0..100) := 150`). Uniquely enabled by the structured subrange node
 * (A.2) + `const-eval`. Conservative: only foldable `bigint` bounds + value are checked → zero-FP.
 *
 * Both compilers report this as a type-CONVERSION error against the subrange target — confirmed live
 * byte-identical (`Cannot convert type '200' to type 'INT (1..100)'`, note the SPACE before the paren and the
 * base type name, NOT any alias). So it reuses the shared `cannotConvert` wording, not a bespoke message.
 *
 * An ASSIGNMENT out of range is the same error, but CODESYS spells the bounds differently there — `INT (INT#1..100)`,
 * a typed LOWER bound, where its own declaration form says `INT (1..100)`. TwinCAT says the bare form in both. That is
 * recorded, not chosen (`subrange_init_above_range` vs `subrange_assign_const_out`), so the spelling is vendor data in
 * `messages`, not a flag here.
 */
import { walkStatements } from "../../../syntax/index.js"
import { bodies, lookup, scopeForUnit } from "../../../symbols/index.js"
import { constEval } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { compilerSubrangeText } from "../../messages.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

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
          message: ctx.messages.cannotConvert(value.toString(), compilerSubrangeText(decl.type.name.text, lo, hi)),
        })
      }
    }
  }
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined || s.target.kind !== "ident_expr") return
      const type = lookup(scope, s.target.name)?.symbol.typeExpr
      if (type?.kind !== "named_type" || type.subrange === undefined) return
      const lo = constEval(type.subrange.lo, scope)
      const hi = constEval(type.subrange.hi, scope)
      const value = constEval(s.value, scope)
      if (typeof value !== "bigint" || typeof lo !== "bigint" || typeof hi !== "bigint") return
      if (value >= lo && value <= hi) return
      out.push({
        severity: "error",
        span: s.value.span,
        source: SOURCE,
        code: "subrange-out-of-range",
        message: ctx.messages.cannotConvert(value.toString(), ctx.messages.subrangeAssignTarget(type.name.text, lo, hi)),
      })
    })
  }
}
