/**
 * Top-level parser.
 *
 * Entry point: `parse(tokens)` → `ParseResult`. Dispatches on the
 * first non-trivia keyword to the matching unit parser in `units/`.
 * Each unit parses its header, its VAR sections, then captures the
 * body as opaque tokens up to the matching END_*.
 *
 * Body capture rationale: we deliberately don't parse statement
 * trees — bodies are kept as opaque token spans. Later passes
 * (identifier-reference collection, diagnostics, call-hierarchy
 * scanning) walk them without re-lexing. Per
 * [[feedback-no-fallbacks-single-source]] the IDE compiler remains
 * authoritative for statement-level semantics.
 *
 * Files in the mirrored workspace typically contain one top-level
 * unit. We support more than one defensively, but a file with
 * stray tokens between units records an error and skips to the
 * next dispatch keyword.
 */
import { lex } from "./lexer.js"
import type { Dialect, Keyword, Token } from "./tokens.js"
import type { ParseResult, TopLevel } from "./ast.js"
import { Cursor } from "./cursor.js"
import { parseAction } from "./units/action.js"
import { parseFunction } from "./units/function.js"
import { parseFunctionBlock } from "./units/function-block.js"
import { parseGlobalVarList } from "./units/global-var-list.js"
import { parseInterface } from "./units/interface.js"
import { parseMethod } from "./units/method.js"
import { parseNamespace } from "./units/namespace.js"
import { parseProgram } from "./units/program.js"
import { parseProperty } from "./units/property.js"
import { parseTypeDecl } from "./units/type-decl.js"
import { describeToken, readFolderLine, reportMisplacedFolder } from "./util.js"
import { unitBodies } from "./bodies.js"
import { opensKeywordLine, reportReservedNames, reportRetiredComments } from "./implementation-keyword.js"
import { isTrivia } from "./tokens.js"
import { isWrittenAsSent, OPENING_KEYWORDS, sourceObjectOf, type SourceObject } from "./source-object.js"

/**
 * Convenience wrapper — parse source text directly. `dialect` is the lexer's vocabulary; see `lex`. `object` is what
 * the file holds when it is a workspace file (`sourceObjectOf`); text that is no workspace file passes none.
 */
export function parseSource(src: string, dialect: Dialect = "codesys", object?: SourceObject): ParseResult {
  return parse(lex(src, dialect), object)
}

/** A WORKSPACE FILE, read as the object its extension names (`source-object.ts`). */
export function parseDocument(uri: string, src: string, dialect: Dialect = "codesys"): ParseResult {
  return parseSource(src, dialect, sourceObjectOf(uri))
}

/** Parse a stream of tokens into one or more top-level units. */
export function parse(tokens: readonly Token[], object?: SourceObject): ParseResult {
  // A DUT or a GVL whose text does not OPEN with its keyword declares nothing, and the IDE says nothing about it
  // (`source-object.ts`): there is no declaration to read and no error to give.
  if (isWrittenAsSent(object)) {
    const first = tokens.find((t) => !isTrivia(t.kind))
    if (first?.keyword === undefined || !OPENING_KEYWORDS[object].includes(first.keyword))
      return { units: [], errors: [], failedDeclarations: [] }
  }
  const c = new Cursor(tokens)
  const units: TopLevel[] = []

  while (!c.atEof()) {
    // A `%FOLDER` line at file scope: no Volt writes one there (a member's folder stands under its IMPLEMENTATION line
    // or closes its declaration), and the push reads it as the next item's declaration text and refuses it. Consumed
    // whole and reported once — left unhandled it would desync the file (the following members mis-parse as strays).
    const directive = readFolderLine(c)
    if (directive !== undefined) {
      reportMisplacedFolder(c, directive)
      continue
    }
    const unit = parseTopLevel(c)
    if (unit !== undefined) {
      units.push(unit)
    } else {
      // Unrecognized token at file scope — record + skip to a
      // known dispatch keyword to keep going.
      const stray = c.peek()
      if (stray.kind === "eof") break
      c.pushError(`unexpected ${describeToken(stray)} at file scope`, stray.span)
      c.recoverTo({ keywords: TOP_LEVEL_DISPATCH })
      if (c.peek().kind === "eof") break
    }
  }

  // The file format's POU rules — a DUT's or a GVL's text is written as sent and claims none of them
  if (!isWrittenAsSent(object)) {
    reportReservedNames(tokens, claimedKeywordLines(units), (message, span) => c.pushError(message, span))
    reportRetiredComments(tokens, (message, span) => c.pushError(message, span))
  }
  return { units, errors: c.getErrors(), failedDeclarations: c.getFailedDeclarations() }
}

/** The `IMPLEMENTATION` tokens the body splitter owns — each body's boundary keyword, and every keyword opening a line
 *  of its shape inside a body, which the splitter reports as a second line — so the reserved-name rule does not report
 *  the same line again as a name. By offset: a body's tokens are the stream's own objects, but the offset says it
 *  without relying on that. */
function claimedKeywordLines(units: readonly TopLevel[]): (t: Token) => boolean {
  const at = new Set<number>()
  const visit = (unit: TopLevel): void => {
    if (unit.kind === "namespace") return unit.units.forEach(visit)
    for (const body of unitBodies(unit)) {
      const keyword = body.implementation?.words[0]
      if (keyword !== undefined) at.add(keyword.span.start)
      body.tokens.forEach((t, i) => opensKeywordLine(body.tokens, i) && at.add(t.span.start))
    }
  }
  units.forEach(visit)
  return (t) => at.has(t.span.start)
}

const TOP_LEVEL_DISPATCH: readonly Keyword[] = [
  "FUNCTION_BLOCK",
  "PROGRAM",
  "FUNCTION",
  "METHOD",
  "ACTION",
  "PROPERTY",
  "INTERFACE",
  "TYPE",
  "VAR_GLOBAL",
  "VAR_CONFIG",
  "NAMESPACE",
]

/**
 * Dispatch on the next keyword. Returns `undefined` only when the
 * cursor doesn't sit on a top-level dispatch keyword — the caller is
 * responsible for error recovery in that case.
 *
 * Exported because `units/namespace.ts` recurses into us — it accepts
 * a `parseInner` callback to break the import cycle.
 */
export function parseTopLevel(c: Cursor): TopLevel | undefined {
  const next = c.peek()
  if (next.kind !== "keyword") return undefined
  switch (next.keyword) {
    case "FUNCTION_BLOCK":
      return parseFunctionBlock(c)
    case "PROGRAM":
      return parseProgram(c)
    case "FUNCTION":
      return parseFunction(c)
    case "METHOD":
      return parseMethod(c)
    case "ACTION":
      return parseAction(c)
    case "PROPERTY":
      return parseProperty(c)
    case "INTERFACE":
      return parseInterface(c)
    case "TYPE":
      return parseTypeDecl(c)
    case "NAMESPACE":
      return parseNamespace(c, parseTopLevel)
    case "VAR_GLOBAL":
    case "VAR_CONFIG":
      // VAR_CONFIG is the IEC address-binding block; same outer
      // shape as a GVL file (single section + END_VAR), so we
      // route through the same parser. The captured VarSection
      // preserves its sectionKind so downstream consumers can
      // distinguish.
      return parseGlobalVarList(c)
    default:
      return undefined
  }
}
