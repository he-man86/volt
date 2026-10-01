/**
 * CONSTANT FOLDING — evaluate a constant `Expr` to its value. Literals are already valued by the parser
 * (`syntax/literal`); this folds unary/binary arithmetic and references to `CONSTANT` variables. Anything
 * non-constant (a plain var, a call, a member, mixed/unsupported ops) yields `undefined` — the
 * conservative signal that a consumer (subrange/array-bounds/overflow) must skip.
 *
 * Integers stay `bigint` (exact for the 64-bit types); reals are `number`.
 */
import { lookup, lookupLocal, resolveQualifiedConst, rootOf, type Scope, type Symbol } from "../../symbols/index.js"
import type { Expr, TypeExpr, VarDecl } from "../../syntax/index.js"
import { elementaryType, type ElementaryType } from "../elementary.js"
import { integerOfWidth, wrapToWidth } from "../width.js"
import { compileTimeConstant } from "./constancy.js"

export type ConstValue = bigint | number | boolean | undefined

/**
 * A REAL expression folds WIDE and rounds ONCE, to float32, at its end — the value its runtime twin reads: `C01 : REAL :=
 * 0.1` named anywhere is 0.10000000149011612, `CBig + 1` (CBig = 2^24) is 16777216, yet `(CBig + 1) - CBig` is 1. An LREAL
 * constant initialised from a REAL one keeps the unrounded literal (`DChain : LREAL := C01` is 0.1). All LIVE, conformance
 * `real_constant_fold_width` (transpile-review-2026-09-29 task 3).
 *
 * `asConstant`: the expression is a CONSTANT's own initializer, whose value is that fold UNROUNDED — the constant is
 * substituted where it is named, so only the slot's own type rounds it (`DChain`'s slot reads 0.1).
 */
export function constEval(expr: Expr, scope: Scope, asConstant = false): ConstValue {
  const { value, width } = fold(expr, scope, { folding: new Set() })
  return width === 32 && !asConstant && typeof value === "number" ? Math.fround(value) : value
}

/** A folded value and, for a REAL or LREAL, its width. An untyped real literal has none: it takes its partner's. */
interface Folded {
  value: ConstValue
  width?: RealWidth
}
type RealWidth = 32 | 64

const NONE: Folded = { value: undefined }
const withWidth = (value: ConstValue, width: RealWidth | undefined): Folded => (width === undefined ? { value } : { value, width })
const wider = (a?: RealWidth, b?: RealWidth): RealWidth | undefined => (a === undefined ? b : b === undefined ? a : a > b ? a : b)
function realWidth(name: string): RealWidth | undefined {
  const e = elementaryType(name)
  return e?.family !== "real" ? undefined : e.bits === 32 ? 32 : 64
}

/** What a fold carries down: the constants being folded — a cycle (`X := Y; Y := X`, `P.N := P.N`) stops there instead of
 *  recursing forever, which froze the editor's diagnostics — and the global list whose initializer is being folded. */
interface FoldContext {
  folding: Set<Symbol>
  list?: string
}

function fold(expr: Expr, scope: Scope, ctx: FoldContext): Folded {
  switch (expr.kind) {
    case "literal": {
      const v = expr.value
      if (typeof v !== "bigint" && typeof v !== "number" && typeof v !== "boolean") return NONE
      // `REAL#0.1` is a REAL and `LREAL#0.1` an LREAL; an untyped `0.1` neither
      const width = expr.literalKind === "typed" && typeof v !== "boolean" ? realWidth(expr.prefix ?? "") : undefined
      return width === undefined ? { value: v } : { value: Number(v), width }
    }
    case "paren":
      return fold(expr.inner, scope, ctx)
    case "unary": {
      const operand = fold(expr.operand, scope, ctx)
      return withWidth(foldUnary(expr.op, operand.value), operand.width)
    }
    case "binary": {
      const l = fold(expr.left, scope, ctx)
      const r = fold(expr.right, scope, ctx)
      return withWidth(foldBinary(expr.op, l.value, r.value), wider(l.width, r.width))
    }
    case "ident_expr":
      return constRef(expr.name, scope, ctx)
    case "member":
      return qualifiedConstRef(expr, scope, ctx)
    default:
      // index / call / deref / assign — not a foldable constant.
      return NONE
  }
}

