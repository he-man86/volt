/**
 * The value functions: MAX/MIN/LIMIT/SEL/MUX over their operands' meet, TRUNC, ABS, the shifts and rotates, EXPT and
 * the one-argument math.
 */

import type { Lowering } from "../lowering.js"
import type { Expr, Span } from "../../../frontend/syntax/index.js"
import {
  commonType,
  elementaryRef,
  elemOf,
  exptResultType,
  inferExprType,
  isReal,
  literalCheckType,
  promoteForRuntime,
  type Type,
  UNKNOWN,
} from "../../../frontend/types/index.js"
import type { IrBuiltinName, IrExpr } from "../../ir/index.js"
import { lowerExpr } from "../expressions/expressions.js"
import { convert, ownIntegerType } from "../values/convert.js"
import { integerFoldType } from "../values/fold.js"

/** The width an integer or bit-string expression is CHECKED in — before run-time promotion. `inferExprType` answers
 *  UNKNOWN beside an untyped literal, which takes the other operand's type when that holds it (`literalCheckType`). */
function checkedBits(lw: Lowering, e: Expr): number | undefined {
  if (e.kind === "binary") {
    const literal = (x: Expr): boolean => x.kind === "literal" && x.literalKind === "int"
    const [lit, other] = literal(e.right) && !literal(e.left) ? [e.right, e.left] : literal(e.left) && !literal(e.right) ? [e.left, e.right] : []
    if (lit !== undefined && other !== undefined) {
      const bits = checkedBits(lw, other)
      const otherType = inferExprType(other, lw.scope, lw.project)
      const litBits = elemOf(literalCheckType(lit, otherType) ?? otherType)?.bits
      return bits === undefined || litBits === undefined ? bits : Math.max(bits, litBits)
    }
  }
  const t = elemOf(inferExprType(e, lw.scope, lw.project))
  return t !== undefined && (t.family === "int" || t.family === "bitstring") ? t.bits : undefined
}

/** The one-argument math functions — same arity, same typing rule (see `builtin`). */
export const UNARY_MATH: ReadonlySet<string> = new Set(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])

/** A value function with its arity checked: TRUNC, ABS, the shifts and rotates, MUX, EXPT, the unary math, and
 *  MAX/MIN/LIMIT/SEL. */
export function lowerValueFunction(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: string, values: readonly Expr[]): IrExpr | undefined {
  if (name === "TRUNC" || name === "TRUNC_INT") {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // Toward zero — TRUNC(-2.7) is -2 — into DINT (TRUNC) or INT (TRUNC_INT). conformance `trunc_functions`.
    const type = elementaryRef(name === "TRUNC" ? "DINT" : "INT")
    return { kind: "builtin", name: "trunc", args: [arg], type, span: e.span }
  }
  if (name === "ABS") {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // Promotes like unary minus: ABS(SINT -128) is 128, ABS(INT -32768) into a DINT is 32768 and into an INT wraps
    // back to -32768; ABS of a USINT is the value itself (conformance `abs_values`, `abs_unsigned`).
    const type = promoteForRuntime(arg.type)
    return { kind: "builtin", name: "abs", args: [convert(arg, type)], type, span: e.span }
  }
  if (name === "SHL" || name === "SHR" || name === "ROL" || name === "ROR") return lowerShift(lw, e, name, values)
  if (name === "MUX") return lowerMux(lw, e, values)
  if (name === "EXPT") return lowerExpt(lw, e, values)
  if (UNARY_MATH.has(name)) {
    const arg = lowerExpr(lw, values[0]!)
    if (arg === undefined) return undefined
    // A REAL argument computes in REAL — SQRT(REAL 2.0) is float32's 1.4142135381698608 — an LREAL in LREAL, and an
    // INTEGER in LREAL: SQRT(INT 2) is 1.4142135623730951 (conformance `sqrt_precision`, `exp_log_precision`,
    // `trig_precision`).
    const type = isReal(arg.type) ? arg.type : elementaryRef("LREAL")
    const math = name.toLowerCase() as IrBuiltinName
    return { kind: "builtin", name: math, args: [convert(arg, type)], type, span: e.span }
  }
  return lowerSelection(lw, e, name, values)
}

/** SHL/SHR shift the PROMOTED value; ROL/ROR rotate in the value's own width — an expression's CHECKED width. */
function lowerShift(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: "SHL" | "SHR" | "ROL" | "ROR", values: readonly Expr[]): IrExpr | undefined {
  const value = lowerExpr(lw, values[0]!)
  const count = value === undefined ? undefined : lowerExpr(lw, values[1]!)
  if (value === undefined || count === undefined) return undefined
  // SHL/SHR shift the PROMOTED value — SHL(BYTE 1, 9) into a WORD is 512 — while ROL/ROR rotate in the value's
  // own width: ROL(BYTE 129, 1) is 3 (conformance `shift_basic`, `rotate_basic`).
  const shift = name === "SHL" || name === "SHR"
  const type = shift ? promoteForRuntime(value.type) : value.type
  const op = name.toLowerCase() as IrBuiltinName
  // AN EXPRESSION OPERAND is already promoted here — `w AND m` lowers to DINT — so its own width was lost and
  // `ROL(WORD 16#8001 AND m, 1)` rotated 32 bits (2, not 3). CODESYS rotates in the expression's CHECKED width, and the
  // promoted bits above it ride along: `ROL(BYTE 16#81 + BYTE 16#80, 1)` is 2 into a BYTE and 16#102 = 258 into a WORD
  // (conformance `rotate_of_expression`). An untyped literal beside a BYTE is a BYTE: `ROL(b + 0, 1)` rotates 8 bits.
  const checked = shift ? undefined : checkedBits(lw, values[0]!)
  const own = elemOf(value.type)?.bits
  const bits = checked !== undefined && own !== undefined && checked < own ? checked : undefined
  return { kind: "builtin", name: op, args: [convert(value, type), count], type, ...(bits === undefined ? {} : { bits }), span: e.span }
}

