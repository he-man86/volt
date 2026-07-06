/**
 * binary-operator-type-mismatch (D.2 · types/):
 *   - `MOD` with a non-integer operand → "'MOD' is not defined for '<T>'" (wording per vendor),
 *   - arithmetic (+,-,*,/) mixing BOOL with a numeric → "Cannot convert type 'BOOL' to type '<T>'".
 * Thin over `infer` + `elementary`; an operand that isn't elementary skips (zero-FP).
 */
import { parseStatements, walkAllExprs, type BinaryExpr, type Expr } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"
import { inferExprType, isIntegerType, isNumericType } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { findScopeForUnit, getBody, SOURCE, type DiagnosticItem } from "../_shared.js"

const ARITH_OPS = new Set(["+", "-", "*", "/"])

export function checkBinaryOperators(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    const body = getBody(unit)
    if (body === undefined) continue
    const scope = findScopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const parsed = parseStatements(body)
    if (!parsed.ok) continue

    walkAllExprs(parsed.statements, (e) => {
      if (e.kind !== "binary") return
      if (!ARITH_OPS.has(e.op) && e.op !== "MOD") return
      const a = elemName(e.left, scope, ctx.project)
      const b = elemName(e.right, scope, ctx.project)
      if (a === undefined || b === undefined) return
      checkOperands(e, a, b, ctx, out)
    })
  }
}

function checkOperands(e: BinaryExpr, a: string, b: string, ctx: CheckContext, out: DiagnosticItem[]): void {
  if (e.op === "MOD") {
    if (isIntegerType(a) && isIntegerType(b)) return
    const bad = !isIntegerType(a) ? a : b
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "binary-op-type-mismatch",
      message: ctx.messages.modNotDefined(bad),
    })
    return
  }
  // arithmetic
  if (isNumericType(a) && isNumericType(b)) return
  if (a === "BOOL" || b === "BOOL") {
    out.push({
      severity: "error",
      span: e.span,
      source: SOURCE,
      code: "binary-op-type-mismatch",
      message: ctx.messages.cannotConvert("BOOL", a === "BOOL" ? b : a),
    })
  }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}
