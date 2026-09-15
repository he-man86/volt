/**
 * const-eval — evaluate a constant `Expr` to its value (Layer C, C.3). Literals are already valued
 * in layer A; this folds unary/binary arithmetic and references to `CONSTANT` variables. Anything
 * non-constant (a plain var, a call, a member, mixed/unsupported ops) yields `undefined` — the
 * conservative signal that a consumer (subrange/array-bounds/overflow) must skip.
 *
 * Integers stay `bigint` (exact for the 64-bit types); reals are `number`.
 */
import type { Scope, Symbol } from "../symbols/index.js"
import { findChildScope, lookup, lookupLocal, lookupMember, isLibrarySymbol, resolveGvlMember } from "../symbols/index.js"
import type { Expr, TypeExpr, VarDecl } from "../syntax/index.js"

export type ConstValue = bigint | number | boolean | undefined

/**
 * Whether an expression is a compile-time CONSTANT, a mutable VARIABLE, or UNDECIDABLE — the zero-FP basis for
 * "this must be a constant" checks (CASE labels C0218, array-repeat counts C0162). It answers what `constEval`
 * cannot: `constEval` returns `undefined` for BOTH a mutable variable AND a constant it merely can't fold (an
 * enum member, a library/unresolved constant), so "didn't fold" is not "is a variable". Here an enum member
 * (`enum_value` kind) and a `CONSTANT`-section symbol are `constant`; only a genuine non-constant local/global
 * is `variable`; anything unresolved or from a library is `unknown`. Callers flag ONLY `variable`.
 */
export type Constancy = "constant" | "variable" | "unknown"

export function constancyOf(expr: Expr, scope: Scope): Constancy {
  switch (expr.kind) {
    case "literal":
      return "constant"
    case "paren":
      return constancyOf(expr.inner, scope)
    case "unary":
      return constancyOf(expr.operand, scope)
    case "binary": {
      const l = constancyOf(expr.left, scope)
      const r = constancyOf(expr.right, scope)
      if (l === "variable" || r === "variable") return "variable"
      return l === "constant" && r === "constant" ? "constant" : "unknown"
    }
    case "ident_expr": {
      const found = lookup(scope, expr.name)
      if (found === undefined) return "unknown" // unresolved — could be a library constant or a typo
      const sym = found.symbol
      if (isLibrarySymbol(sym)) return "unknown" // library symbol — may be a constant we can't see (normalizes %20)
      if (sym.kind === "enum_value" || sym.constant === true) return "constant"
      if (sym.kind === "var" || sym.kind === "method_param" || sym.kind === "struct_field" || sym.kind === "gvl_var")
        return "variable"
      return "unknown" // a function/type/namespace name is not a value in this position
    }
    default:
      return "unknown" // member / index / call / deref — undecidable
  }
}

export function constEval(expr: Expr, scope: Scope): ConstValue {
  return fold(expr, scope, { folding: new Set() })
}

/** What a fold carries down: the constants being folded — a cycle (`X := Y; Y := X`, `P.N := P.N`) stops there instead of
 *  recursing forever, which froze the editor's diagnostics — and the global list whose initializer is being folded. */
interface FoldContext {
  folding: Set<Symbol>
  list?: string
}

function fold(expr: Expr, scope: Scope, ctx: FoldContext): ConstValue {
  switch (expr.kind) {
    case "literal": {
      const v = expr.value
      return typeof v === "bigint" || typeof v === "number" || typeof v === "boolean" ? v : undefined
    }
    case "paren":
      return fold(expr.inner, scope, ctx)
    case "unary":
      return foldUnary(expr.op, fold(expr.operand, scope, ctx))
    case "binary":
      return foldBinary(expr.op, fold(expr.left, scope, ctx), fold(expr.right, scope, ctx))
    case "ident_expr":
      return constRef(expr.name, scope, ctx)
    case "member":
      return qualifiedConstRef(expr, scope, ctx)
    default:
      // index / call / deref / assign — not a foldable constant.
      return undefined
  }
}

const rootOf = (scope: Scope): Scope => (scope.parent === undefined ? scope : rootOf(scope.parent))

/**
 * `List.Const` / `Program.Const` — a CONSTANT named through its global variable list or its PROGRAM, as pro2193 sizes
 * arrays (`ARRAY[1..GVL_Constants.ChainProductsForReject]`, `MaxVacuums : USINT := XiUnits.MaxVacuums`). Neither folded,
 * so every such array had no size and every such initializer no value. A library's are left unfolded, like a bare one's
 * constancy (`constancyOf`): its declarations may be partial.
 */
function qualifiedConstRef(expr: Extract<Expr, { kind: "member" }>, scope: Scope, ctx: FoldContext): ConstValue {
  if (expr.base.kind !== "ident_expr") return undefined
  const project = rootOf(scope)
  const base = lookup(scope, expr.base.name)?.symbol
  if (base === undefined || isLibrarySymbol(base)) return undefined
  const programScope = base.kind === "program" ? findChildScope(project, base.name) : undefined
  const target = base.kind === "gvl_block" ? resolveGvlMember(expr, scope, project) : programScope && lookupMember(programScope, expr.member.name)
  return target === undefined || isLibrarySymbol(target) ? undefined : initialValue(target, ctx)
}

/**
 * A reference to a `CONSTANT` variable. Inside a global list's own initializer its siblings are seen bare first — a
 * `qualified_only` list's too, which bare lookup skips: pro2193's `GVL_Constants` compiles
 * `MaxProductsInMould := MaxMouldLevels * …`, and a same-named constant of ANOTHER list was folded in its place.
 */
function constRef(name: string, scope: Scope, ctx: FoldContext): ConstValue {
  const sibling = ctx.list === undefined ? undefined : lookupLocal(rootOf(scope), name).find((s) => s.kind === "gvl_var" && s.uri === ctx.list)
  const symbol = sibling ?? lookup(scope, name)?.symbol
  return symbol === undefined ? undefined : initialValue(symbol, ctx)
}

/** A constant's value: its initializer folded in its owning scope, at its declared type's kind of number. */
function initialValue(symbol: Symbol, ctx: FoldContext): ConstValue {
  if (symbol.constant !== true || ctx.folding.has(symbol)) return undefined
  const decl = symbol.ast as VarDecl
  // A scalar initializer is an Expr; an AggregateInit is not a constant scalar.
  if (decl.init === undefined || decl.init.kind === "aggregate_init") return undefined
  ctx.folding.add(symbol)
  const value = fold(decl.init, symbol.owner, { folding: ctx.folding, ...(symbol.kind === "gvl_var" ? { list: symbol.uri } : {}) })
  ctx.folding.delete(symbol)
  // `RC : REAL := 10` is a REAL: `RC / 4` is 2.5, not the integer 2 the literal would fold to.
  // ponytail: a REAL behind an alias type folds as its literal; resolve the alias when one is seen
  return typeof value === "bigint" && isRealType(decl.type) ? Number(value) : value
}

const isRealType = (t: TypeExpr): boolean => t.kind === "named_type" && /^L?REAL$/i.test(t.name.text)

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
