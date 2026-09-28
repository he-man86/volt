/**
 * Small parser utilities shared across modules. Kept separate from
 * `cursor.ts` so the cursor stays focused on token positioning.
 */
import type { Keyword, Token } from "./tokens.js"
import type { Span } from "./span.js"
import type { BodySpan, Identifier, VarSection } from "./ast.js"
import type { Cursor } from "./cursor.js"
// Inherent recursive-descent recursion: util's block helpers call into var-section, which calls back into util. Function-body imports, no init hazard.
import { atVarSection, parseVarSection } from "./var-section.js"
import { type BodyOwner, folderOn, splitImplementation } from "./implementation-keyword.js"

/** Build a span covering the source range from `a.start` to `b.end`. */
export function joinSpans(a: Span, b: Span): Span {
  return {
    start: a.start,
    end: b.end,
    startLine: a.startLine,
    startCol: a.startCol,
    endLine: b.endLine,
    endCol: b.endCol,
  }
}

/** Convert an identifier token into an Identifier AST node. */
export function identFromToken(tok: Token): Identifier {
  return { kind: "identifier", text: tok.text, span: tok.span }
}

/** Eat a run of member modifiers and return them as written, in order — the printer needs every one back. */
export function eatModifiers(c: Cursor, allowed: readonly Keyword[]): Keyword[] {
  const out: Keyword[] = []
  for (let m = c.eatAnyKeyword(...allowed); m?.keyword !== undefined; m = c.eatAnyKeyword(...allowed)) out.push(m.keyword)
  return out
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
export function readFolderLine(c: Cursor): FolderLine | undefined {
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
export function closesDeclaration(c: Cursor, closers: readonly Keyword[], blankLinesOnly: boolean): boolean {
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
export function reportMisplacedFolder(c: Cursor, line: FolderLine): void {
  c.pushError(
    `'${line.text}' is no folder the push reads here. A %FOLDER line stands directly under a method's or an action's ` +
      "IMPLEMENTATION line, or as the last line of a property's or an interface member's declaration — spelled " +
      "`%FOLDER <path>`, alone on its line; anywhere else the push refuses it. Move it there, or remove it.",
    line.span,
  )
}

/**
 * Build a BodySpan from a list of tokens. Falls back to `fallback`
 * span if the list is empty.
 */
export function bodySpanFromTokens(tokens: Token[], fallback: Span): BodySpan {
  if (tokens.length === 0) {
    return { kind: "body", tokens, span: fallback }
  }
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  return { kind: "body", tokens, span: joinSpans(first.span, last.span) }
}

/**
 * A POU body from the tokens a unit parser collected: its `IMPLEMENTATION <LANG>` line taken out and recorded, the
 * code left as the body (`splitImplementation`), and every problem with the line reported on the parse cursor — the
 * one place a POU body is built, so no unit kind can skip the line.
 */
export function codeBody(c: Cursor, tokens: Token[], fallback: Span, owner: BodyOwner): BodySpan {
  const { tokens: code, implementation } = splitImplementation(tokens, owner, (message, span) => c.pushError(message, span))
  const body = bodySpanFromTokens(code, fallback)
  return implementation === undefined ? body : { ...body, implementation }
}

/**
 * Consume as many consecutive VAR sections as appear at the cursor.
 * Used by every POU-shape parser — FB, PROGRAM, FUNCTION, METHOD —
 * after the header, before the body.
 */
export function collectVarSections(c: Cursor): VarSection[] {
  const sections: VarSection[] = []
  while (atVarSection(c)) {
    const s = parseVarSection(c)
    if (s !== undefined) sections.push(s)
    else break
  }
  return sections
}

/**
 * Collect tokens until the named END_* keyword, consume it, return a
 * BodySpan. The terminator is consumed so the outer parser sees the
 * next unit cleanly.
 */
export function collectBodyUntil(c: Cursor, ender: Keyword, context: string, owner: BodyOwner): BodySpan {
  return collectBodyUntilAny(c, [ender], context, owner)
}

/**
 * Same as <see cref="collectBodyUntil"/> but accepts multiple acceptable
 * terminators. Used by inline property accessors where either
 * END_GET/END_SET or an implicit close (next GET/SET/END_PROPERTY)
 * can terminate the body.
 */
export function collectBodyUntilAny(c: Cursor, enders: readonly Keyword[], context: string, owner: BodyOwner): BodySpan {
  const startSpan = c.peek().span
  const { tokens, closer } = c.consumeBodyUntilAny({ consumeEnders: enders })
  if (closer !== undefined) {
    return codeBody(c, tokens, joinSpans(startSpan, closer.span), owner)
  }
  c.pushError(`unterminated ${context}: expected ${enders.join(" or ")}`, startSpan)
  return codeBody(c, tokens, startSpan, owner)
}

/** Human-readable description of a token for error messages. */
export function describeToken(t: Token): string {
  if (t.kind === "eof") return "end of input"
  if (t.kind === "keyword") return `keyword '${t.keyword ?? t.text}'`
  if (t.kind === "identifier") return `identifier '${t.text}'`
  if (t.kind === "punct") return `'${t.text}'`
  return `${t.kind} '${t.text}'`
}
