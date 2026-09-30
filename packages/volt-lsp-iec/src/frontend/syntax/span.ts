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
