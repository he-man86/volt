/**
 * const-eval — evaluate a constant `Expr` to its value (Layer C, C.3). Literals are already valued
 * in layer A; this folds unary/binary arithmetic and references to `CONSTANT` variables. Anything
 * non-constant (a plain var, a call, a member, mixed/unsupported ops) yields `undefined` — the
 * conservative signal that a consumer (subrange/array-bounds/overflow) must skip.
 *
 * Integers stay `bigint` (exact for the 64-bit types); reals are `number`.
 */
import type { Scope } from "../symbols/index.js"
import { lookup } from "../symbols/index.js"
import type { Expr, VarDecl } from "../syntax/index.js"

export type ConstValue = bigint | number | boolean | undefined

export function constEval(expr: Expr, scope: Scope): ConstValue {
  switch (expr.kind) {
    case "literal": {
      const v = expr.value
      return typeof v === "bigint" || typeof v === "number" || typeof v === "boolean" ? v : undefined
    }
    case "paren":
      return constEval(expr.inner, scope)
    case "unary":
      return foldUnary(expr.op, constEval(expr.operand, scope))
    case "binary":
      return foldBinary(expr.op, constEval(expr.left, scope), constEval(expr.right, scope))
    case "ident_expr":
      return constRef(expr.name, scope)
    default:
      // member / index / call / deref / assign — not a foldable constant.
      return undefined
  }
}

/** Fold a reference to a `CONSTANT` variable by evaluating its initializer in its owning scope. */
function constRef(name: string, scope: Scope): ConstValue {
  const found = lookup(scope, name)
  if (found === undefined || found.symbol.constant !== true) return undefined
  const init = (found.symbol.ast as VarDecl).init
  // A scalar initializer is an Expr; an AggregateInit is not a constant scalar.
  if (init === undefined || init.kind === "aggregate_init") return undefined
  return constEval(init, found.symbol.owner)
}

function foldUnary(op: string, v: ConstValue): ConstValue {
  if (v === undefined) return undefined
  if (op === "-") {
    if (typeof v === "bigint") return -v
    if (typeof v === "number") return -v
  }
  if (op === "+") return typeof v === "boolean" ? undefined : v
  if (op === "NOT" && typeof v === "boolean") return !v
  return undefined // NOT on an integer is width-dependent bitwise — skip
}

function foldBinary(op: string, l: ConstValue, r: ConstValue): ConstValue {
  if (l === undefined || r === undefined) return undefined
  if (typeof l === "boolean" && typeof r === "boolean") return foldBool(op, l, r)
  if (typeof l === "boolean" || typeof r === "boolean") return undefined
  // Numeric: keep bigint arithmetic exact when BOTH are bigint; otherwise fold as number.
  if (typeof l === "bigint" && typeof r === "bigint") return foldBigInt(op, l, r)
  return foldNumber(op, Number(l), Number(r))
}

function foldBool(op: string, l: boolean, r: boolean): ConstValue {
  switch (op) {
    case "AND":
    case "AND_THEN":
    case "&":
      return l && r
    case "OR":
    case "OR_ELSE":
      return l || r
    case "XOR":
      return l !== r
    case "=":
      return l === r
    case "<>":
      return l !== r
    default:
      return undefined
  }
}

function foldBigInt(op: string, l: bigint, r: bigint): ConstValue {
  switch (op) {
    case "+":
      return l + r
    case "-":
      return l - r
    case "*":
      return l * r
    case "/":
      return r === 0n ? undefined : l / r
    case "MOD":
      return r === 0n ? undefined : l % r
    case "**":
      return r < 0n ? undefined : l ** r
    default:
      return foldCompare(op, l, r)
  }
}

function foldNumber(op: string, l: number, r: number): ConstValue {
  switch (op) {
    case "+":
      return l + r
    case "-":
      return l - r
    case "*":
      return l * r
    case "/":
      return r === 0 ? undefined : l / r
    case "MOD":
      return r === 0 ? undefined : l % r
    case "**":
      return l ** r
    default:
      return foldCompare(op, l, r)
  }
}

function foldCompare(op: string, l: bigint | number, r: bigint | number): ConstValue {
  switch (op) {
    case "<":
      return l < r
    case ">":
      return l > r
    case "<=":
      return l <= r
    case ">=":
      return l >= r
    case "=":
      return l === r
    case "<>":
      return l !== r
    default:
      return undefined
  }
}
