/**
 * conversion-source-mismatch (D.2 · types/). A `<SRC>_TO_<DST>(arg)` call whose argument type can't
 * feed the conversion's expected SRC (e.g. `INT_TO_REAL(rReal)` → "Cannot convert type 'REAL' to
 * type 'INT'"). The source type is encoded in the function name, so no conversion catalog is needed;
 * acceptance is `compat.isAssignable(source, arg)` (the arg may widen into the source). Only a single
 * elementary-typed positional argument is checked; everything else skips (zero-FP).
 */
import { parseStatements, walkAllExprs } from "../../../syntax/index.js"
import { elementaryType, inferExprType, isAssignable, resolveNamedType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"

const CONV_NAME = /^([A-Za-z]+)_TO_[A-Za-z]+$/

export function checkConversionCalls(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue

    walkAllExprs(parsed.statements, (e) => {
      if (e.kind !== "call" || e.callee.kind !== "ident_expr") return
      const m = CONV_NAME.exec(e.callee.name)
      if (m === null) return
      const sourceName = m[1].toUpperCase()
      const sourceElem = elementaryType(sourceName)
      if (sourceElem === undefined) return // not an elementary source (e.g. TO_<DST>, enum conv) → skip
      if (e.args.length !== 1) return
      const arg = e.args[0]
      if (arg === undefined || arg.param !== undefined || arg.value === undefined) return // single positional

      const argT = inferExprType(arg.value, scope, ctx.project)
      if (argT.kind !== "elementary") return
      const sourceT = resolveNamedType(sourceName, ctx.project)
      if (isAssignable(sourceT, argT)) return // arg widens into the source → acceptable
      out.push({
        severity: "error",
        span: e.callee.span,
        source: SOURCE,
        code: "conversion-source-mismatch",
        message: ctx.messages.cannotConvert(argT.name, sourceName),
      })
    })
  }
}
