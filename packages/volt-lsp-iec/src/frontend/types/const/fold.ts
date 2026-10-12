/**
 * CONSTANT FOLDING — evaluate a constant `Expr` to its value, and in the same walk decide whether it is a constant at all
 * (`constancy.ts` reads that half). Literals are already valued by the parser (`syntax/literal`); this folds unary/binary
 * arithmetic, references to `CONSTANT` variables and enum values, the conversions, the pure built-ins and SIZEOF — the set
 * CODESYS folds where a constant is required (an array bound names it: "The constant index '30000' is not within the range
 * from '0' to '<fold>'", conformance `ce_fold_*`, both vendors 2026-10-03; frontend-conformance 4.6.1). Anything
 * non-constant (a plain var, a user function, an index, a dereference) yields `undefined` — the conservative signal that a
 * consumer (subrange/array-bounds/overflow) must skip.
 *
 * Integers stay `bigint` (exact for the 64-bit types); reals are `number`.
 */
import { lookupGlobal, rootOf, type Scope, type Symbol } from "../../symbols/index.js"
import { type Expr } from "../../syntax/index.js"
import { elementaryType, type ElementaryType } from "../elementary.js"
import { integerOfWidth } from "../width.js"
import { foldUnary, foldBinary } from "./operators.js"
import { literalOnly, call } from "./calls.js"
import { constRef, integerType, memberValue, symbolValue, unsignedType } from "./values.js"

export type ConstValue = bigint | number | boolean | undefined

/**
 * Whether an expression is a compile-time CONSTANT, a mutable VARIABLE, or UNDECIDABLE — the zero-FP basis for "this must
 * be a constant" checks (CASE labels C0218, array-repeat counts C0162). It answers what the value cannot: a value of
 * `undefined` is BOTH a mutable variable AND a constant this cannot fold (a library constant), so "did not fold" is not
 * "is a variable". Callers flag ONLY `variable`.
 */
export type Constancy = "constant" | "variable" | "unknown"

/**
 * A REAL expression folds WIDE and rounds ONCE, to float32, at its end — the value its runtime twin reads: `C01 : REAL :=
 * 0.1` named anywhere is 0.10000000149011612, `CBig + 1` (CBig = 2^24) is 16777216, yet `(CBig + 1) - CBig` is 1. An LREAL
 * constant initialised from a REAL one keeps the unrounded literal (`DChain : LREAL := C01` is 0.1). All LIVE, conformance
 * `real_constant_fold_width` (transpile-review-2026-09-29 task 3).
 *
 * `asConstant`: the expression is a CONSTANT's own initializer, whose value is that fold UNROUNDED — the constant is
 * substituted where it is named, so only the slot's own type rounds it (`DChain`'s slot reads 0.1).
 *
 * `declared`: the expression is the initializer of a declaration of that type — an unsigned integer or a bit string is
 * the context an untyped literal under the NOT or the shift the initializer IS takes (`FoldContext.expected`, as
 * `declaredValue` folds one): `c1 : WORD := NOT 0` is 65535, `w : WORD := ROL(129, 1)` 258 (`ce_fold_untyped_in_context_values`,
 * `tr_a30_rotate_untyped_literal_initializer`; transpile-restructure 6.A.29, 6.A.30).
 */
export function constEval(expr: Expr, scope: Scope, asConstant = false, declared?: ElementaryType): ConstValue {
  const ctx = expecting(asConstant ? { folding: new Set(), inConstant: true } : { folding: new Set() }, unsignedType(integerType(declared)))
  const { value, width } = fold(expr, scope, ctx)
  return width === 32 && !asConstant && typeof value === "number" ? Math.fround(value) : value
}

/** The constancy of `expr` — the half of the fold walk `constancy.ts` publishes. */
export function constancyIn(expr: Expr, scope: Scope): Constancy {
  return evaluate(expr, scope).constancy
}

function evaluate(expr: Expr, scope: Scope): Folded {
  return fold(expr, scope, { folding: new Set() })
}

/**
 * A folded value, its constancy and, where the walk knows it, its type: a REAL or LREAL's width, an integer's elementary
 * type (a typed literal, a conversion, a constant's declared type, an enum's storage) — what NOT and the shifts compute in.
 * An untyped literal has neither: it takes its partner's width, and an untyped integer its own narrowest type.
 */
export interface Folded {
  value: ConstValue
  constancy: Constancy
  width?: RealWidth
  elem?: ElementaryType
}
export type RealWidth = 32 | 64

