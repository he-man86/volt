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
import {
  bareEnumMember,
  isLibrarySymbol,
  lookup,
  lookupGlobal,
  lookupLocal,
  resolveQualifiedConst,
  rootOf,
  targetOf,
  type Scope,
  type Symbol,
} from "../../symbols/index.js"
import { decodeStringLiteral, type CallExpr, type Expr, type Target, type TypeExpr, type VarDecl } from "../../syntax/index.js"
import { parseConversionName } from "../conversion-name.js"
import { DEFAULT_STRING_LENGTH } from "../defaults.js"
import { elementaryType, type ElementaryType } from "../elementary.js"
import { enumMemberValue, enumValueStorage } from "../enums.js"
import { resolveMemberChain } from "../infer/member.js"
import { sizeofOperandBytes } from "../infer/expr.js"
import { elementaryTypeOn } from "../platform.js"
import { resolveTypeExpr } from "../resolve.js"
import { elemOf } from "../type.js"
import { integerOfWidth, wrapToWidth } from "../width.js"

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
 */
export function constEval(expr: Expr, scope: Scope, asConstant = false): ConstValue {
  const { value, width } = evaluate(expr, scope)
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
 * THE VALUE A DECLARATION HOLDS BEFORE ANYTHING WRITES IT — its initializer folded and stored into its declared type. A
 * CONSTANT is its value as named (a literal held at the declared width, an expression not — rule CE2); a variable holds
 * its initializer as a store does: an integer wrapped to the declared width (`x : BYTE := -1` is 255, `si : SINT := C + …`
 * (200) is -56 — `bound_*`, `cc_init_constant_expr_into_sint`), a STRING literal cut at the declared capacity, a WSTRING's
 * in UTF-16 code units (`'abc'` into a STRING(2) is 'ab', "héllo" into a WSTRING(3) "hél" — `cc_string_*`,
 * `wstring_code_units`). Undefined when the initializer does not fold, or holds a character whose stored form is not
 * measured (a non-ASCII character typed into a STRING).
 */
export function declaredValue(symbol: Symbol): ConstValue | string {
  const decl = symbol.ast as VarDecl | undefined
  if (decl?.kind !== "var_decl" || decl.init === undefined || decl.init.kind === "aggregate_init") return undefined
  const init = decl.init
  if (init.kind === "literal" && (init.literalKind === "string" || init.literalKind === "wstring")) {
    const wide = init.literalKind === "wstring"
    const text = typeof init.value === "string" ? decodeStringLiteral(init.value, wide) : undefined
    if (text === undefined || (!wide && /[^\x00-\x7f]/.test(text))) return undefined
    const type = resolveTypeExpr(decl.type, rootOf(symbol.owner), 0, symbol.owner, symbol.uri)
    if (type.kind !== "elementary" || type.elem.family !== "string" || type.unfoldedLength === true) return undefined
    return text.slice(0, type.length ?? DEFAULT_STRING_LENGTH)
  }
  if (compileTimeConstant(symbol)) return initialValue(symbol, { folding: new Set() }).value
  const integer = integerType(declaredElem(decl.type, symbol))
  const { value, width } = fold(init, symbol.owner, expecting({ folding: new Set() }, unsignedType(integer)))
  if (typeof value === "number") return width === 32 ? Math.fround(value) : value
  return typeof value === "bigint" && integer !== undefined ? wrapToWidth(value, integer) : value
}

/**
 * A CONSTANT DEFINED THROUGH ITSELF — its initializer reaches it again, directly (`cs : INT := cs + 1`) or through
 * another constant (`ca := cb + 1; cb := ca + 1`). CODESYS refuses each constant of the cycle, "Recursive definition of
 * constant value" (`ce_cycle` twice, `ce_cycle_self` once, 2026-10-03; rule CE5). One that merely names a cycle is not
 * one of it. The fold itself stops at the cycle and yields no value.
 */
export function isRecursiveConstant(symbol: Symbol): boolean {
  if (!compileTimeConstant(symbol)) return false
  const decl = symbol.ast as VarDecl
  if (decl.init === undefined || decl.init.kind === "aggregate_init") return false
  const cycle = { start: symbol, hit: false }
  fold(decl.init, symbol.owner, { ...listOf(symbol), folding: new Set([symbol]), cycle })
  return cycle.hit
}

/**
 * A symbol whose initializer IS its value: one in a `CONSTANT` section that is not a parameter. A `VAR_INPUT CONSTANT`
 * (or `VAR_IN_OUT CONSTANT`) is read-only but holds the caller's argument — its default only when none is passed:
 * `F(n := 3)` steps `BY n` by 3 (conformance `var_input_constant_default_as_step`, LIVE; transpile-review-2026-09-29 task 4).
 */
export function compileTimeConstant(symbol: Symbol): boolean {
  return symbol.constant === true && symbol.varSection !== "VAR_INPUT" && symbol.varSection !== "VAR_IN_OUT"
}

/**
 * A folded value, its constancy and, where the walk knows it, its type: a REAL or LREAL's width, an integer's elementary
 * type (a typed literal, a conversion, a constant's declared type, an enum's storage) — what NOT and the shifts compute in.
 * An untyped literal has neither: it takes its partner's width, and an untyped integer its own narrowest type.
 */
interface Folded {
  value: ConstValue
  constancy: Constancy
  width?: RealWidth
  elem?: ElementaryType
}
type RealWidth = 32 | 64

const UNKNOWN_VALUE: Folded = { value: undefined, constancy: "unknown" }
const wider = (a?: RealWidth, b?: RealWidth): RealWidth | undefined => (a === undefined ? b : b === undefined ? a : a > b ? a : b)
function realWidth(e: ElementaryType | undefined): RealWidth | undefined {
  return e?.family !== "real" ? undefined : e.bits === 32 ? 32 : 64
}
/** Two constancies met: a variable taints, two constants stay constant, anything else is undecidable. */
function meet(a: Constancy, b: Constancy): Constancy {
  return a === "variable" || b === "variable" ? "variable" : a === "constant" && b === "constant" ? "constant" : "unknown"
}
const meetAll = (xs: readonly Folded[]): Constancy => xs.reduce<Constancy>((c, x) => meet(c, x.constancy), "constant")

/** What a fold carries down: the constants being folded — a cycle (`X := Y; Y := X`, `P.N := P.N`) stops there instead of
 *  recursing forever, which froze the editor's diagnostics (rule CE5; CODESYS: "Recursive definition of constant value",
 *  `ce_cycle`, `ce_cycle_self`) — and the global list whose initializer is being folded. */
interface FoldContext {
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
}

/** The global list a symbol's initializer folds inside (its siblings seen bare first), when it is a list's. */
const listOf = (symbol: Symbol): { list?: string } => (symbol.kind === "gvl_var" ? { list: symbol.uri } : {})

/** `ctx` with `expected` as the type an untyped literal takes — none when undefined. */
function expecting(ctx: FoldContext, expected: ElementaryType | undefined): FoldContext {
  const { expected: _, ...rest } = ctx
  return expected === undefined ? rest : { ...rest, expected }
}

function fold(expr: Expr, scope: Scope, ctx: FoldContext): Folded {
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
function integerTypeOf(f: Folded): ElementaryType | undefined {
  return f.elem
}

/**
 * `List.Const` / `Program.Const` — a CONSTANT named through its global variable list or its PROGRAM, as pro2193 sizes
 * arrays (`ARRAY[1..GVL_Constants.ChainProductsForReject]`, `MaxVacuums : USINT := XiUnits.MaxVacuums`). A library's are
 * left unfolded, like a bare one's constancy: its declarations may be partial. Otherwise an enum value `E.Member`
 * (`Ns.E.Member`), whatever its enum.
 */
function memberValue(expr: Extract<Expr, { kind: "member" }>, scope: Scope, ctx: FoldContext): Folded {
  const target = resolveQualifiedConst(expr, scope)
  if (target !== undefined) return symbolValue(target, ctx)
  const sym = resolveMemberChain(expr, scope, rootOf(scope))
  return sym?.kind === "enum_value" ? symbolValue(sym, ctx) : UNKNOWN_VALUE
}

/**
 * A reference by a bare name. Inside a global list's own initializer its siblings are seen bare first — a `qualified_only`
 * list's too, which bare lookup skips: pro2193's `GVL_Constants` compiles `MaxProductsInMould := MaxMouldLevels * …`, and a
 * same-named constant of ANOTHER list was folded in its place. A name no scope declares may be an enum's member.
 */
function constRef(name: string, scope: Scope, ctx: FoldContext): Folded {
  const sibling = ctx.list === undefined ? undefined : lookupLocal(rootOf(scope), name).find((s) => s.kind === "gvl_var" && s.uri === ctx.list)
  return symbolValue(sibling ?? lookup(scope, name)?.symbol ?? bareEnumMember(scope, name), ctx)
}

/** The constancy of the symbol a name resolved to, and its value when it has one. */
function symbolValue(sym: Symbol | undefined, ctx: FoldContext): Folded {
  if (sym === undefined) return UNKNOWN_VALUE // unresolved — could be a library constant or a typo
  if (sym.kind === "enum_value") return enumValue(sym, ctx)
  if (isLibrarySymbol(sym)) return UNKNOWN_VALUE // may be a constant we can't see (normalizes %20)
  if (sym.constant === true) return { ...initialValue(sym, ctx), constancy: "constant" }
  if (sym.kind === "var" || sym.kind === "method_param" || sym.kind === "struct_field" || sym.kind === "gvl_var")
    return { value: undefined, constancy: "variable" }
  return UNKNOWN_VALUE // a function/type/namespace name is not a value in this position
}

/** An enum value: its written value folded in the project, else one more than the member before it (the first 0), in
 *  its enum's storage type (`enums` `enumValueStorage`). A member whose values do not fold has none — still a constant. */
function enumValue(sym: Symbol, ctx: FoldContext): Folded {
  if (ctx.folding.has(sym)) return { value: undefined, constancy: "constant" }
  const project = rootOf(sym.owner)
  ctx.folding.add(sym)
  const value = enumMemberValue(sym, project, (e) => {
    // the walk's cycle goes along: `A := c` with `c := E.A` is a cycle through the member (step 4d review)
    const v = fold(e, project, { folding: ctx.folding, ...withCycle(ctx) }).value
    return typeof v === "bigint" ? v : undefined
  })
  ctx.folding.delete(sym)
  const elem = enumValueStorage(sym, project)?.elem
  return elem === undefined ? { value, constancy: "constant" } : { value, constancy: "constant", elem }
}

/**
 * A constant's value: its initializer folded in its owning scope, at its declared type's kind of number. A REAL or LREAL
 * constant carries its declared width but NOT a rounded value — the fold it is named in rounds once, at its end. A
 * non-constant symbol has none.
 */
function initialValue(symbol: Symbol, ctx: FoldContext): Folded {
  const constancy: Constancy = "constant"
  if (ctx.folding.has(symbol) && ctx.cycle?.start === symbol) ctx.cycle.hit = true
  if (!compileTimeConstant(symbol) || ctx.folding.has(symbol)) return { value: undefined, constancy }
  const decl = symbol.ast as VarDecl
  // A scalar initializer is an Expr; an AggregateInit is not a constant scalar.
  if (decl.init === undefined || decl.init.kind === "aggregate_init") return { value: undefined, constancy }
  // its declared type resolves in a fold of its own (a fresh context): an alias whose bound names the constant
  // (`TYPE A : INT(0..c)`, `c : A := 5`) reaches it again there — it has no value, as a cycle has none; it recursed until
  // the stack overflowed and the file got no diagnostics at all (step 4d review 2)
  if (typing.has(symbol)) return { value: undefined, constancy }
  typing.add(symbol)
  let e: ElementaryType | undefined
  try {
    e = declaredElem(decl.type, symbol)
  } finally {
    typing.delete(symbol)
  }
  ctx.folding.add(symbol)
  const inner = expecting({ ...listOf(symbol), folding: ctx.folding, ...withCycle(ctx) }, unsignedType(integerType(e)))
  const { value } = fold(decl.init, symbol.owner, inner)
  ctx.folding.delete(symbol)
  // `RC : REAL := 10` is a REAL: `RC / 4` is 2.5, not the integer 2 the literal would fold to — and so is a constant of an
  // alias of REAL (`c : A := 10` with `TYPE A : REAL`, `ce_real_alias_const` folds `REAL_TO_INT(c / 4)` to 3, rule CE9)
  const width = realWidth(e)
  if (width !== undefined) return { value: typeof value === "bigint" ? Number(value) : value, constancy, width }
  if (typeof value !== "bigint") return { value, constancy }
  // A LITERAL initializer is held at the declared width, as the constant's slot holds it: `C : INT := 40000` is -25536
  // wherever it is named — an initializer, a CASE label. An EXPRESSION initializer is NOT: `D : SINT := K + 1` (K = 127)
  // reads 128, even from D itself (conformance `named_const_literal_wrap`, `named_const_expression_keeps`, LIVE).
  // A platform integer (`__XINT`) is held at the width of the project's target, and not at all where that is unknown.
  const integer = integerType(e)
  const held = decl.init.kind === "literal" && integer !== undefined ? wrapToWidth(value, integer) : value
  return integer === undefined ? { value: held, constancy } : { value: held, constancy, elem: integer }
}

/** The constants whose declared type is being resolved, across every fold that resolution starts — see `initialValue`. */
const typing = new Set<Symbol>()

/** `e` when it is an unsigned integer or a bit string — the context an untyped literal may take (`FoldContext.expected`). */
function unsignedType(e: ElementaryType | undefined): ElementaryType | undefined {
  return e !== undefined && (e.family === "bitstring" || !e.signed) ? e : undefined
}

/** The cycle a walk is watching, carried into a nested fold (`isRecursiveConstant`). */
const withCycle = (ctx: FoldContext): { cycle?: { start: Symbol; hit: boolean } } => (ctx.cycle === undefined ? {} : { cycle: ctx.cycle })

/** `e` when it is an integer or bit-string type with a width (not BIT), else undefined. */
function integerType(e: ElementaryType | undefined): ElementaryType | undefined {
  return e !== undefined && e.rank !== undefined && (e.family === "int" || e.family === "bitstring") ? e : undefined
}

/** A declaration's elementary type: the name as the project's target reads it, else the type the name resolves to (an
 *  alias of one, `TYPE A : REAL`). Undefined for anything else. */
function declaredElem(t: TypeExpr, symbol: Symbol): ElementaryType | undefined {
  if (t.kind !== "named_type") return undefined
  const project = rootOf(symbol.owner)
  const target: Target | undefined = targetOf(project)
  return elementaryTypeOn(t.name.text, target) ?? elemOf(resolveTypeExpr(t, project, 0, symbol.owner, symbol.uri))
}

// ─── calls: the conversions, the pure built-ins, SIZEOF ───────────────────────────────────────────────────────────

/** The built-ins a constant expression may call, folded below — everything else (a user function, ADR, a math function not
 *  listed) is no constant this decides. */
const FOLDED_BUILTINS: ReadonlySet<string> = new Set(["ABS", "MIN", "MAX", "LIMIT", "SEL", "MUX", "SHL", "SHR", "ROL", "ROR", "TRUNC", "EXPT", "SQRT", "SIZEOF"])

/** The SIZEOF operands being sized, across every fold the sizing starts, and whether the sizing reached itself — see `call`. */
const sizing = new Map<Expr, { reached: boolean }>()

function call(expr: CallExpr, scope: Scope, ctx: FoldContext): Folded {
  if (expr.callee.kind !== "ident_expr") return UNKNOWN_VALUE
  const name = expr.callee.name
  // a name the project declares is ITS function, not the built-in: user code can shadow a built-in name
  if (lookup(scope, name) !== undefined) return UNKNOWN_VALUE
  const upper = name.toUpperCase()
  if (upper === "SIZEOF") {
    const operand = expr.args.length === 1 ? expr.args[0]?.value : undefined
    // its operand's type folds that type's bounds, a fold of their own (a fresh context): a size that reaches itself
    // through one (`a : ARRAY[0..SIZEOF(a)]`, `c := SIZEOF(arr)` with `arr : ARRAY[0..c]`) has no size — it recursed
    // until the stack overflowed, and the file got no diagnostics at all (step 4d review). The OUTER size has none either:
    // `x : INT (0..SIZEOF(x))` sized x as an INT(0..2), a range CODESYS never computed (step 4d review 2)
    if (operand === undefined) return { value: undefined, constancy: "constant" }
    const inside = sizing.get(operand)
    if (inside !== undefined) {
      inside.reached = true
      return { value: undefined, constancy: "constant" }
    }
    const self = { reached: false }
    sizing.set(operand, self)
    try {
      const bytes = sizeofOperandBytes(operand, scope, rootOf(scope))
      return bytes === undefined || self.reached ? { value: undefined, constancy: "constant" } : { value: bytes, constancy: "constant" }
    } finally {
      sizing.delete(operand)
    }
  }
  const conversion = parseConversionName(name, targetOf(rootOf(scope)))
  if (conversion === undefined && !FOLDED_BUILTINS.has(upper)) return UNKNOWN_VALUE
  // positional arguments only — a named or output one is no call this folds
  if (expr.args.some((a) => a.param !== undefined || a.output || a.value === undefined)) return UNKNOWN_VALUE
  // a shift's operand takes what the call's context expects when it is an untyped literal (`FoldContext.expected`);
  // anything else — a conversion's argument, a NOT under the shift — nothing: unmeasured (step 4d review 2)
  const args = expr.args.map((a, i) =>
    conversion !== undefined
      ? converted(a.value!, scope, expecting(ctx, undefined))
      : fold(a.value!, scope, literalOnly(a.value!, expecting(ctx, shiftContext(upper, i, ctx.expected)))),
  )
  const constancy = meetAll(args)
  const result = conversion !== undefined ? (args.length === 1 ? convert(args[0]!, conversion.to) : undefined) : builtin(upper, args)
  return result === undefined ? { value: undefined, constancy } : { ...result, constancy }
}

/** `ctx` for an operand of NOT or a shift: its context type reaches an untyped LITERAL there, nothing nested deeper. */
const literalOnly = (operand: Expr, ctx: FoldContext): FoldContext => (operand.kind === "literal" ? ctx : expecting(ctx, undefined))

/** The integer type a non-conversion's argument `i` takes as an untyped literal: a shift's operand, the context's — see `call`. */
function shiftContext(name: string, i: number, expected: ElementaryType | undefined): ElementaryType | undefined {
  return i === 0 && (name === "SHL" || name === "SHR" || name === "ROL" || name === "ROR") ? expected : undefined
}

/** A CONVERSION's argument folded — a duration literal as its type's ticks (TIME milliseconds, LTIME nanoseconds), which
 *  only a conversion reads (`TIME_TO_DINT(T#5MS)` is 5, `ce_fold_conversion_bound_time`; `cfold_time_to_dint` 1500). Any
 *  other call of one yields a TIME, which no fold here holds: `MAX(T#1S, T#2S)` folded to the bare 2000 (step 4d review). */
function converted(e: Expr, scope: Scope, ctx: FoldContext): Folded {
  if (e.kind === "literal" && e.literalKind === "time" && typeof e.value === "object" && e.value !== null && "ns" in e.value) {
    const t = elementaryType(/^LTIME#/i.test(e.text) ? "LTIME" : "TIME")!
    return { value: e.value.ns / t.tickNs!, constancy: "constant", elem: t }
  }
  return fold(e, scope, ctx)
}

type Result = Omit<Folded, "constancy">

/**
 * An explicit conversion into `to`: an integer target wraps (`INT_TO_USINT(300)` is 44, `INT_TO_SINT(200)` -56), a REAL
 * source rounds half away from zero (`REAL_TO_INT(2.5)` 3, -2.5 -3) at the destination's register (below), BOOL is 1 or 0
 * and an integer into BOOL is "not zero", an integer into a REAL is the number (`ce_fold_conversion_bound_*`, `cfold_*`).
 * A target or source of any other family is not folded.
 */
function convert(arg: Folded, to: ElementaryType): Result | undefined {
  const v = arg.value
  if (v === undefined) return undefined
  if (to.family === "bool") return { value: typeof v === "boolean" ? v : typeof v === "bigint" ? v !== 0n : v !== 0 }
  if (to.family === "real") {
    const n = typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "bigint" ? exactNumber(v) : v
    if (n === undefined) return undefined
    return to.bits === 32 ? { value: Math.fround(n), width: 32 } : { value: n, width: 64 }
  }
  if ((to.family !== "int" && to.family !== "bitstring") || to.rank === undefined) return undefined
  const integer = typeof v === "boolean" ? (v ? 1n : 0n) : typeof v === "bigint" ? v : realToInteger(v, to.bits)
  return integer === undefined ? undefined : { value: wrapToWidth(integer, to), elem: to }
}

/** A bigint as a number when it is one exactly — the larger integers round, which no measured fold has asked for. */
function exactNumber(v: bigint): number | undefined {
  return v >= -(2n ** 53n) && v <= 2n ** 53n ? Number(v) : undefined
}

/**
 * REAL → INTEGER, as measured in full (conformance `conversions/real-to-integer.ts`, `real-to-integer-ladder.ts`, the 192
 * cells the transpiler's `coerce` reproduces): rounded half away from zero, then converted at the DESTINATION's register —
 * 64-bit for a 64-bit destination, 32-bit for everything else — which the caller wraps into the declared type. A NaN is the
 * register's indefinite (i64::MIN, or 0); past the register: 64-bit ≥ 2^64 or < -2^63 i64::MIN; 32-bit ≥ 2^63 is 0 and
 * below -2^31 is -2^31 (`REAL_TO_DINT(3.0E9)` -1294967296, `cfold_real_to_int_out`).
 */
function realToInteger(n: number, bits: number): bigint | undefined {
  const wide = bits >= 64
  const I64_MIN = -(2n ** 63n)
  const I32_MIN = -(2n ** 31n)
  if (Number.isNaN(n)) return wide ? I64_MIN : 0n
  const rounded = Math.sign(n) * Math.round(Math.abs(n))
  if (!Number.isFinite(rounded)) return wide ? I64_MIN : rounded > 0 ? 0n : I32_MIN
  const r = BigInt(rounded)
  if (wide) return r >= 2n ** 64n || r < I64_MIN ? I64_MIN : BigInt.asIntN(64, r)
  if (r >= 2n ** 63n) return 0n
  if (r < I32_MIN) return I32_MIN
  return BigInt.asIntN(32, r)
}

/** A pure built-in over folded arguments (`ce_fold_builtin_bound_*`, `ce_fold_shl*`/`shr`/`rol`/`ror`, `cfold_*`). */
function builtin(name: string, args: readonly Folded[]): Result | undefined {
  const values = args.map((a) => a.value)
  if (values.some((v) => v === undefined)) return undefined
  const numbers = values.every((v) => typeof v === "bigint" || typeof v === "number")
  const pick = (i: number): Result => withType(args[i]!)
  switch (name) {
    case "ABS": {
      const v = values[0]
      if (args.length !== 1 || (typeof v !== "bigint" && typeof v !== "number")) return undefined
      const abs = typeof v === "bigint" ? (v < 0n ? -v : v) : Math.abs(v)
      return { ...withType(args[0]!), value: typeof abs === "bigint" && args[0]!.elem !== undefined ? wrapToWidth(abs, args[0]!.elem) : abs }
    }
    case "MIN":
    case "MAX": {
      if (args.length < 2 || !numbers) return undefined
      // the SECOND on a tie, as the transpiler's `builtinValue` (`MAX(a, b)` is `IF a > b THEN a ELSE b`)
      let at = 0
      for (let i = 1; i < args.length; i++) at = (name === "MAX" ? (values[at] as number) > (values[i] as number) : (values[at] as number) < (values[i] as number)) ? at : i
      return pick(at)
    }
    case "LIMIT": {
      if (args.length !== 3 || !numbers) return undefined
      const [mn, v, mx] = values as (bigint | number)[]
      const low = mn! > v! ? 0 : 1
      return pick((low === 0 ? mn! : v!) < mx! ? low : 2)
    }
    case "SEL": {
      const g = values[0]
      return args.length === 3 && typeof g === "boolean" ? pick(g ? 2 : 1) : undefined
    }
    case "MUX": {
      const k = values[0]
      if (args.length < 2 || typeof k !== "bigint") return undefined
      // an out-of-range K, negative included, picks the LAST input (conformance `mux_out_of_range`)
      return pick(k >= 0n && k < BigInt(args.length - 1) ? Number(k) + 1 : args.length - 1)
    }
    case "SHL":
    case "SHR":
    case "ROL":
    case "ROR":
      return shift(name, args)
    case "TRUNC": {
      // toward zero, a DINT (`cfold_trunc` 7); beyond DINT's range unmeasured
      const v = values[0]
      if (args.length !== 1 || typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= 2 ** 31) return undefined
      return { value: BigInt(Math.trunc(v)), elem: elementaryType("DINT")! }
    }
    case "EXPT": {
      // REAL only when both arguments are REAL, LREAL otherwise (`builtins` `exptResultType`)
      if (args.length !== 2 || !numbers) return undefined
      const width: RealWidth = args[0]!.width === 32 && args[1]!.width === 32 ? 32 : 64
      const p = Math.pow(Number(values[0]), Number(values[1]))
      return { value: width === 32 ? Math.fround(p) : p, width }
    }
    case "SQRT": {
      // the argument's own REAL type, else LREAL (`builtins` `mathResultType`)
      if (args.length !== 1 || !numbers) return undefined
      const width: RealWidth = args[0]!.width ?? 64
      const r = Math.sqrt(Number(values[0]))
      return { value: width === 32 ? Math.fround(r) : r, width }
    }
  }
  return undefined
}

/** A folded value with the type it carries. */
function withType(f: Folded): Result {
  const r: Result = { value: f.value }
  if (f.width !== undefined) r.width = f.width
  if (f.elem !== undefined) r.elem = f.elem
  return r
}

/**
 * A SHIFT OR ROTATION HAPPENS AT ITS OPERAND'S WIDTH: `SHL(BYTE#255, 1)` is 254, `ROL(BYTE#129, 1)` 3, `ROR(BYTE#129, 1)`
 * 192, `SHR(WORD#80, 4)` 5, and an untyped literal shifts at its narrowest type (`SHL(1, 3)` 8) — `ce_fold_sh*`, `ce_fold_ro*`,
 * both vendors 2026-10-03. The bits are the operand's pattern; the result is of the operand's type.
 */
function shift(name: string, args: readonly Folded[]): Result | undefined {
  const [operand, count] = args
  if (args.length !== 2 || typeof operand!.value !== "bigint" || typeof count!.value !== "bigint" || count!.value < 0n) return undefined
  const e = integerTypeOf(operand!)
  if (e === undefined) return undefined
  const bits = BigInt(e.bits)
  const pattern = BigInt.asUintN(e.bits, operand!.value)
  const n = count!.value
  const r =
    name === "SHL" ? pattern << n
    : name === "SHR" ? pattern >> n
    : name === "ROL" ? (pattern << n % bits) | (pattern >> ((bits - (n % bits)) % bits))
    : (pattern >> n % bits) | (pattern << ((bits - (n % bits)) % bits))
  return { value: wrapToWidth(r, e), elem: e }
}

// ─── operators ───────────────────────────────────────────────────────────────────────────────────────────────────────

function foldUnary(op: string, v: ConstValue): ConstValue {
  if (v === undefined) return undefined
  if (op === "-") {
    if (typeof v === "bigint") return -v
    if (typeof v === "number") return -v
  }
  if (op === "+") return typeof v === "boolean" ? undefined : v
  return undefined
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
    // the bit operators on two non-negative integers (`cfold_paren_shl_or`: `SHL(…) OR 16#1` is 196609); a negative
    // operand's pattern is its type's, which an untyped fold does not carry
    case "AND":
      return l >= 0n && r >= 0n ? l & r : undefined
    case "OR":
      return l >= 0n && r >= 0n ? l | r : undefined
    case "XOR":
      return l >= 0n && r >= 0n ? l ^ r : undefined
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
