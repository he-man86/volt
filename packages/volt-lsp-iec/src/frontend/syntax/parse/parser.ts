/**
 * THE FILE PARSER — `parseSource` / `parseDocument` / `parse` → `ParseResult`.
 *
 * Dispatches on each unit starter (`UNIT_STARTERS`) to its unit parser in `units/`. A unit parses its header and its
 * VAR sections, then collects its body's tokens up to the matching END_* (`body.ts`); a body's statements are parsed on
 * demand, once (`body-parse.ts`). After the units, the file format's POU rules run over the whole token stream
 * (`format/`): the reserved name and the retired comments.
 *
 * A workspace file holds one unit; more are read (a conformance fixture packs several). A stray token between units is
 * reported and the parse resumes at the next unit starter.
 */
import { lex } from "../lex/lexer.js"
import type { Token } from "../lex/tokens.js"
import type { ParseResult, TopLevel } from "../ast/nodes.js"
import { Cursor } from "./cursor.js"
import { parseAction } from "./units/action.js"
import { parseFunction } from "./units/function.js"
import { parseFunctionBlock } from "./units/function-block.js"
import { parseGlobalVarList } from "./units/global-var-list.js"
import { parseInterface } from "./units/interface.js"
import { parseMethod } from "./units/method.js"
import { parseNamespace, reportNamespaceClosers } from "./units/namespace.js"
import { parseProgram } from "./units/program.js"
import { parseProperty } from "./units/property.js"
import { parseTypeDecl } from "./units/type-decl.js"
import { unitBodies } from "../format/bodies.js"
import { allUnits } from "../ast/walk.js"
import { opensKeywordLine, readNoNetworkText } from "../format/implementation-line.js"
import { isTrivia } from "../lex/tokens.js"
import { attachAttributes } from "../pragmas/attributes.js"
import { isWrittenAsSent, OPENING_KEYWORDS, sourceObjectOf, type SourceObject } from "../format/source-object.js"
import { UNIT_STARTERS, type Dialect, type UnitStarter } from "../lex/vocabulary.js"
import { plainTokenText } from "./errors.js"
import { readFolderLine, reportMisplacedFolder } from "../format/folder.js"
import { reportRetiredComments } from "../format/retired-comments.js"
import { reportReservedNames } from "../format/reserved-names.js"

/**
 * How a parse reads what the text does not decide.
 *
 *   networkText   whether a body stated `IMPLEMENTATION LD|FBD` is read as network text. The front-end reads no
 *                 environment (openspec frontend-conformance P5): the product's switch is the SERVER's
 *                 (`server/config.ts`), which passes `false` unless development turned network text on. It is the
 *                 CALLER's fact and every parse is told it — required, never defaulted: a default here once turned
 *                 network text on for every script and the transpiler, which had read it off.
 */
export interface ParseOptions {
  networkText: boolean
}

/**
 * Convenience wrapper — parse source text directly. `dialect` is the lexer's vocabulary; see `lex`. `object` is what
 * the file holds when it is a workspace file (`sourceObjectOf`); text that is no workspace file passes none.
 */
export function parseSource(src: string, options: ParseOptions, dialect: Dialect = "codesys", object?: SourceObject): ParseResult {
  return parse(lex(src, dialect), dialect, options, object)
}

/** A WORKSPACE FILE, read as the object its extension names (`source-object.ts`). */
export function parseDocument(uri: string, src: string, options: ParseOptions, dialect: Dialect = "codesys"): ParseResult {
  return parseSource(src, options, dialect, sourceObjectOf(uri))
}

