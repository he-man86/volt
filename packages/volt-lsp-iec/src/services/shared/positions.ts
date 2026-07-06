/**
 * Position math (Layer E · shared). Converts between our `Span` (1-based line / 0-based col + byte
 * offsets) and LSP `Range`/`Position` (0-based). ponytail: `Position.character` is treated as a byte
 * offset — correct for ASCII ST code (practically all PLC source); revisit only for multibyte identifiers.
 */
import type { Position, Range } from "vscode-languageserver-protocol"
import type { Span } from "../../syntax/index.js"

export function rangeFromSpan(span: Span): Range {
  return {
    start: { line: span.startLine - 1, character: span.startCol },
    end: { line: span.endLine - 1, character: span.endCol },
  }
}

/** LSP position → byte offset in `src`, or -1 if out of range. */
export function offsetFromPosition(src: string, pos: Position): number {
  let line = 0
  let col = 0
  for (let i = 0; i < src.length; i++) {
    if (line === pos.line && col === pos.character) return i
    if (src[i] === "\n") {
      line += 1
      col = 0
    } else {
      col += 1
    }
  }
  return line === pos.line && col === pos.character ? src.length : -1
}

export function spanContains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end
}