/** MUX(K, IN0, …): the inputs meet like MAX's — MUX(0, INT 10, REAL 2.5) is REAL 10 (conformance `mux_mixed_types`). */
function lowerMux(lw: Lowering, e: Extract<Expr, { kind: "call" }>, values: readonly Expr[]): IrExpr | undefined {
  const index = lowerExpr(lw, values[0]!)
  if (index === undefined) return undefined
  const inputs: IrExpr[] = []
  for (const v of values.slice(1)) {
    const lowered = lowerExpr(lw, v)
    if (lowered === undefined) return undefined
    inputs.push(lowered)
  }
  const type = meetOperands(lw, inputs, e.span)
  if (type === undefined) return undefined
  return { kind: "builtin", name: "mux", args: [index, ...inputs.map((i) => convert(i, type))], type, span: e.span }
}

/** EXPT(base, exponent), in the type `exptResultType` gives the pair. */
function lowerExpt(lw: Lowering, e: Extract<Expr, { kind: "call" }>, values: readonly Expr[]): IrExpr | undefined {
  const base = lowerExpr(lw, values[0]!)
  const exponent = base === undefined ? undefined : lowerExpr(lw, values[1]!)
  if (base === undefined || exponent === undefined) return undefined
  // REAL only when BOTH arguments are REAL — EXPT(REAL 2.0, REAL 0.5) is float32's √2 — and LREAL otherwise:
  // EXPT(REAL 3.0, INT 20) is 3486784401 (float32 would give 3486784512), EXPT(INT 2, REAL 0.5) and
  // EXPT(LREAL, REAL) are float64, and EXPT(INT, INT) is LREAL-typed (into an INT it does not compile).
  // conformance `expt_types`, `expt_mixed_width`.
  const type = exptResultType(base.type, exponent.type)
  return { kind: "builtin", name: "expt", args: [convert(base, type), convert(exponent, type)], type, span: e.span }
}

/** MAX / MIN / LIMIT over the operands' meet, and SEL — its selector a BOOL, the inputs met. */
function lowerSelection(lw: Lowering, e: Extract<Expr, { kind: "call" }>, name: string, values: readonly Expr[]): IrExpr | undefined {
  const selector = name === "SEL" ? lowerExpr(lw, values[0]!, elementaryRef("BOOL")) : undefined
  if (name === "SEL" && selector === undefined) return undefined
  const operands: IrExpr[] = []
  for (const v of name === "SEL" ? values.slice(1) : values) {
    const lowered = lowerExpr(lw, v)
    if (lowered === undefined) return undefined
    operands.push(lowered)
  }
  const type = meetOperands(lw, operands, e.span)
  if (type === undefined) return undefined
  // MAX / MIN / LIMIT OVER A STRING WAS REFUSED until the order was measured, and now it is: CODESYS compares two
  // STRINGs BYTE BY BYTE, UNSIGNED, with a prefix losing to what it is a prefix of. Six pairs settle it
  // (`strings/ordering.ts`, 2026-09-19), each asked of MAX, MIN and the operators at once:
  //
  //   'ab' < 'abc'      a prefix loses            '' < 'a'        the same at its limit
  //   '$FF' > 'a'       so the bytes are UNSIGNED  '$FE' < '$FF'  with no ASCII byte to hide behind
  //   'b' > 'abc'       the first byte decides, not the length
  //   'abc' = 'abc'     and MAX of two equal strings answers with the value
  //
  // MAX, MIN and `<` all agree, which is not a given — `string_compare_operators` is committed beside
  // `string_max` because an order for the function and an order for the operator need not be the same. `SEL` needs
  // no order at all: it picks an operand rather than comparing them.
  const args = operands.map((o) => convert(o, type))
  const lower = name.toLowerCase() as IrBuiltinName
  return { kind: "builtin", name: lower, args: selector === undefined ? args : [selector, ...args], type, span: e.span }
}

/** The one type a list of operands meets at — a binary operator's rule, over N operands: variables decide, a
 *  REAL constant still widens (as in `int7 / 2.0`), all-constant integers fold as LINT (ULINT past it), and the result promotes. */
export function meetOperands(lw: Lowering, operands: readonly IrExpr[], span: Span): Type | undefined {
  const variables = operands.filter((o) => o.kind !== "const")
  let type =
    variables.length > 0
      ? variables.map((o) => o.type).reduce(commonType)
      : operands.map((o) => (elemOf(o.type)?.family === "int" ? integerFoldType(operands) : o.type)).reduce(commonType)
  for (const o of operands) if (o.kind === "const" && elemOf(o.type)?.family === "real") type = commonType(type, o.type)
  // an integer constant the variables' type cannot hold meets them instead of wrapping into it (`beside`)
  if (variables.length > 0)
    for (const o of operands) {
      const own = ownIntegerType(o, promoteForRuntime(type))
      if (own !== undefined) type = commonType(promoteForRuntime(type), own)
    }
  if (type === UNKNOWN) return lw.bail("type-unknown", "the arguments have no common type", span)
  return promoteForRuntime(type)
}
