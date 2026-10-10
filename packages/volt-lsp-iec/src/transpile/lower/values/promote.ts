/**
 * THE OPERAND MEET (transpile-restructure 1.7.15) — the one type operands are computed in: a binary operator's two, an
 * N-ary builtin's (MAX, MIN, LIMIT, SEL, MUX), a FOR loop's counter and limit. THE RULES DIFFER and each context keeps its
 * own (phase 1 is output-neutral). And after the constant fold, the NARROW-ARITHMETIC rule (lean 3, `narrowPou`, below):
 *
 * - `binary`: a literal beside a variable takes the variable's (promoted) type (`beside`), an all-constant integer pair
 *   folds at full width (`integerFoldType`); the two then meet (`commonType`), refused when they do not, and the meet is
 *   promoted when the operator computes promoted (`lift`, `expressions/operators.ts` `LIFTED`). The operands come back
 *   retyped.
 * - `builtin`: the variables decide; a REAL constant still widens; all-constant integers fold as LINT (ULINT past it); an
 *   integer constant the variables' type cannot hold meets them; the result is promoted. The operands are not retyped.
 * - `for-compare`: the counter's and the limit's type when they are the same; otherwise their `commonType` PROMOTED, as a
 *   comparison computes, unrefused — the loop converts both to it.
 * - narrow: arithmetic of `T` values converted straight back into `T` computes in `T`; a comparison of two values of one
 *   type compares in it.
 */

import type { Span } from "../../../frontend/syntax/index.js"
import { commonType, elemOf, isIntegral, isReal, isSameType, promoteForRuntime, type Type, UNKNOWN } from "../../../frontend/types/index.js"
import type { IrExpr, IrPou, IrStmt } from "../../ir/index.js"
import { mapExprs } from "../../ir/walk.js"
import type { Lowering } from "../core/lowering.js"
import { beside, holdsEvery, ownIntegerType, retype, sameType, stored } from "./convert.js"
import { integerFoldType } from "./fold.js"

type MeetContext =
  | { readonly kind: "binary"; readonly lift: boolean; readonly operator: string }
  | { readonly kind: "builtin" }
  | { readonly kind: "for-compare" }

/** The type `operands` meet at in `context`, with the operands as they are computed (retyped by `binary` only) —
 *  undefined when they meet at none (reported; never for `for-compare`). */
export function meet(lw: Lowering, operands: readonly IrExpr[], context: MeetContext, span: Span): { operands: IrExpr[]; type: Type } | undefined {
  switch (context.kind) {
    case "binary":
      return binaryMeet(lw, operands[0]!, operands[1]!, context, span)
    case "builtin": {
      const type = builtinMeet(lw, operands, span)
      return type === undefined ? undefined : { operands: [...operands], type }
    }
    case "for-compare": {
      // Two types are compared PROMOTED, as an IF compares them: a UINT counter from 40000 to an INT limit of 100 runs no
      // pass, and an INT counter never exceeds a UINT limit of 40000 (`for_limit_sign_change_uint_counter_out_of_int_range`,
      // `_uint_limit_out_of_int_range`). The unpromoted common type at equal width (INT) read 40000 as -25536. One type
      // compares alike in itself and promoted (promotion keeps every value), so it is not widened.
      const [counter, limit] = [operands[0]!.type, operands[1]!.type]
      const met = commonType(counter, limit)
      return { operands: [...operands], type: isSameType(counter, limit) ? met : promoteForRuntime(met) }
    }
  }
}

/** Two operands of a binary operator: a literal beside a variable in the promoted type; an all-constant integer
 *  expression folded at full width — then their common type, promoted when the operator computes promoted. */
function binaryMeet(lw: Lowering, l: IrExpr, r: IrExpr, context: { lift: boolean; operator: string }, span: Span): { operands: IrExpr[]; type: Type } | undefined {
  let left = l
  let right = r
  // Arithmetic and comparison happen in the PROMOTED type (see `promoteForRuntime`), so a literal beside a narrow
  // variable takes that type too — else `si + 1000` would wrap the 1000 into SINT before promoting.
  const lift = context.lift ? promoteForRuntime : (t: Type): Type => t
  if (left.kind === "const" && right.kind !== "const") left = beside(left, lift(right.type))
  else if (right.kind === "const" && left.kind !== "const") right = beside(right, lift(left.type))
  else if (left.kind === "const" && right.kind === "const") {
    // An ALL-constant integer expression folds at FULL width and then converts: `i := 100 + 100` is 200 and
    // `li := 2000000000 + 2000000000` is 4000000000 (conformance `constant_arithmetic_width`). It does not take
    // the context's type either — `x : REAL := 7 / 2` is 3, not 3.5 (`all_constant_division_in_real_context`);
    // this used to retype both sides to the context. The width is LINT, or ULINT for a literal ≥ 2^63 (`integerFoldType`).
    const fold = integerFoldType([left, right])
    if (elemOf(left.type)?.family === "int") left = retype(left, fold)
    if (elemOf(right.type)?.family === "int") right = retype(right, fold)
  }
  const met = commonType(left.type, right.type)
  if (met === UNKNOWN) return lw.bail("type-unknown", `the operands of ${context.operator} have no common type`, span)
  return { operands: [left, right], type: lift(met) }
}

/** The one type a list of operands meets at — a binary operator's rule, over N operands: variables decide, a
 *  REAL constant still widens (as in `int7 / 2.0`), all-constant integers fold as LINT (ULINT past it), and the result promotes. */
