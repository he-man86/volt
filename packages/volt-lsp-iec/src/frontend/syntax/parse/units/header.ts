/**
 * WHAT A UNIT'S HEADER HOLDS AFTER ITS NAME — the clauses more than one unit kind reads the same way: a return type,
 * and an IMPLEMENTS list (names through `names.ts`).
 */
import type { Identifier, TypeExpr } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { readHeaderNames } from "../names.js"
import { vendorTokenText } from "../errors.js"
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
 * Parse a header's optional `: ReturnType`, then eat an optional trailing `;` — a METHOD's, a FUNCTION's, and a
 * PROGRAM's (`PROGRAM P;` builds on both vendors, `unit_program_trailing_semicolon`; its return type is C0182's).
 * The `;` MUST be consumed or `collectVarSections` stops at it and drops every local.
 */
export function parseOptionalReturnType(c: Cursor): ReturnTypeClause {
  const clause = parseReturnTypeClause(c)
  c.eatPunct(";")
  return clause
}

/** An `IMPLEMENTS a, b` clause at the cursor (each name possibly qualified), or `undefined` when none stands there. */
export function readImplements(c: Cursor): Identifier[] | undefined {
  if (c.eatKeyword("IMPLEMENTS") === undefined) return undefined
  return readHeaderNames(c)
}

/**
 * An EXTENDS or IMPLEMENTS clause where the header no longer takes one — after a FUNCTION's return type, an
 * EXTENDS after an FB's IMPLEMENTS. Both vendors say "Unexpected token 'IMPLEMENTS' found" and "';' expected instead of
 * '<its first name>'" (`unit_function_implements`, `unit_function_extends_after_return`,
 * `unit_fb_implements_before_extends`, 2026-10-01); the clause is read past, so its names reach neither the
 * declarations nor the body. What the vendors say after that is their declaration recovery, each its own (conformance
 * 2.8.2).
 */
export function refuseLateClauses(c: Cursor): void {
  for (;;) {
    const kw = c.peek()
    if (kw.kind !== "keyword" || (kw.keyword !== "EXTENDS" && kw.keyword !== "IMPLEMENTS")) return
    c.pushError(`Unexpected token ${vendorTokenText(kw)} found`, kw.span, kw.text)
    c.consume()
    const next = c.peek()
    if (next.kind !== "eof") c.pushError(`';' expected instead of ${vendorTokenText(next)}`, next.span)
    readHeaderNames(c)
  }
}
