/**
 * THE BUILTINS' ARITY — which names are value functions and how many operands each takes, which callees fold to a
 * constant, and a call's one positional argument. A leaf: the constant fold (`values/`) asks it without importing the
 * builtins' lowering, which breaks the constants ↔ builtins cycle.
 */

import type { Expr } from "../../../frontend/syntax/index.js"
import { parseConversionName } from "../../../frontend/types/index.js"

/** The value functions `builtin` lowers, and how many operands each takes. SEL's count includes its selector. */
export const BUILTIN_ARITY: Readonly<Record<string, { min: number; max?: number }>> = {
  MAX: { min: 1 },
  MIN: { min: 1 },
  LIMIT: { min: 3, max: 3 },
  SEL: { min: 3, max: 3 },
  TRUNC: { min: 1, max: 1 },
  TRUNC_INT: { min: 1, max: 1 },
  ABS: { min: 1, max: 1 },
  EXPT: { min: 2, max: 2 },
  SHL: { min: 2, max: 2 },
  SHR: { min: 2, max: 2 },
  ROL: { min: 2, max: 2 },
  ROR: { min: 2, max: 2 },
  MUX: { min: 2 },
  ...Object.fromEntries(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"].map((n) => [n, { min: 1, max: 1 }])),
}

/** A call's one positional argument — undefined when it has another count, a name, an output or an empty one. */
export function oneArgument(e: Extract<Expr, { kind: "call" }>): Expr | undefined {
  const only = e.args[0]
  return e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output ? undefined : only.value
}

/** The callees whose result is decided at compile time: a conversion, `SIZEOF`, and the pure value functions. */
export function isConstantCallee(name: string): boolean {
  const upper = name.toUpperCase()
  // no target: as `convertedConstant` (6.B.5)
  return upper === "SIZEOF" || upper === "XSIZEOF" || BUILTIN_ARITY[upper] !== undefined || parseConversionName(upper, undefined) !== undefined
}
