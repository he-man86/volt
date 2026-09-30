/**
 * `%FOLDER <path>` — the Volt file format's folder directive (openspec frontend-conformance P8, rules FMT5/FMT6). Where
 * the push reads one: on the line directly under a METHOD's or an ACTION's `IMPLEMENTATION` line (`peelFolder`), or as
 * the last line of a property's or an interface member's declaration (`closesDeclaration`); anywhere else it is
 * reported (`reportMisplacedFolder`).
 */
import type { Span } from "../span.js"
import type { Token } from "../lex/tokens.js"
import type { Keyword } from "../lex/vocabulary.js"
import { joinSpans } from "../span.js"
import { lineAround } from "./lines.js"

/** What reading a `%FOLDER` line needs of the parse cursor — the cursor itself satisfies it. */
export interface FolderCursor {
  peek(offset?: number): Token
  consume(): Token
  triviaAhead(): readonly Token[]
  consumeRestOfLine(): Token[]
  pushError(message: string, span: Span): void
}

// The directive as the push reads it (`StReader.FolderOn`): the trimmed line opens with `%FOLDER ` — that case, one
// space — and a path follows.
const FOLDER_LINE = /^\s*%FOLDER (.*\S)\s*$/

/** The folder a whole line states as the push reads it (`StReader.FolderOn`), or undefined — the one spelling of the
 *  directive, for a member's body (`peelFolder`) and a declaration's closing line (`readFolderLine`) alike. */
function folderOn(line: string): string | undefined {
  return FOLDER_LINE.exec(line)?.[1]?.trim()
}

/**
 * The `%FOLDER <path>` directive on the line DIRECTLY under a member's keyword line — `code` opens with the token
 * holding the newline that ends the keyword line — as its path and the index of the token that ends its line; or
 * undefined. Exactly where the push peels it (`StReader.PeelFolderUnder`) and nowhere else: not after a blank line
 * or a comment, not in another case, not without a path. Anywhere the push does not peel it, it pushes the line into
 * the IDE as code — so the LSP must leave it in the body, where the parser reports it, not read a folder the push
 * will not.
 */
export function peelFolder(code: readonly Token[]): { path: string; end: number } | undefined {
  const newline = code[0]
  // Only indentation may follow the keyword line's newline in its token: a second newline is a blank line.
  if (newline?.kind !== "whitespace" || newline.text.slice(newline.text.indexOf("\n") + 1).includes("\n")) return undefined
  if (code.length < 2 || code[1]!.kind === "eof") return undefined
  const { text, end } = lineAround(code, 1)
  const path = folderOn(text)
  return path === undefined ? undefined : { path, end }
}

/** A `%FOLDER` line the parser met in a declaration: the line as written, its path when it is the push's spelling
 *  (`folderOn`) and opens its own line, and where it stands. */
export interface FolderLine {
  text: string
  path: string | undefined
  span: Span
}

/**
 * The `%FOLDER` line at the cursor, consumed whole, or undefined when the cursor is not at one. Consumed whatever it
 * says, so a misplaced or misspelled one is reported once (`reportMisplacedFolder`) instead of mis-parsing as strays.
 * `path` is set only for a line the push would read as a folder: `%FOLDER <path>` in that case, first on its line.
 * Whether it stands where the push reads one is the caller's to say (`closesDeclaration`).
 */
export function readFolderLine(c: FolderCursor): FolderLine | undefined {
  const p = c.peek()
  if (p.kind !== "punct" || p.text !== "%") return undefined
  if (c.peek(1).kind !== "identifier" || c.peek(1).text.toUpperCase() !== "FOLDER") return undefined
  const before = c
    .triviaAhead()
    .map((t) => t.text)
    .join("")
  const nl = before.lastIndexOf("\n")
  const opensLine = nl >= 0 ? /^[ \t]*$/.test(before.slice(nl + 1)) : p.span.startCol === 0
  c.consume() // %
  const rest = c.consumeRestOfLine()
  const text = "%" + rest.map((t) => t.text).join("")
  const last = rest.at(-1)?.span ?? p.span
  return { text: text.trim(), path: opensLine ? folderOn(text) : undefined, span: joinSpans(p.span, last) }
}

/**
 * Does the declaration the cursor is in close HERE — only whitespace, then one of `closers`? That is where the push
 * peels a property's or an interface member's `%FOLDER` (`StReader.PeelFolderClosing`: the last line of the
 * declaration). `blankLinesOnly` is the interface method's stricter reading: its declaration is trimmed of empty lines
 * only (`TrimEnd('\n')`), so a line of spaces between the directive and `END_METHOD` keeps it from being the last.
 */
export function closesDeclaration(c: FolderCursor, closers: readonly Keyword[], blankLinesOnly: boolean): boolean {
  const trivia = c.triviaAhead()
  if (trivia.some((t) => t.kind !== "whitespace")) return false
  const next = c.peek()
  if (next.kind !== "keyword" || next.keyword === undefined || !closers.includes(next.keyword)) return false
  if (!blankLinesOnly) return true
  const between = trivia.map((t) => t.text).join("")
  return /^[\r\n]*$/.test(between.slice(0, between.lastIndexOf("\n") + 1))
}

/** A `%FOLDER` line where the push reads no folder: it would reach the IDE as declaration text, so the push refuses it
 *  (`StReader.RefuseLinesInDeclarations`) — and the LSP reports it, on the line. */
export function reportMisplacedFolder(c: FolderCursor, line: FolderLine): void {
  c.pushError(
    `'${line.text}' is no folder the push reads here. A %FOLDER line stands directly under a method's or an action's ` +
      "IMPLEMENTATION line, or as the last line of a property's or an interface member's declaration — spelled " +
      "`%FOLDER <path>`, alone on its line; anywhere else the push refuses it. Move it there, or remove it.",
    line.span,
  )
}
