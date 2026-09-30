/**
 * CONSTANCY — whether an expression is a compile-time constant, a variable, or undecidable, and which symbols are
 * compile-time constants at all. The VALUE of a constant is `fold.ts`'s.
 */
import { isLibrarySymbol, lookup, type Scope, type Symbol } from "../../symbols/index.js"
import type { Expr } from "../../syntax/index.js"

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

/**
 * A symbol whose initializer IS its value: one in a `CONSTANT` section that is not a parameter. A `VAR_INPUT CONSTANT`
 * (or `VAR_IN_OUT CONSTANT`) is read-only but holds the caller's argument — its default only when none is passed:
 * `F(n := 3)` steps `BY n` by 3 (conformance `var_input_constant_default_as_step`, LIVE; transpile-review-2026-09-29 task 4).
 */
export function compileTimeConstant(symbol: Symbol): boolean {
  return symbol.constant === true && symbol.varSection !== "VAR_INPUT" && symbol.varSection !== "VAR_IN_OUT"
}
