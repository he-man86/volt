/**
 * conversion-source-mismatch (D.2 · types/). A `<SRC>_TO_<DST>(arg)` call whose argument type can't
 * feed the conversion's expected SRC (e.g. `INT_TO_REAL(rReal)` → "Cannot convert type 'REAL' to
 * type 'INT'"). The source type is encoded in the function name — read by `types/parseConversionName`, the one
 * conversion-name parser — so no conversion catalog is needed; acceptance is `compat.isAssignable(source, arg)` (the
 * arg may widen into the source). Only a single elementary-typed positional argument is checked; everything else skips
 * (zero-FP). Both types print as the compiler prints them: `TOD_TO_UDINT(anInt)` is "Cannot convert type 'INT' to type
 * 'TIME_OF_DAY'" (conformance `cc_conv_short_source_mismatch`).
 */
import { walkAllExprs } from "../../../frontend/syntax/index.js"
import { bodies, targetOf } from "../../../frontend/symbols/index.js"
import { conversionSides, elementaryTypeRef, inferExprType, isAssignable, parseConversionName, renderType } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { fixOf, replaceText } from "../../shared/fixes.js"

export function checkConversionCalls(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
      const sourceElem = parseConversionName(e.callee.name, targetOf(ctx.project))?.from
      if (sourceElem === undefined) return // not a conversion, or `TO_<DST>` (no explicit source) → skip
      if (e.args.length !== 1) return
      const arg = e.args[0]
      if (arg === undefined || arg.param !== undefined || arg.value === undefined) return // single positional

      const argT = inferExprType(arg.value, scope, ctx.project)
      if (argT.kind !== "elementary") return
      const sourceT = elementaryTypeRef(sourceElem)
      if (isAssignable(sourceT, argT)) return // arg widens into the source → acceptable
      // its fix: the conversion named for no source type, `TO_<DST>(…)` — what the call converts INTO stays
      // (`qf_convsrc_generic`); only a plain elementary destination, whose generic form is recorded building
      const written = ctx.source.slice(e.callee.span.start, e.callee.span.end)
      const to = conversionSides(e.callee.name)?.to
      const generic = to !== undefined && /^[A-Za-z]+$/.test(to) ? `TO_${written.slice(written.length - to.length)}` : undefined
      emit(
        out,
        e.callee.span,
        "conversion-source-mismatch",
        ctx.messages.cannotConvert(renderType(argT), renderType(sourceT)),
        "error",
        [generic === undefined ? undefined : { ...fixOf(`Change to ${generic}(…)`, [replaceText(ctx.source, e.callee.span.start, e.callee.span.end, generic)], true), fixAll: true }],
      )
    })
  }
}