export const UNKNOWN_VALUE: Folded = { value: undefined, constancy: "unknown" }
const wider = (a?: RealWidth, b?: RealWidth): RealWidth | undefined => (a === undefined ? b : b === undefined ? a : a > b ? a : b)
export function realWidth(e: ElementaryType | undefined): RealWidth | undefined {
  return e?.family !== "real" ? undefined : e.bits === 32 ? 32 : 64
}
/** Two constancies met: a variable taints, two constants stay constant, anything else is undecidable. */
function meet(a: Constancy, b: Constancy): Constancy {
  return a === "variable" || b === "variable" ? "variable" : a === "constant" && b === "constant" ? "constant" : "unknown"
}
export const meetAll = (xs: readonly Folded[]): Constancy => xs.reduce<Constancy>((c, x) => meet(c, x.constancy), "constant")

/** What a fold carries down: the constants being folded — a cycle (`X := Y; Y := X`, `P.N := P.N`) stops there instead of
 *  recursing forever, which froze the editor's diagnostics (rule CE5; CODESYS: "Recursive definition of constant value",
 *  `ce_cycle`, `ce_cycle_self`) — and the global list whose initializer is being folded. */
export interface FoldContext {
  folding: Set<Symbol>
  list?: string
  /** The integer type an untyped literal takes here — an UNSIGNED CONSTANT's declared type over the NOT or the shift its
   *  initializer IS (`NOT 0` into a WORD is 65535, `SHL(1, 20)` into a DWORD 1048576 — `ce_fold_untyped_*_in_context_values`,
   *  CODESYS 2026-10-03) — to the untyped literal directly under it. Nowhere else: through an operator, a paren, a
   *  conversion's argument, a NOT under a shift or a MIN/MAX/LIMIT/SEL/MUX argument it is unmeasured, and a SIGNED context is refused (`c3 : INT := NOT 5`, both vendors,
   *  `ce_fold_untyped_not_signed_context_values`) — there the literal has no width and NOT or a shift of it does not fold
   *  (step 4d review). Without one (an array bound, a CASE label) an untyped literal is its own narrowest type (`NOT 250`
   *  as a bound is 5, `ce_fold_not_int_untyped`). */
  expected?: ElementaryType
  /** Set by `isRecursiveConstant`: the constant whose initializer is walked, and whether the walk came back to it. */
  cycle?: { start: Symbol; hit: boolean }
  /** The fold is a CONSTANT's own initializer — a constant named in it is its held value, not its read (`read`). */
  inConstant?: boolean
}

/** The global list a symbol's initializer folds inside (its siblings seen bare first), when it is a list's. */
export const listOf = (symbol: Symbol): { list?: string } => (symbol.kind === "gvl_var" ? { list: symbol.uri } : {})

/** `ctx` with `expected` as the type an untyped literal takes — none when undefined. */
export function expecting(ctx: FoldContext, expected: ElementaryType | undefined): FoldContext {
  const { expected: _, ...rest } = ctx
  return expected === undefined ? rest : { ...rest, expected }
}

export function fold(expr: Expr, scope: Scope, ctx: FoldContext): Folded {
  switch (expr.kind) {
    case "literal":
      return literal(expr, ctx)
    // the context's type reaches only NOT and a shift written at the top of the initializer (`FoldContext.expected`)
    case "paren":
      return fold(expr.inner, scope, expecting(ctx, undefined))
    case "unary": {
      if (expr.op === "NOT") return not(fold(expr.operand, scope, literalOnly(expr.operand, ctx)))
      const operand = fold(expr.operand, scope, expecting(ctx, undefined))
      return { ...operand, value: foldUnary(expr.op, operand.value) }
    }
    case "binary": {
      const l = fold(expr.left, scope, expecting(ctx, undefined))
      const r = fold(expr.right, scope, expecting(ctx, undefined))
      const width = wider(l.width, r.width)
      const folded: Folded = { value: foldBinary(expr.op, l.value, r.value), constancy: meet(l.constancy, r.constancy) }
      return width === undefined ? folded : { ...folded, width }
    }
    case "ident_expr":
      return constRef(expr.name, scope, ctx)
    // `.Const` — the global namespace only (rule E33)
    case "global_expr":
      return symbolValue(lookupGlobal(rootOf(scope), expr.name.name), ctx)
    case "member":
      return memberValue(expr, scope, ctx)
    case "call":
      return call(expr, scope, ctx)
    default:
      // index / deref / assign — not a foldable constant, and undecidable as one
      return UNKNOWN_VALUE
  }
}

