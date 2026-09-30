/**
 * `FUNCTION Name [: ReturnType] <var-sections> <body> END_FUNCTION`
 *
 * Functions are stateless callables — no FB-level inheritance, no
 * methods of their own. The optional return-type clause uses the
 * same TypeExpr grammar as VAR declarations.
 */
import type { Function as FunctionAST, Identifier } from "../ast.js"
import type { Cursor } from "../cursor.js"
import { parseOptionalReturnType } from "../type-expr.js"
import { collectBodyUntil, collectVarSections, identFromToken, joinSpans } from "../util.js"

export function parseFunction(c: Cursor): FunctionAST | undefined {
  const start = c.expectKeyword("FUNCTION", "at start of FUNCTION")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent("for FUNCTION name")
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // A FUNCTION can neither EXTENDS nor IMPLEMENTS (only FBs do) — each clause is captured so the header is read whole
  // and a check answers as CODESYS does ("No definition found for base class" / C0145, conformance
  // `hdr_function_extends_no_return` / `_implements_no_return`) instead of the rest of the file falling into the body.
  // Both vendors read either clause where an FB's stands: straight after the name. A return type AFTER it
  // (`hdr_function_extends` / `_implements`) is read as one here; the vendors cascade from its `:` instead (a known
  // divergence — the LSP gives the clause's message and no message of its own).
  let extendsMisused: Identifier | undefined
  if (c.eatKeyword("EXTENDS") !== undefined) {
    const base = c.expectIdent("after EXTENDS")
    if (base !== undefined) extendsMisused = identFromToken(base)
  }
  let implementsMisused = readImplements(c)

  const returnType = parseOptionalReturnType(c)
  // …and after the return type, where this parser read it first (a position no recording measures yet).
  implementsMisused ??= readImplements(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_FUNCTION", "function", "pou-or-accessor")

  return {
    kind: "function",
    name,
    ...(returnType !== undefined ? { returnType } : {}),
    ...(implementsMisused !== undefined ? { implementsMisused } : {}),
    ...(extendsMisused !== undefined ? { extendsMisused } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}

/** An `IMPLEMENTS a, b` clause at the cursor, or `undefined` when none stands there. */
function readImplements(c: Cursor): Identifier[] | undefined {
  if (c.eatKeyword("IMPLEMENTS") === undefined) return undefined
  const names: Identifier[] = []
  const first = c.expectIdent("after IMPLEMENTS")
  if (first !== undefined) names.push(identFromToken(first))
  while (c.eatPunct(",") !== undefined) {
    const more = c.expectIdent("in IMPLEMENTS list")
    if (more === undefined) break
    names.push(identFromToken(more))
  }
  return names
}
