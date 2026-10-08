/**
 * Library namespaces: a library's FUNCTION named through its namespace.
 */

import type { Lowering } from "../core/lowering.js"
import type { Expr } from "../../../frontend/syntax/index.js"
import { findChildScope, lookup, type Scope } from "../../../frontend/symbols/index.js"

/** The library NAMESPACE a call's base names — `Stu` in `Stu.StrTrimA(…)` — as its scope, or undefined. */
export function namespaceOf(lw: Lowering, base: Expr): Scope | undefined {
  if (base.kind !== "ident_expr" || lookup(lw.scope, base.name)?.symbol.kind !== "namespace") return undefined
  return findChildScope(lw.project, base.name)
}