/**
 * `List.Const` / `Program.Const` — a CONSTANT named through its global variable list or its PROGRAM, as pro2193 sizes
 * arrays (`ARRAY[1..GVL_Constants.ChainProductsForReject]`, `MaxVacuums : USINT := XiUnits.MaxVacuums`). Neither folded,
 * so every such array had no size and every such initializer no value. A library's are left unfolded, like a bare one's
 * constancy (`constancyOf`): its declarations may be partial.
 */
function qualifiedConstRef(expr: Extract<Expr, { kind: "member" }>, scope: Scope, ctx: FoldContext): Folded {
  const target = resolveQualifiedConst(expr, scope)
  return target === undefined ? NONE : initialValue(target, ctx)
}

/**
 * A reference to a `CONSTANT` variable. Inside a global list's own initializer its siblings are seen bare first — a
 * `qualified_only` list's too, which bare lookup skips: pro2193's `GVL_Constants` compiles
 * `MaxProductsInMould := MaxMouldLevels * …`, and a same-named constant of ANOTHER list was folded in its place.
 */
function constRef(name: string, scope: Scope, ctx: FoldContext): Folded {
  const sibling = ctx.list === undefined ? undefined : lookupLocal(rootOf(scope), name).find((s) => s.kind === "gvl_var" && s.uri === ctx.list)
  const symbol = sibling ?? lookup(scope, name)?.symbol
  return symbol === undefined ? NONE : initialValue(symbol, ctx)
}

/**
 * A constant's value: its initializer folded in its owning scope, at its declared type's kind of number. A REAL or LREAL
 * constant carries its declared width but NOT a rounded value — the fold it is named in rounds once, at its end.
 */
function initialValue(symbol: Symbol, ctx: FoldContext): Folded {
  if (!compileTimeConstant(symbol) || ctx.folding.has(symbol)) return NONE
  const decl = symbol.ast as VarDecl
  // A scalar initializer is an Expr; an AggregateInit is not a constant scalar.
  if (decl.init === undefined || decl.init.kind === "aggregate_init") return NONE
  ctx.folding.add(symbol)
  const { value } = fold(decl.init, symbol.owner, { folding: ctx.folding, ...(symbol.kind === "gvl_var" ? { list: symbol.uri } : {}) })
  ctx.folding.delete(symbol)
  // `RC : REAL := 10` is a REAL: `RC / 4` is 2.5, not the integer 2 the literal would fold to.
  // ponytail: a REAL behind an alias type folds as its literal; resolve the alias when one is seen
  const width = decl.type.kind === "named_type" ? realWidth(decl.type.name.text) : undefined
  if (width !== undefined) return { value: typeof value === "bigint" ? Number(value) : value, width }
  // A LITERAL initializer is held at the declared width, as the constant's slot holds it: `C : INT := 40000` is -25536
  // wherever it is named — an initializer, a CASE label. An EXPRESSION initializer is NOT: `D : SINT := K + 1` (K = 127)
  // reads 128, even from D itself (conformance `named_const_literal_wrap`, `named_const_expression_keeps`, LIVE).
  return { value: typeof value === "bigint" && decl.init.kind === "literal" ? heldAs(value, decl.type) : value }
}

/** An integer as a variable of an elementary integer or bit-string type holds it — wrapped to the type's width. */
function heldAs(v: bigint, t: TypeExpr): bigint {
  const e = t.kind === "named_type" ? elementaryType(t.name.text) : undefined
  if (e === undefined || e.rank === undefined || (e.family !== "int" && e.family !== "bitstring")) return v
  return wrapToWidth(v, e)
}


/**
 * The integer type a CONSTANT's slot holds its fold in. A constant-EXPRESSION initializer is not narrowed (see
 * `initialValue`), so `D : SINT := K + 1` (K = 127) IS 128 — CODESYS reads D itself back as SINT#128 and `d2 := D` is
 * 128 (conformance `named_const_expression_keeps`, recorded; transpile-review-2026-09-29 task 2.3). A slot of the
 * declared width cannot hold that, so it is the same signedness at the first width that can. Undefined when the declared
 * type already holds the value, or it is not a signed/unsigned integer type (a bit string is unmeasured).
 */
export function constantSlotType(value: bigint, declared: ElementaryType): ElementaryType | undefined {
  if (declared.family !== "int") return undefined
  const fits = (bits: number): boolean => (declared.signed ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value)) === value
  if (fits(declared.bits)) return undefined
  const bits = [16, 32, 64].find((b) => b > declared.bits && fits(b))
  return bits === undefined ? undefined : integerOfWidth(bits, declared.signed)
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
