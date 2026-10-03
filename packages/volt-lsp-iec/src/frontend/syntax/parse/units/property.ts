/**
 * `PROPERTY [Access] Name : DataType <accessors> END_PROPERTY`
 *
 * Properties have GET and/or SET inline accessors. Each accessor has
 * its own VAR sections and body, terminated by END_GET / END_SET.
 *
 * THE ACCESSOR BLOCK IS VOLT'S FORMAT (U16, frontend-conformance 2.10): in both IDEs a getter and a setter are objects
 * of their own, and the push (`StReader.ReadProperty`) reads `GET … END_GET`, or a BARE `GET` — present, empty, closed
 * at its own line. So an accessor the next GET/SET/END_PROPERTY closes is read to there (`collectAccessorBody` stops
 * WITHOUT consuming, so the outer loop dispatches on that keyword), and anything standing under it is refused by name:
 * the push would drop it. An accessor's declaration is the lines under its keyword line — its modifier stands on the
 * line under `GET`, as the pull writes it; one on the keyword's own line is refused the same way, and one under a bare
 * keyword is refused as code under it is. The push sees GET, SET, END_GET and END_SET only at the START of a line and
 * drops the rest of an accessor's keyword line, so each stands alone on its line (0 otherwise in the six corpora).
 */
import type { BodySpan, Property } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import type { Token } from "../../lex/tokens.js"
import { parseTypeExpression } from "../type-expr.js"
import { emptyType, refusedEmptyType } from "./header.js"
import { MEMBER_MODIFIERS, type Keyword } from "../../lex/vocabulary.js"
import { joinSpans } from "../../span.js"
import { vendorTokenText } from "../errors.js"
import { closesDeclaration, readFolderLine, reportMisplacedFolder } from "../../format/folder.js"
import { collectVarSections } from "../declarations.js"
import { identFromToken, readModifiers, readPropertyModifiers } from "../names.js"
import { collectAccessorBody } from "../body.js"

export function parseProperty(c: Cursor): Property | undefined {
  const start = c.expectKeyword("PROPERTY")
  if (start === undefined) return undefined

  // Modifiers before the name: an access level, then ONE of ABSTRACT/FINAL (e.g. `PROPERTY PUBLIC ABSTRACT Busy`), kept
  // as written — `readPropertyModifiers`.
  const modifiers = readPropertyModifiers(c)

  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const colon = c.expectPunct(":")
  if (colon === undefined) return undefined
  const dataType = refusedEmptyType(c, colon.span, ["GET", "SET", "END_PROPERTY"])
    ? emptyType(colon.span)
    : parseTypeExpression(c)
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
    c.pushError(`unexpected ${vendorTokenText(stray)} inside PROPERTY body`, stray.span)
    if (!c.recoverTo({ keywords: ["END_PROPERTY", "GET", "SET"] })) break
  }

  c.pushError("unterminated PROPERTY: expected END_PROPERTY", start.span)
  return {
    kind: "property",
    name,
    modifiers,
    ...(folder !== undefined ? { folder } : {}),
    dataType,
    ...(getter !== undefined ? { getter } : {}),
    ...(setter !== undefined ? { setter } : {}),
    span: joinSpans(start.span, dataType.span),
  }
}

/** The keywords the push reads an accessor by — each only at the START of a line (`StReader.LineStartsWithKeyword`). */
const ACCESSOR_KEYWORDS: readonly Keyword[] = ["GET", "SET", "END_GET", "END_SET"]

/** Refuse an accessor keyword that does not start its line: the push never sees it (`P := stored; END_GET` leaves the
 *  getter open, closed bare with its body dropped; `END_GET SET` never opens the setter, and a null setter is REMOVED). */
function refuseNotFirstOnLine(c: Cursor, kw: Token, before: Token): void {
  if (before === kw || before.span.endLine !== kw.span.startLine) return
  c.pushError(
    `'${kw.keyword}' does not start its line (after '${before.text}'): the push reads GET, SET, END_GET and END_SET only at the start of a line, so it would not see this one and the accessor's text is lost. Put '${kw.keyword}' on a line of its own.`,
    kw.span,
  )
}

