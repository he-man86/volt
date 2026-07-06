/**
 * binary-operator-type-mismatch (D.2 · types/):
 *   - `MOD` with a non-integer operand → "'MOD' is not defined for '<T>'" (wording per vendor),
 *   - arithmetic (+,-,*,/) mixing BOOL with a numeric → "Cannot convert type 'BOOL' to type '<T>'".
 * Thin over `infer` + `elementary`; an operand that isn't elementary skips (zero-FP).
 */
import { parseStatements, walkAllExprs, type BinaryExpr, type Expr } from "../../../syntax/index.js"
import type { Scope } from "../../../symbols/index.js"
import { inferExprType, isIntegerType, isNumericType } from "../../../types/index.js"
import type { Messages } from "../../messages.js"
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
      const diag = binaryOpError(e, scope, ctx.project, ctx.messages)
      if (diag !== undefined) out.push(diag)
    })
  }
}

/**
 * The binary-operator-type-mismatch diagnostic for one binary node, or undefined. The ONE home for the
 * rule — the ST body check and the VG operand check both call it. Both operands must be elementary (else
 * skip, zero-FP): `MOD` on a non-integer, or arithmetic mixing `BOOL` with a numeric.
 */
export function binaryOpError(
  e: BinaryExpr,
  scope: Scope,
  project: Scope,
  messages: Messages,
): DiagnosticItem | undefined {
  if (!ARITH_OPS.has(e.op) && e.op !== "MOD") return undefined
  const a = elemName(e.left, scope, project)
  const b = elemName(e.right, scope, project)
  if (a === undefined || b === undefined) return undefined
  if (e.op === "MOD") {
    if (isIntegerType(a) && isIntegerType(b)) return undefined
    return diag(e, messages.modNotDefined(!isIntegerType(a) ? a : b))
  }
  // arithmetic
  if (isNumericType(a) && isNumericType(b)) return undefined
  if (a === "BOOL" || b === "BOOL") return diag(e, messages.cannotConvert("BOOL", a === "BOOL" ? b : a))
  return undefined
}

function diag(e: BinaryExpr, message: string): DiagnosticItem {
  return { severity: "error", span: e.span, source: SOURCE, code: "binary-op-type-mismatch", message }
}

function elemName(expr: Expr, scope: Scope, project: Scope): string | undefined {
  const t = inferExprType(expr, scope, project)
  return t.kind === "elementary" ? t.name : undefined
}
