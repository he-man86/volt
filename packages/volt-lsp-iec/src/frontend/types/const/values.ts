/**
 * THE CONSTANT VALUES OF NAMES — a constant's declared and initial value, an enum value, a qualified constant: what a
 * name folds to, and whether it is a compile-time constant at all. Split from `fold.ts` (openspec lsp-same-standard
 * design.md §2.2).
 */
import {
  bareEnumMember,
  externalGlobal,
  isLibrarySymbol,
  lookup,
  lookupLocal,
  resolveQualifiedConst,
  rootOf,
  type Scope,
  type Symbol,
  targetOf,
} from "../../symbols/index.js"
import { type Expr, type Target, type TypeExpr, type VarDecl, decodeStringLiteral } from "../../syntax/index.js"
import { DEFAULT_STRING_LENGTH } from "../defaults.js"
import type { ElementaryType } from "../elementary.js"
import { enumMemberValue, enumValueStorage } from "../enums.js"
import { resolveMemberChain } from "../infer/member.js"
import { elementaryTypeOn } from "../platform.js"
import { resolveTypeExpr } from "../resolve.js"
import { elemOf } from "../type.js"
import { integerOfWidth, wrapToWidth } from "../width.js"
import {
  type ConstValue,
  fold,
  expecting,
  listOf,
  type Constancy,
  type FoldContext,
  type Folded,
  realWidth,
  UNKNOWN_VALUE,
} from "./fold.js"

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
  // NOT `storeInteger` (transpile-restructure 6.B.2: this guard is kept): the front-end holds only an INTEGER type's
  // value at its width (`integerType`: a rank, the platform's `__XINT` read on the project's target). `storeInteger` would
  // also wrap a duration's or a date's, which this fold has never done and no recording asks of it.
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
 * `List.Const` / `Program.Const` — a CONSTANT named through its global variable list or its PROGRAM, as pro2193 sizes
 * arrays (`ARRAY[1..GVL_Constants.ChainProductsForReject]`, `MaxVacuums : USINT := XiUnits.MaxVacuums`). A library's are
 * left unfolded, like a bare one's constancy: its declarations may be partial. Otherwise an enum value `E.Member`
 * (`Ns.E.Member`), whatever its enum.
 */
export function memberValue(expr: Extract<Expr, { kind: "member" }>, scope: Scope, ctx: FoldContext): Folded {
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
export function constRef(name: string, scope: Scope, ctx: FoldContext): Folded {
  const sibling = ctx.list === undefined ? undefined : lookupLocal(rootOf(scope), name).find((s) => s.kind === "gvl_var" && s.uri === ctx.list)
  return symbolValue(sibling ?? lookup(scope, name)?.symbol ?? bareEnumMember(scope, name), ctx)
}

/** The constancy of the symbol a name resolved to, and its value when it has one. */
export function symbolValue(sym: Symbol | undefined, ctx: FoldContext): Folded {
  if (sym === undefined) return UNKNOWN_VALUE // unresolved — could be a library constant or a typo
  if (sym.kind === "enum_value") return enumValue(sym, ctx)
  if (isLibrarySymbol(sym)) return UNKNOWN_VALUE // may be a constant we can't see (normalizes %20)
  // a VAR_EXTERNAL CONSTANT has no initializer of its own: its value is the global it binds (rule Y13, `externalGlobal`),
  // when that is a constant (`xo3_value_functions_across_objects`; the fold-agreement test, transpile-restructure 1.8.9)
  if (sym.constant === true && sym.varSection === "VAR_EXTERNAL") {
    const global = externalGlobal(rootOf(sym.owner), sym.name)
    return global?.constant === true ? { ...read(initialValue(global, ctx), ctx), constancy: "constant" } : { value: undefined, constancy: "constant" }
  }
  if (sym.constant === true) return { ...read(initialValue(sym, ctx), ctx), constancy: "constant" }
  if (sym.kind === "var" || sym.kind === "method_param" || sym.kind === "struct_field" || sym.kind === "gvl_var")
    return { value: undefined, constancy: "variable" }
  return UNKNOWN_VALUE // a function/type/namespace name is not a value in this position
}

/**
 * A CONSTANT's value as a READ outside another constant's initializer sees it: an integer one held unwrapped from an
 * expression (`initialValue`) in its type's RUN-TIME width — DINT for a narrower one, so `D : SINT := K + 1` (K = 127)
 * reads 128, but `D : DINT := K + 1` (K at DINT's max) reads -2147483648 in an initializer and at run time and
 * `U : UDINT := KU + 1` 0 (`tr_a29_dint_constant_expression_overflow`, `_udint_…`, transpile-restructure 6.A.29). Inside
 * a constant's own initializer the held value folds on: `F : DINT := D - 1` is 2147483647, which the monitor shows
 * (folded from the wrapped -2147483648 it would be -2147483649). A bit string's alike: B : BYTE := 255 + 1 reads 256,
 * W : DWORD := 16#FFFFFFFF + 1 reads 0 (`tr_a29_byte_…`, `_dword_constant_expression_overflow`).
 */
function read(f: Folded, ctx: FoldContext): Folded {
  if (ctx.inConstant === true || typeof f.value !== "bigint" || f.elem === undefined || (f.elem.family !== "int" && f.elem.family !== "bitstring")) return f
  return { ...f, value: wrapToWidth(f.value, f.elem.bits < 32 ? integerOfWidth(32, true) : f.elem) }
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
export function initialValue(symbol: Symbol, ctx: FoldContext): Folded {
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
  const inner = expecting({ ...listOf(symbol), folding: ctx.folding, ...withCycle(ctx), inConstant: true }, unsignedType(integerType(e)))
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
export function unsignedType(e: ElementaryType | undefined): ElementaryType | undefined {
  return e !== undefined && (e.family === "bitstring" || !e.signed) ? e : undefined
}

/** The cycle a walk is watching, carried into a nested fold (`isRecursiveConstant`). */
const withCycle = (ctx: FoldContext): { cycle?: { start: Symbol; hit: boolean } } => (ctx.cycle === undefined ? {} : { cycle: ctx.cycle })

/** `e` when it is an integer or bit-string type with a width (not BIT), else undefined. */
export function integerType(e: ElementaryType | undefined): ElementaryType | undefined {
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