function builtinMeet(lw: Lowering, operands: readonly IrExpr[], span: Span): Type | undefined {
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

// ─── the narrow-arithmetic rule (lean 3) ─────────────────────────────────────

/** The operators whose result, truncated to a narrower width, is the result in that width — truncation is a ring
 *  homomorphism over two's complement, so `(a + b) mod 2^n` is `a mod 2^n + b mod 2^n` wrapped. */
const RING: ReadonlySet<string> = new Set(["add", "sub", "mul", "and", "or", "xor"])
const COMPARISONS: ReadonlySet<string> = new Set(["eq", "ne", "lt", "le", "gt", "ge"])

/** An integer elementary type, with its width. */
function integerBits(t: Type): number | undefined {
  return isIntegral(t) && t.kind === "elementary" ? t.elem.bits : undefined
}

/**
 * `e`'s value EXACTLY, as a `t` — a value widened from `t` (or from a type `t` holds), a constant `t` holds, or MAX/MIN/
 * LIMIT of such values (it answers one of them, and a widening that keeps every value keeps their order) — or undefined.
 */
function exactAs(e: IrExpr, t: Type): IrExpr | undefined {
  if (e.kind === "const") {
    if (typeof e.value === "bigint" && integerBits(t) !== undefined) return stored(e.value, t) === e.value ? { ...e, type: t } : undefined
    // a REAL constant an f32 holds exactly (comparisons only reach here with a REAL `t`)
    return typeof e.value === "number" && real32(t) && Math.fround(e.value) === e.value ? { ...e, type: t } : undefined
  }
  if (e.kind === "convert") {
    const from = e.value.type
    if (real32(t) && real32(from) && isReal(e.type)) return e.value
    if (!holdsEvery(e.type, from) || !holdsEvery(t, from)) return undefined
    return sameType(from, t) ? e.value : { kind: "convert", value: e.value, type: t, span: e.span }
  }
  if (e.kind === "builtin" && (e.name === "max" || e.name === "min" || e.name === "limit") && integerBits(t) !== undefined) {
    const args = e.args.map((a) => exactAs(a, t))
    return args.every((a) => a !== undefined) ? { ...e, args: args as IrExpr[], type: t } : undefined
  }
  return undefined
}

/** `e` computed in `t` — congruent to `e`'s value modulo 2^bits(t) — or undefined: the ring operators and negation over
 *  such operands, ABS of an exact signed value (`|MIN|` wraps back to MIN in both widths), and the exact values. */
function ringAs(e: IrExpr, t: Type): IrExpr | undefined {
  const exact = exactAs(e, t)
  if (exact !== undefined) return exact
  const bits = integerBits(t)
  const own = integerBits(e.type)
  if (bits === undefined || own === undefined || own < bits) return undefined
  if (e.kind === "binary" && RING.has(e.op)) {
    const left = ringAs(e.left, t)
    const right = left === undefined ? undefined : ringAs(e.right, t)
    return left === undefined || right === undefined ? undefined : { ...e, left, right, type: t }
  }
  if (e.kind === "unary" && e.op === "neg") {
    const operand = ringAs(e.operand, t)
    return operand === undefined ? undefined : { ...e, operand, type: t }
  }
  if (e.kind === "builtin" && e.name === "abs" && elemOf(t)?.signed === true) {
    const arg = exactAs(e.args[0]!, t)
    return arg === undefined ? undefined : { ...e, args: [arg], type: t }
  }
  return undefined
}

/**
 * THE NARROW-ARITHMETIC RULE (lean 3, transpile-restructure 7.3.1): an add, sub, mul, neg, AND, OR, XOR, MAX, MIN, LIMIT or
 * ABS of `T` values computed promoted and converted straight back into `T` is computed in `T` — the same value, because
 * truncation is a ring homomorphism (and MAX/MIN/LIMIT answer one of their operands) — so both backends run the narrow
 * node (`self.x.wrapping_add(self.y)`, not `(self.x as i32).wrapping_add(self.y as i32) as i16`). DIV and MOD stay
 * promoted: `MIN / -1` and `MIN MOD -1` are measured in the promoted width (`arithedge_*_min_by_minus_one`), and narrow
 * they overflow; so do a shift (its count masks by the width) and a store into a WIDER type (no truncation undoes the
 * promotion). A comparison of two values of one type (or a constant it holds) compares in that type (7.3.3).
 */
function narrowed(e: IrExpr): IrExpr {
  if (e.kind === "convert") {
    const [to, from] = [integerBits(e.type), integerBits(e.value.type)]
    const inner = e.value
    if (to === undefined || from === undefined || to > from || inner.kind === "convert" || inner.kind === "const") return e
    return ringAs(inner, e.type) ?? e
  }
  if (e.kind === "binary" && COMPARISONS.has(e.op)) {
    // in the type one side was widened from — the other side's, when the first does not hold it
    for (const typed of [e.left, e.right]) {
      if (typed.kind !== "convert") continue
      const left = exactAs(e.left, typed.value.type)
      const right = left === undefined ? undefined : exactAs(e.right, typed.value.type)
      if (left !== undefined && right !== undefined) return { ...e, left, right }
    }
    return e
  }
  return e
}

/** Every body of a lowered POU with the narrow-arithmetic rule applied, bottom-up (`narrowed`) — after the constant fold
 *  (`values/fold.ts` `foldPou`), so a constant operand is the one value it folded to. */
export function narrowPou(pou: IrPou): IrPou {
  const block = (body: readonly IrStmt[]): IrStmt[] => body.map((s) => mapExprs(s, narrowed))
  return {
    ...pou,
    body: block(pou.body),
    ...(pou.init === undefined ? {} : { init: block(pou.init) }),
    layouts: pou.layouts.map((l) => (l.body === undefined ? l : { ...l, body: block(l.body) })),
    routines: pou.routines.map((r) => ({ ...r, body: block(r.body) })),
  }
}

/** A REAL (float32) type. */
const real32 = (t: Type): boolean => elemOf(t)?.family === "real" && elemOf(t)?.bits === 32
