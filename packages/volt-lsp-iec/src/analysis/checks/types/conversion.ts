/**
 * conversion-source-mismatch (D.2 · types/). A `<SRC>_TO_<DST>(arg)` call whose argument type can't
 * feed the conversion's expected SRC (e.g. `INT_TO_REAL(rReal)` → "Cannot convert type 'REAL' to
 * type 'INT'"). The source type is encoded in the function name — read by `types/parseConversionName`, the one
 * conversion-name parser — so no conversion catalog is needed; acceptance is `compat.isAssignable(source, arg)` (the
 * arg may widen into the source). Only a single elementary-typed positional argument is checked; everything else skips
 * (zero-FP). Both types print as the compiler prints them: `TOD_TO_UDINT(anInt)` is "Cannot convert type 'INT' to type
 * 'TIME_OF_DAY'" (conformance `cc_conv_short_source_mismatch`).
 */
import { walkAllExprs } from "../../../syntax/index.js"
import { bodies } from "../../../symbols/index.js"
import { elementaryTypeRef, inferExprType, isAssignable, parseConversionName, renderType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkConversionCalls(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkAllExprs(statements, (e) => {
      if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
      const sourceElem = parseConversionName(e.callee.name)?.from
      if (sourceElem === undefined) return // not a conversion, or `TO_<DST>` (no explicit source) → skip
      if (e.args.length !== 1) return
      const arg = e.args[0]
      if (arg === undefined || arg.param !== undefined || arg.value === undefined) return // single positional

      const argT = inferExprType(arg.value, scope, ctx.project)
      if (argT.kind !== "elementary") return
      const sourceT = elementaryTypeRef(sourceElem)
      if (isAssignable(sourceT, argT)) return // arg widens into the source → acceptable
      out.push({
        severity: "error",
        span: e.callee.span,
        source: SOURCE,
        code: "conversion-source-mismatch",
        message: ctx.messages.cannotConvert(renderType(argT), renderType(sourceT)),
      })
    })
  }
}
