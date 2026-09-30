/**
 * WHAT A UNIT'S HEADER HOLDS AFTER ITS NAME — the clauses more than one unit kind reads the same way: a return type,
 * and an IMPLEMENTS list (names through `names.ts`).
 */
import type { Identifier, TypeExpr } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { readIdent, readNameList } from "../names.js"
import { parseTypeExpression } from "../type-expr.js"

/** A header's return-type clause, as the unit node spreads it: the type, or that one was written and refused, or neither. */
export type ReturnTypeClause = { returnType: TypeExpr } | { returnTypeRefused: true } | Record<string, never>

/** A `: ReturnType` at the cursor, or nothing when no `:` stands there. */
export function parseReturnTypeClause(c: Cursor): ReturnTypeClause {
  if (c.eatPunct(":") === undefined) return {}
  const returnType = parseTypeExpression(c)
  return returnType !== undefined ? { returnType } : { returnTypeRefused: true }
}

/**
 * Parse a METHOD/FUNCTION header's optional `: ReturnType`, then eat an optional trailing `;`.
 * The `;` MUST be consumed or `collectVarSections` stops at it and drops every local.
 */
export function parseOptionalReturnType(c: Cursor): ReturnTypeClause {
  const clause = parseReturnTypeClause(c)
  c.eatPunct(";")
  return clause
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
