/**
 * WHAT A UNIT'S HEADER HOLDS AFTER ITS NAME — the clauses more than one unit kind reads the same way: a return type,
 * and an IMPLEMENTS list (names through `names.ts`).
 */
import type { Identifier, TypeExpr } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { readIdent, readNameList } from "../names.js"
import { parseTypeExpression } from "../type-expr.js"

/**
 * Parse a METHOD/FUNCTION header's optional `: ReturnType`, then eat an optional trailing `;`.
 * The `;` MUST be consumed or `collectVarSections` stops at it and drops every local.
 */
export function parseOptionalReturnType(c: Cursor): TypeExpr | undefined {
  let returnType: TypeExpr | undefined
  if (c.eatPunct(":") !== undefined) returnType = parseTypeExpression(c)
  c.eatPunct(";")
  return returnType
}

/** An `IMPLEMENTS a, b` clause at the cursor, or `undefined` when none stands there. */
export function readImplements(c: Cursor): Identifier[] | undefined {
  if (c.eatKeyword("IMPLEMENTS") === undefined) return undefined
  const names: Identifier[] = []
  const first = readIdent(c)
  if (first !== undefined) names.push(first)
  names.push(...readNameList(c, () => readIdent(c)))
  return names
}
