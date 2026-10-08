/**
 * THE OPERAND MEET (transpile-restructure 1.7.15) — the one type operands are computed in: a binary operator's two, an
 * N-ary builtin's (MAX, MIN, LIMIT, SEL, MUX), a FOR loop's counter and limit. THE RULES DIFFER and each context keeps its
 * own (phase 1 is output-neutral; the narrow-arithmetic rule, lean 3, is the next one this file takes):
 *
 * - `binary`: a literal beside a variable takes the variable's (promoted) type (`beside`), an all-constant integer pair
 *   folds at full width (`integerFoldType`); the two then meet (`commonType`), refused when they do not, and the meet is
 *   promoted when the operator computes promoted (`lift`, `expressions/operators.ts` `LIFTED`). The operands come back
 *   retyped.
 * - `builtin`: the variables decide; a REAL constant still widens; all-constant integers fold as LINT (ULINT past it); an
 *   integer constant the variables' type cannot hold meets them; the result is promoted. The operands are not retyped.
 * - `for-compare`: the counter's and the limit's type when they are the same; otherwise their `commonType` PROMOTED, as a
 *   comparison computes, unrefused — the loop converts both to it.
 */

import type { Span } from "../../../frontend/syntax/index.js"
import { commonType, elemOf, isSameType, promoteForRuntime, type Type, UNKNOWN } from "../../../frontend/types/index.js"
import type { IrExpr } from "../../ir/index.js"
import type { Lowering } from "../core/lowering.js"
import { beside, ownIntegerType, retype } from "./convert.js"
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