function literal(expr: Extract<Expr, { kind: "literal" }>, ctx: FoldContext): Folded {
  const v = expr.value
  if (typeof v !== "bigint" && typeof v !== "number" && typeof v !== "boolean") return { value: undefined, constancy: "constant" }
  // an untyped integer takes the integer type its context expects (`FoldContext.expected`)
  if (expr.literalKind !== "typed" && typeof v === "bigint" && ctx.expected !== undefined) return { value: v, constancy: "constant", elem: ctx.expected }
  if (expr.literalKind !== "typed" || typeof v === "boolean") return { value: v, constancy: "constant" }
  // `REAL#0.1` is a REAL and `LREAL#0.1` an LREAL; an untyped `0.1` neither. `BYTE#250` is a BYTE (what NOT computes in).
  const e = elementaryType(expr.prefix ?? "")
  const width = realWidth(e)
  if (width !== undefined) return { value: Number(v), constancy: "constant", width }
  return e !== undefined && typeof v === "bigint" && (e.family === "int" || e.family === "bitstring") && e.rank !== undefined
    ? { value: v, constancy: "constant", elem: e }
    : { value: v, constancy: "constant" }
}

/**
 * NOT ON AN INTEGER COMPUTES IN THE UNSIGNED INTEGER OF ITS WIDTH (`arith/operators` `notResultType`): `NOT BYTE#250`,
 * `NOT WORD#65530` and `NOT 250` (an untyped literal, its narrowest type USINT) are 5, `NOT INT#-5` is 4 (`ce_fold_not_int*`,
 * both vendors 2026-10-03). On a BOOL it is the negation.
 */
function not(operand: Folded): Folded {
  const v = operand.value
  if (typeof v === "boolean") return { ...operand, value: !v }
  if (typeof v !== "bigint") return { value: undefined, constancy: operand.constancy }
  const e = integerTypeOf(operand)
  if (e === undefined) return { value: undefined, constancy: operand.constancy }
  const unsigned = integerOfWidth(e.bits, false)
  return { value: BigInt.asUintN(e.bits, ~v), constancy: operand.constancy, elem: unsigned }
}

/**
 * The integer type a folded integer computes in — the one the walk knows (a typed literal, a constant's declared type, a
 * conversion, an enum's storage, or the type the context gives an untyped literal), else NONE. An untyped literal with no
 * context is not given its narrowest type, though an array bound measured exactly that (`NOT 250` is 5, `SHL(1, 3)` 8,
 * `ce_fold_not_int_untyped`, `ce_fold_shl_untyped`): wherever a consumer folds with a context it does not pass (the
 * transpiler folds an initializer by itself), the narrowest width is the wrong one — `NOT 0` into a WORD is 65535, not 255.
 * NOT or a shift of an untyped literal as a bound is niche: accepted loss (0 occurrences in the corpora).
 */
export function integerTypeOf(f: Folded): ElementaryType | undefined {
  return f.elem
}

/**
 * The integer type a CONSTANT's slot holds its fold in. A constant-EXPRESSION initializer is not narrowed (see
 * `initialValue`), so `D : SINT := K + 1` (K = 127) IS 128 — CODESYS reads D itself back as SINT#128 and `d2 := D` is
 * 128 (conformance `named_const_expression_keeps`, recorded; transpile-review-2026-09-29 task 2.3). A slot of the
 * declared width cannot hold that, so it is the same signedness at the first width that can — a bit string the bit string
 * of that width (`tr_a29_byte_constant_expression_overflow`: B : BYTE := 255 + 1 monitored BYTE#256, 6.A.29). Undefined
 * when the declared type already holds the value, no wider one of its kind does, or it is no integer or bit string.
 */
export function constantSlotType(value: bigint, declared: ElementaryType): ElementaryType | undefined {
  if ((declared.family !== "int" && declared.family !== "bitstring") || declared.rank === undefined) return undefined
  const fits = (bits: number): boolean => (declared.signed ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value)) === value
  if (fits(declared.bits)) return undefined
  const bits = [16, 32, 64].find((b) => b > declared.bits && fits(b))
  if (bits === undefined) return undefined
  return declared.family === "bitstring" ? elementaryType(bits === 16 ? "WORD" : bits === 32 ? "DWORD" : "LWORD") : integerOfWidth(bits, declared.signed)
}
