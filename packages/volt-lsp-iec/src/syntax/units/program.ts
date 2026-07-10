/**
 * `PROGRAM Name <var-sections> <body> END_PROGRAM`
 *
 * No modifiers, no extends/implements — programs are top-level
 * entry points and don't participate in the FB inheritance graph.
 */
import type { Program } from "../ast.js"
import type { Cursor } from "../cursor.js"
import { parseTypeExpression } from "../type-expr.js"
import { collectBodyUntil, collectVarSections, identFromToken, joinSpans } from "../util.js"

export function parseProgram(c: Cursor): Program | undefined {
  const start = c.expectKeyword("PROGRAM", "at start of PROGRAM")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent("for PROGRAM name")
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  // A return type on a PROGRAM (`PROGRAM P : BOOL`) is illegal — capture it so a check can emit C0182
  // (rather than letting the `: <type>` fall into the body collector).
  let returnType: Program["returnType"]
  if (c.eatPunct(":") !== undefined) returnType = parseTypeExpression(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_PROGRAM", "program")

  return {
    kind: "program",
    name,
    ...(returnType !== undefined ? { returnType } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
