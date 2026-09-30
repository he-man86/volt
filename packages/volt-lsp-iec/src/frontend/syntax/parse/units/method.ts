/**
 * `METHOD <stacked-modifiers> Name [: ReturnType]
 *  <var-sections>
 *  <body>
 *  END_METHOD`
 *
 * Stacked modifiers (in any order): access (PUBLIC/PRIVATE/PROTECTED/
 * INTERNAL), FINAL, ABSTRACT, OVERRIDE.
 *
 * The April 2026 regression anchor: every order combination must
 * parse cleanly — the modifier loop accepts them in any sequence and
 * sets the corresponding flag. Don't reorder the keyword list in
 * `eatAnyKeyword` without re-running the stacked-modifier corpus.
 */
import type { Method } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { collectBodyUntil } from "../body.js"
import { MEMBER_MODIFIERS } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { identFromToken, readModifiers } from "../names.js"
import { collectVarSections } from "../declarations.js"
import { parseOptionalReturnType } from "./header.js"

export function parseMethod(c: Cursor): Method | undefined {
  const start = c.expectKeyword("METHOD")
  if (start === undefined) return undefined

  let accessModifier: Method["accessModifier"]
  let isFinal = false
  let isAbstract = false
  let isOverride = false
  // A modifier keyword is only a modifier if a name (or further modifiers) follow it. Otherwise it IS the method name —
  // e.g. `METHOD PROTECTED Override`, where `Override` (the OVERRIDE keyword) names the method. The `IMPLEMENTATION`
  // line is an identifier token but never a name: it ends the declaration, and a method with no return type and no VAR
  // puts it straight under the header (`METHOD PROTECTED Override`, then the line).
  const modifiers = readModifiers(
    c,
    MEMBER_MODIFIERS,
    (after) =>
      (after.kind === "identifier" && !c.opensImplementationLine(1)) ||
      (after.kind === "keyword" &&
        ((after.keyword !== undefined && MEMBER_MODIFIERS.includes(after.keyword)) ||
          after.keyword === "GET" ||
          after.keyword === "SET")),
  )
  for (const mod of modifiers) {
    if (
      mod.keyword === "PUBLIC" ||
      mod.keyword === "PRIVATE" ||
      mod.keyword === "PROTECTED" ||
      mod.keyword === "INTERNAL"
    ) {
      accessModifier = mod.keyword
    } else if (mod.keyword === "FINAL") {
      isFinal = true
    } else if (mod.keyword === "ABSTRACT") {
      isAbstract = true
    } else if (mod.keyword === "OVERRIDE") {
      isOverride = true
    }
  }

  const nameTok = c.expectName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const returnType = parseOptionalReturnType(c)

  const varSections = collectVarSections(c)
  const body = collectBodyUntil(c, "END_METHOD", "method", "member")

  return {
    kind: "method",
    name,
    ...(accessModifier !== undefined ? { accessModifier } : {}),
    ...(isFinal ? { final: true } : {}),
    ...(isAbstract ? { abstract: true } : {}),
    ...(isOverride ? { override: true } : {}),
    ...(returnType !== undefined ? { returnType } : {}),
    varSections,
    body,
    span: joinSpans(start.span, body.span),
  }
}
