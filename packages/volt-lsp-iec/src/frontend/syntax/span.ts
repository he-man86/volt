/**
 * Source span — byte offsets + 1-based line / 0-based column for both endpoints.
 * Line/column are carried eagerly so the LSP never rescans source to translate
 * offsets to positions. `end` is exclusive — `src.slice(start, end)` reconstructs.
 *
 * Ownership: `syntax/` owns Span. Everything imports it down; nobody redefines it.
 */
export interface Span {
  start: number
  end: number
  startLine: number
  startCol: number
  endLine: number
  endCol: number
}

/** Build a span covering the source range from `a.start` to `b.end` — the one span joiner. */
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

/** The empty span at one position — where an end-of-input sentinel or an absent thing stands. */
export function pointSpan(offset: number, line: number, col: number): Span {
  return { start: offset, end: offset, startLine: line, startCol: col, endLine: line, endCol: col }
}

/** The empty span right after `after` ends — an end-of-input sentinel behind a token slice. */
export function eofSpan(after: Span): Span {
  return pointSpan(after.end, after.endLine, after.endCol)
}

/** The empty span at the very start of a source — for a sentinel where there is no token to stand behind. */
export function zeroSpan(): Span {
  return pointSpan(0, 1, 0)
}

/** True when `offset` falls inside `span` — start inclusive, end exclusive, as a cursor sits. */
export function spanContains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end
}

// ─── Line ends in RAW text — for the code that reads the source string, not the tokens (openspec lsp-field-false-positives
// 8, class 2). The lexer reads every line end as one (`lex`: a lone CR is an LF, offset for offset), as the push reads
// the text (`StReader.LfLines`) and as an LSP client counts lines (LF, CRLF, CR). Anything that splits, counts or
// searches lines in the raw text asks here, so a lone CR is a line end everywhere the lexer says it is. ─────────────────

/** Whether `source[i]` ends a line: an LF, or a CR that no LF follows (a lone CR). The CR of a CRLF is the last
 *  character of its line, as the lexer counts columns. */
export function endsLineAt(source: string, i: number): boolean {
  const c = source.charCodeAt(i)
  return c === 10 || (c === 13 && source.charCodeAt(i + 1) !== 10)
}

/** The offset the line holding `offset` starts at — just past the last line end before it. */
export function lineStartOf(source: string, offset: number): number {
  let i = Math.min(offset, source.length)
  while (i > 0 && !endsLineAt(source, i - 1)) i--
  return i
}

/** The 1-based line and 0-based column of `offset` (UTF-16 units, as a JS index), counted as the lexer counts them. */
export function lineColAt(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++)
    if (endsLineAt(source, i)) {
      line++
      lineStart = i + 1
    }
  return { line, col: offset - lineStart }
}

/** The line break a document writes, for text inserted into it: CRLF where it holds one, else LF where it holds one,
 *  else a lone CR where it holds one; LF for a text of one line. */
export function lineBreakOf(source: string): string {
  if (source.includes("\r\n")) return "\r\n"
  if (source.includes("\n") || !source.includes("\r")) return "\n"
  return "\r"
}

/** The raw text's lines, without their line ends — every line end one, as `endsLineAt` reads it. */
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/)
}