/** Parse a stream of tokens into one or more top-level units. `dialect` is the vocabulary `tokens` were lexed with. */
export function parse(tokens: readonly Token[], dialect: Dialect, options: ParseOptions, object?: SourceObject): ParseResult {
  // Refused by name, not filled in: an untyped caller (a script) that forgets it would otherwise get one reading silently.
  if (typeof options?.networkText !== "boolean")
    throw new Error("parse: ParseOptions.networkText is required — whether LD/FBD bodies are network text is the caller's fact")
  // A DUT or a GVL whose text does not OPEN with its keyword declares nothing, and the IDE says nothing about it
  // (`source-object.ts`): there is no declaration to read and no error to give.
  if (isWrittenAsSent(object)) {
    const first = tokens.find((t) => !isTrivia(t.kind))
    if (first?.keyword === undefined || !OPENING_KEYWORDS[object].includes(first.keyword))
      return { units: [], errors: [], failedDeclarations: [], tokens, dialect }
  }
  const c = new Cursor(tokens, dialect)
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
      c.pushError(`unexpected ${plainTokenText(stray)} at file scope`, stray.span)
      c.recoverTo({ keywords: UNIT_STARTERS })
      if (c.peek().kind === "eof") break
    }
  }

  // The file format's POU rules — a DUT's or a GVL's text is written as sent and claims none of them
  if (!isWrittenAsSent(object)) {
    reportReservedNames(tokens, claimedKeywordLines(units), (message, span) => c.pushError(message, span))
    reportRetiredComments(tokens, (message, span) => c.pushError(message, span))
  }
  // a POU's END_NAMESPACE is the push's refusal (rule U28; `reportNamespaceClosers` says where it is not reported)
  if (object === "pou") reportNamespaceClosers(units, (message, span) => c.pushError(message, span))
  if (!options.networkText) for (const unit of allUnits(units)) unitBodies(unit).forEach(readNoNetworkText)
  attachAttributes(units, tokens)
  return { units, errors: c.getErrors(), failedDeclarations: c.getFailedDeclarations(), tokens, dialect }
}

/** The `IMPLEMENTATION` tokens the body splitter owns — each body's boundary keyword, and every keyword opening a line
 *  of its shape inside a body, which the splitter reports as a second line — so the reserved-name rule does not report
 *  the same line again as a name. By offset: a body's tokens are the stream's own objects, but the offset says it
 *  without relying on that. */
function claimedKeywordLines(units: readonly TopLevel[]): (t: Token) => boolean {
  const at = new Set<number>()
  for (const unit of allUnits(units))
    for (const body of unitBodies(unit)) {
      const keyword = body.implementation?.words[0]
      if (keyword !== undefined) at.add(keyword.span.start)
      body.tokens.forEach((t, i) => opensKeywordLine(body.tokens, i) && at.add(t.span.start))
    }
  return (t) => at.has(t.span.start)
}

/**
 * Each unit starter's parser — the top-level dispatch IS this table, so a starter without a parser is a type error.
 * VAR_CONFIG is the IEC address-binding block: the same outer shape as a GVL file (one section + END_VAR), read by the
 * same parser, its `sectionKind` kept so consumers can tell the two apart.
 */
const UNIT_PARSERS: Readonly<Record<UnitStarter, (c: Cursor) => TopLevel | undefined>> = {
  FUNCTION_BLOCK: parseFunctionBlock,
  PROGRAM: parseProgram,
  FUNCTION: parseFunction,
  METHOD: parseMethod,
  ACTION: parseAction,
  PROPERTY: parseProperty,
  INTERFACE: parseInterface,
  TYPE: parseTypeDecl,
  VAR_GLOBAL: parseGlobalVarList,
  VAR_CONFIG: parseGlobalVarList,
  VAR_ACCESS: parseGlobalVarList,
  NAMESPACE: (c) => parseNamespace(c, parseTopLevel),
}

const isUnitStarter = (k: string | undefined): k is UnitStarter => k !== undefined && (UNIT_STARTERS as readonly string[]).includes(k)

/**
 * Dispatch on the next keyword. Returns `undefined` only when the cursor doesn't sit on a unit starter — the caller is
 * responsible for error recovery in that case. `units/namespace.ts` recurses into it through a `parseInner` callback.
 */
export function parseTopLevel(c: Cursor): TopLevel | undefined {
  const next = c.peek()
  if (next.kind !== "keyword" || !isUnitStarter(next.keyword)) return undefined
  return UNIT_PARSERS[next.keyword](c)
}
