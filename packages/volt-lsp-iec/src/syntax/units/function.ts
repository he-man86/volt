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

  const returnType = parseOptionalReturnType(c)

  // A FUNCTION cannot IMPLEMENTS an interface (only FBs do) — capture the illegal clause so a check can emit
  // C0145 instead of it silently vanishing into the opaque body.
  let implementsMisused: Identifier[] | undefined
  if (c.eatKeyword("IMPLEMENTS") !== undefined) {
    implementsMisused = []
    const first = c.expectIdent("after IMPLEMENTS")
    if (first !== undefined) implementsMisused.push(identFromToken(first))
    while (c.eatPunct(",") !== undefined) {
      const more = c.expectIdent("in IMPLEMENTS list")
      if (more === undefined) break
      implementsMisused.push(identFromToken(more))
    }
  }

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_FUNCTION", "function")

  return {
    kind: "function",
    name,
    ...(returnType !== undefined ? { returnType } : {}),
    ...(implementsMisused !== undefined ? { implementsMisused } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
