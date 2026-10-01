/**
 * `METHOD [modifiers] Name [: ReturnType] [;]
 *  <var-sections>
 *  <body>
 *  END_METHOD`
 *
 * The modifiers (`MEMBER_MODIFIERS`) are kept in order as written. An access modifier stands only first: `PUBLIC FINAL`
 * builds, `FINAL PRIVATE` and `PUBLIC PRIVATE` are "Identifier expected instead of 'PRIVATE'" on both vendors — the
 * name was due there (`unit_method_final_private_order`, `unit_method_two_access`, 2026-10-01). A repeated modifier
 * is no error (`METHOD FINAL FINAL`, `unit_method_modifier_twice`).
 */
import type { Method } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { MEMBER_MODIFIERS, SOFT_NAME_KEYWORDS } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readModifiers, refusedAccessModifier } from "../names.js"
import { collectVarSections } from "../declarations.js"
import { parseOptionalReturnType } from "./header.js"

export function parseMethod(c: Cursor): Method | undefined {
  const start = c.expectKeyword("METHOD")
  if (start === undefined) return undefined

  // A modifier keyword is only a modifier if a name (or further modifiers) follow it. Otherwise it IS the method name —
  // e.g. `METHOD PROTECTED Override`, where `Override` (the OVERRIDE keyword) names the method. The `IMPLEMENTATION`
  // line is an identifier token but never a name: it ends the declaration, and a method with no return type and no VAR
  // puts it straight under the header (`METHOD PROTECTED Override`, then the line).
  const written = readModifiers(
    c,
    MEMBER_MODIFIERS,
    (after) =>
      (after.kind === "identifier" && !c.opensImplementationLine(1)) ||
      (after.kind === "keyword" &&
        after.keyword !== undefined &&
        // another modifier, or a keyword that is a name here (GET, SET, OVERRIDE — `SOFT_NAME_KEYWORDS`)
        (MEMBER_MODIFIERS.includes(after.keyword) || SOFT_NAME_KEYWORDS.has(after.keyword))),
  )
  const refused = refusedAccessModifier(written)
  if (refused !== undefined) c.pushError(`Identifier expected instead of '${refused.text}'`, refused.span)
  const modifiers = written.map((m) => m.keyword!)

  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const returnType = parseOptionalReturnType(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_METHOD", "method", "member")

  return {
    kind: "method",
    name,
    modifiers,
    ...returnType,
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