function parseInlineAccessor(c: Cursor): Property["getter"] | undefined {
  const before = c.previous()
  const kw = c.eatAnyKeyword("GET", "SET")
  if (kw === undefined) return undefined
  refuseNotFirstOnLine(c, kw, before)
  const kind: "get" | "set" = kw.keyword === "GET" ? "get" : "set"
  // An accessor may carry its own access level + ABSTRACT/FINAL (`SET PRIVATE …`) before its
  // VAR sections — kept, so they don't leak into the accessor body and the formatter prints them back.
  const modifierTokens = readModifiers(c, MEMBER_MODIFIERS)
  const modifiers = modifierTokens.map((m) => m.keyword!)
  // The accessor's DECLARATION is every line under its keyword line, which the push drops whole: the pull writes the
  // modifier on the line under `GET` (`GET`, then `PUBLIC`, then `VAR …`), and one on the keyword's own line never reaches
  // the IDE.
  const onKeywordLine = modifierTokens.filter((m) => m.span.startLine === kw.span.startLine)
  const first = onKeywordLine[0]
  const last = onKeywordLine[onKeywordLine.length - 1]
  if (first !== undefined && last !== undefined)
    c.pushError(
      `'${kw.keyword} ${onKeywordLine.map((m) => m.keyword).join(" ")}': the push reads an accessor's modifier from the line under ${kw.keyword}, as the pull writes it, and drops ${kw.keyword}'s own line — it would reach the IDE as '${kw.keyword}'. Move the modifier to the next line.`,
      joinSpans(first.span, last.span),
    )
  else {
    // The rest of the keyword line is dropped whole (`ParseAccessor` strips it). An accessor keyword next on the line
    // refuses itself (`refuseNotFirstOnLine`), so it is not refused twice.
    const next = c.peek()
    if (next.kind !== "eof" && next.span.startLine === kw.span.endLine && !(next.keyword !== undefined && ACCESSOR_KEYWORDS.includes(next.keyword)))
      c.pushError(
        `'${next.text}' shares the line of '${kw.keyword}': the push drops the rest of an accessor's keyword line. Move it to the next line.`,
        next.span,
      )
  }
  const varSections = collectVarSections(c)
  const endAccessor: Keyword = kind === "get" ? "END_GET" : "END_SET"

  // Two acceptable termination patterns:
  //   1. Proper IEC-61131 form:  GET … END_GET   /  SET … END_SET
  //      We CONSUME the END_GET / END_SET as the accessor's closer.
  //   2. The BARE form: the next GET/SET/END_PROPERTY closes it.
  //      We STOP there WITHOUT consuming, so the outer parseProperty
  //      loop can dispatch on it — and refuse what stands under it,
  //      which the push drops (it closes a bare accessor at its own line).
  //
  // Don't replace this with `collectBodyUntilAny` — that always
  // consumes its ender, which would swallow the next accessor's
  // opening keyword and mis-parse the rest of the property.
  const { body, closed } = collectAccessorBody(c, endAccessor)
  if (closed) refuseNotFirstOnLine(c, c.previous(), c.previous(1))
  // A modifier under a bare keyword is as dropped as code: the push closes the accessor at its own line, and the
  // property's declaration ends before it, so that line belongs to nothing.
  const underIt = modifierTokens.length > onKeywordLine.length
  if (!closed && (underIt || body.tokens.some((t) => t.kind !== "whitespace" && t.kind !== "eof") || varSections.length > 0 || body.implementation !== undefined))
    c.pushError(
      `'${kw.keyword}' is not closed by '${endAccessor}': an accessor without its ${endAccessor} is bodiless, and the push drops what stands under it. Close it with ${endAccessor}.`,
      kw.span,
    )
  return {
    kind,
    modifiers,
    varSections,
    body,
    span: joinSpans(kw.span, body.span),
  }
}
