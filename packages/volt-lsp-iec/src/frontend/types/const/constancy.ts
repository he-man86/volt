/**
 * CONSTANCY — whether an expression is a compile-time constant, a variable, or undecidable, and which symbols are
 * compile-time constants at all. ONE WALK with the fold (rule CE7, frontend-conformance 4.6.2): the constancy is the half of
 * `fold.ts`'s evaluation that does not need a value, so a conversion or pure built-in of constants, SIZEOF, an enum value
 * and a list's CONSTANT are constant by the same reading that folds them, and the two cannot drift apart.
 */
import type { Scope } from "../../symbols/index.js"
import type { Expr } from "../../syntax/index.js"
import { constancyIn, type Constancy } from "./fold.js"

export { compileTimeConstant, type Constancy } from "./fold.js"

/**
 * Whether an expression is a compile-time CONSTANT, a mutable VARIABLE, or UNDECIDABLE — the zero-FP basis for
 * "this must be a constant" checks (CASE labels C0218, array-repeat counts C0162). An enum member and a `CONSTANT`-section
 * symbol are `constant`; only a genuine non-constant local/global is `variable`; anything unresolved or from a library is
 * `unknown`. Callers flag ONLY `variable`.
 */
export function constancyOf(expr: Expr, scope: Scope): Constancy {
  return constancyIn(expr, scope)
}
