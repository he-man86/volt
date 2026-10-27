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
 * Under an accessor's %LANGUAGE line, and in its VAR blocks, GET and SET are NAMES (`SOFT_NAME_KEYWORDS`): a body
 * runs to its own END keyword (`collectAccessorBody`, openspec lsp-accessor-keyword-at-line-start).
 */
import type { Property, TypeExpr } from "../../ast/nodes/index.js"
import type { Cursor } from "../cursor.js"
import type { Token } from "../../lex/tokens.js"
import { parseTypeExpression } from "../type-expr.js"
import { emptyType } from "./header.js"
import { type Keyword } from "../../lex/vocabulary.js"
import { MEMBER_MODIFIERS } from "../../lex/word-sets.js"
import { joinSpans, type Span } from "../../span.js"
import { vendorTokenText } from "../errors.js"
import { acceptClosingRun, readPropertyRun, reportMisplacedProperty } from "../../format/object-properties.js"
import { collectVarSections } from "../declarations.js"
import { identFromToken, readModifiers, readPropertyModifiers } from "../names.js"
import { collectAccessorBody } from "../body.js"

/** The keywords that end a property header no type follows — the push never writes them into the declaration. */
const UNTYPED_CLOSERS: readonly Keyword[] = ["GET", "SET", "END_PROPERTY"]

/** The header ends where it stands: the body's %LANGUAGE line or one of `UNTYPED_CLOSERS` is next. */
function endsUntyped(c: Cursor): boolean {
  const next = c.peek()
  return c.opensLanguageLine() || (next.kind === "keyword" && UNTYPED_CLOSERS.includes(next.keyword!))
}

export function parseProperty(c: Cursor): Property | undefined {
  const start = c.expectKeyword("PROPERTY")
  if (start === undefined) return undefined

  // Modifiers before the name: an access level, then ONE of ABSTRACT/FINAL (e.g. `PROPERTY PUBLIC ABSTRACT Busy`), kept
  // as written — `readPropertyModifiers`.
  const modifiers = readPropertyModifiers(c)

  const nameTok = c.expectUnitName()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const dataType = parsePropertyType(c, nameTok)
  if (dataType === undefined) return undefined
  c.eatPunct(";") // some exports terminate the property data type with a trailing `;`

  const parts: PropertyParts = {}
  const node = (end: Span): Property => ({
    kind: "property",
    name,
    modifiers,
    ...(parts.folder !== undefined ? { folder: parts.folder } : {}),
    ...(parts.objectProperties !== undefined ? { objectProperties: parts.objectProperties } : {}),
    dataType,
    ...(parts.getter !== undefined ? { getter: parts.getter } : {}),
    ...(parts.setter !== undefined ? { setter: parts.setter } : {}),
    span: joinSpans(start.span, end),
  })

  while (!c.atEof()) {
    const endProp = c.eatKeyword("END_PROPERTY")
    if (endProp !== undefined) return node(endProp.span)
    if (!parsePropertyPart(c, parts)) break
  }

  c.pushError("unterminated PROPERTY: expected END_PROPERTY", start.span)
  return node(dataType.span)
}

/** What a property's body holds, read part by part (`parsePropertyPart`). */
interface PropertyParts {
  getter?: Property["getter"]
  setter?: Property["setter"]
  folder?: string
  objectProperties?: readonly string[]
  /** Its declaration's closing `%`-lines were read: a second run is misplaced. */
  closed?: boolean
}

/**
 * The property's type, after its name.
 *
 * A header ending at its NAME declares no type, as one ending at its colon does: the push writes both as sent (openspec
 * bridge-refusal-review 2.6) and the IDE builds the property without one. Read as the empty type, not as a header
 * that broke off, so the accessors under it stay the property's. The vendors' own answer to either shape is a cascade
 * over the declaration they synthesize for the getter (`rcc_property_no_type`, `rcc_property_empty_type`): a known
 * divergence, niche. The one message the LSP gives is that cascade's own, which BOTH builds give for each shape: the
 * synthesized declaration's first token, ';', where the colon or the type belongs — not the METHOD rule's "instead of
 * ''" (`refusedEmptyType`), which neither build says for a POU property.
 */
function parsePropertyType(c: Cursor, nameTok: Token): TypeExpr | undefined {
  const colon = c.eatPunct(":")
  const untyped = endsUntyped(c)
  if (untyped)
    c.pushError(
      colon === undefined ? "',, AT or :' expected instead of ';'" : "Type definition expected instead of ';'",
      (colon ?? nameTok).span,
    )
  else if (colon === undefined) {
    c.expectPunct(":")
    return undefined
  }
  return untyped ? emptyType((colon ?? nameTok).span) : parseTypeExpression(c)
}

/** The next part of a property's body into `parts` — false when nothing is left to resume the body at. */
function parsePropertyPart(c: Cursor, parts: PropertyParts): boolean {
  // A property's `%`-lines (its `%FOLDER` among them) close its declaration (`StWriter.AssembleProperty`): the last
  // lines before its first accessor, which is where the push reads them. Anywhere else the push refuses them.
  const run = readPropertyRun(c)
  if (run.length > 0) {
    if (!parts.closed && parts.getter === undefined && parts.setter === undefined) {
      const read = acceptClosingRun(c, run, ["GET", "SET", "END_PROPERTY"], false, true)
      if (read?.folder !== undefined) parts.folder = read.folder
      if (read !== undefined && read.properties.length > 0) parts.objectProperties = read.properties
      parts.closed = true
    } else for (const line of run) reportMisplacedProperty(c, line)
    return true
  }
  const accessor = parseInlineAccessor(c)
  if (accessor !== undefined) {
    if (accessor.kind === "get") parts.getter = accessor
    else parts.setter = accessor
    return true
  }
  // Unknown content inside PROPERTY — record and skip to next anchor
  const stray = c.peek()
  c.pushError(`unexpected ${vendorTokenText(stray)} inside PROPERTY body`, stray.span)
  return c.recoverTo({ keywords: ["END_PROPERTY", "GET", "SET"] })
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
    if (
      next.kind !== "eof" &&
      next.span.startLine === kw.span.endLine &&
      !(next.keyword !== undefined && ACCESSOR_KEYWORDS.includes(next.keyword))
    )
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
  //   2. The BARE form: before any %LANGUAGE line, the next GET/SET/END_PROPERTY closes it
  //      (under that line a GET/SET is an operand, and only END_PROPERTY or the other END stops it — not closed).
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
  if (
    !closed &&
    (underIt ||
      body.tokens.some((t) => t.kind !== "whitespace" && t.kind !== "eof") ||
      varSections.length > 0 ||
      body.languageLine !== undefined)
  )
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
