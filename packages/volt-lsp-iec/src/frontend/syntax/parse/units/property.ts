/**
 * `PROPERTY [Access] Name : DataType <accessors> END_PROPERTY`
 *
 * Properties have GET and/or SET inline accessors. Each accessor has
 * its own VAR sections and body, terminated by END_GET / END_SET.
 *
 * Sloppy termination: many IDE exports omit END_GET/END_SET and let
 * the next GET/SET/END_PROPERTY implicitly close the prior accessor.
 * `collectAccessorBody` handles both forms — when it sees a peek
 * stopper it returns WITHOUT consuming so the outer property loop
 * can dispatch on the next keyword.
 */
import type { BodySpan, Property } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { parseTypeExpression } from "../type-expr.js"
import { PROPERTY_MODIFIERS, type Keyword } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { plainTokenText } from "../errors.js"
import { closesDeclaration, readFolderLine, reportMisplacedFolder } from "../../format/folder.js"
import { collectVarSections } from "../declarations.js"
import { identFromToken, readModifiers } from "../names.js"
import { collectAccessorBody } from "../body.js"

/** What may stand before a property's name, and before an accessor's VAR sections (`SET PRIVATE …`). */

export function parseProperty(c: Cursor): Property | undefined {
  const start = c.expectKeyword("PROPERTY")
  if (start === undefined) return undefined

  // Modifiers before the name, in any order: an access level plus optional ABSTRACT/FINAL
  // (e.g. `PROPERTY PUBLIC ABSTRACT Busy`). Keep the access level; ABSTRACT/FINAL are eaten but unused.
  let accessModifier: Keyword | undefined
  const modifiers = readModifiers(c, PROPERTY_MODIFIERS).map((m) => m.keyword!)
  for (const m of modifiers)
    if (m === "PUBLIC" || m === "PRIVATE" || m === "PROTECTED" || m === "INTERNAL") accessModifier = m

  const nameTok = c.expectName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined
  const dataType = parseTypeExpression(c)
  if (dataType === undefined) return undefined
  c.eatPunct(";") // some exports terminate the property data type with a trailing `;`

  let getter: Property["getter"]
  let setter: Property["setter"]
  let folder: string | undefined

  while (!c.atEof()) {
    const endProp = c.eatKeyword("END_PROPERTY")
    if (endProp !== undefined) {
      return {
        kind: "property",
        name,
        ...(accessModifier !== undefined ? { accessModifier } : {}),
        modifiers,
        ...(folder !== undefined ? { folder } : {}),
        dataType,
        ...(getter !== undefined ? { getter } : {}),
        ...(setter !== undefined ? { setter } : {}),
        span: joinSpans(start.span, endProp.span),
      }
    }
    // A property in a sub-folder closes its declaration with `%FOLDER <path>` (`StWriter.AssembleProperty`): the
    // last line before its first accessor, which is where the push reads it. Anywhere else the push refuses it.
    const directive = readFolderLine(c)
    if (directive !== undefined) {
      const closing =
        directive.path !== undefined &&
        folder === undefined &&
        getter === undefined &&
        setter === undefined &&
        closesDeclaration(c, ["GET", "SET", "END_PROPERTY"], false)
      if (closing) folder = directive.path
      else reportMisplacedFolder(c, directive)
      continue
    }
    const accessor = parseInlineAccessor(c)
    if (accessor !== undefined) {
      if (accessor.kind === "get") getter = accessor
      else setter = accessor
      continue
    }
    // Unknown content inside PROPERTY — record and skip to next anchor
    const stray = c.peek()
    c.pushError(`unexpected ${plainTokenText(stray)} inside PROPERTY body`, stray.span)
    if (!c.recoverTo({ keywords: ["END_PROPERTY", "GET", "SET"] })) break
  }

  c.pushError("unterminated PROPERTY: expected END_PROPERTY", start.span)
  return {
    kind: "property",
    name,
    ...(accessModifier !== undefined ? { accessModifier } : {}),
    modifiers,
    ...(folder !== undefined ? { folder } : {}),
    dataType,
    ...(getter !== undefined ? { getter } : {}),
    ...(setter !== undefined ? { setter } : {}),
    span: joinSpans(start.span, dataType.span),
  }
}

function parseInlineAccessor(c: Cursor): Property["getter"] | undefined {
  const kw = c.eatAnyKeyword("GET", "SET")
  if (kw === undefined) return undefined
  const kind: "get" | "set" = kw.keyword === "GET" ? "get" : "set"
  // An accessor may carry its own access level + ABSTRACT/FINAL (`SET PRIVATE …`) before its
  // VAR sections — kept, so they don't leak into the accessor body and the formatter prints them back.
  const modifiers = readModifiers(c, PROPERTY_MODIFIERS).map((m) => m.keyword!)
  const varSections = collectVarSections(c)
  const endAccessor: Keyword = kind === "get" ? "END_GET" : "END_SET"

  // Two acceptable termination patterns:
  //   1. Proper IEC-61131 form:  GET … END_GET   /  SET … END_SET
  //      We CONSUME the END_GET / END_SET as the accessor's closer.
  //   2. Sloppy form (some IDE exports omit END_GET/END_SET and let
  //      the next GET/SET/END_PROPERTY implicitly close the prior):
  //      We STOP at the next GET/SET/END_PROPERTY WITHOUT consuming,
  //      so the outer parseProperty loop can dispatch on it.
  //
  // Don't replace this with `collectBodyUntilAny` — that always
  // consumes its ender, which would swallow the next accessor's
  // opening keyword and mis-parse the rest of the property.
  const body = collectAccessorBody(c, endAccessor)
  return {
    kind,
    modifiers,
    varSections,
    body,
    span: joinSpans(kw.span, body.span),
  }
}
