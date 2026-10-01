/**
 * `FUNCTION Name [: ReturnType] <var-sections> <body> END_FUNCTION`
 *
 * Functions are stateless callables — no FB-level inheritance, no
 * methods of their own. The optional return-type clause uses the
 * same TypeExpr grammar as VAR declarations.
 */
import type { Function as FunctionAST, Identifier } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readHeaderName } from "../names.js"
import { collectVarSections } from "../declarations.js"
import { parseOptionalReturnType, readImplements, refuseLateClauses } from "./header.js"

export function parseFunction(c: Cursor): FunctionAST | undefined {
  const start = c.expectKeyword("FUNCTION")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // A FUNCTION can neither EXTENDS nor IMPLEMENTS (only FBs do) — each clause is captured so the header is read whole
  // and a check answers as CODESYS does ("No definition found for base class" / C0145, conformance
  // `hdr_function_extends_no_return` / `_implements_no_return`) instead of the rest of the file falling into the body.
  // Both vendors read either clause where an FB's stands: straight after the name, and NOWHERE ELSE — after the return
  // type (`FUNCTION F : INT IMPLEMENTS I`) it is "Unexpected token 'IMPLEMENTS' found" (`unit_function_implements`,
  // `unit_function_extends_after_return`, both vendors 2026-10-01), which the body parser says of it. A return type
  // AFTER the clause (`hdr_function_extends` / `_implements`) is read as one here; the vendors cascade from its `:`
  // instead (a known divergence — the LSP gives the clause's message and no message of its own).
  let extendsMisused: Identifier | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) extendsMisused = readHeaderName(c)
  const implementsMisused = readImplements(c)

  const returnType = parseOptionalReturnType(c)
  refuseLateClauses(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_FUNCTION", "function", "pou-or-accessor")

  return {
    kind: "function",
    name,
    ...returnType,
    ...(implementsMisused !== undefined ? { implementsMisused } : {}),
    ...(extendsMisused !== undefined ? { extendsMisused } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
