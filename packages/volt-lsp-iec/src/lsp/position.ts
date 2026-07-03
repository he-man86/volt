/**
 * Conversions between our internal Span (1-based lines / 0-based cols
 * with byte offsets) and LSP's Position / Range (0-based lines and
 * characters).
 *
 * LSP `Position.character` is 0-based UTF-16 code units. We treat it
 * as a byte offset for now — wrong for multi-byte chars but correct
 * for ASCII-only ST code, which covers practically all real
 * declarations. If we ever see multi-byte identifiers in PLC code
 * (very rare), we'll revisit.
 */
import type { Span } from "../lexer/span.js";
import type { Position, Range } from "./types.js";

export function rangeFromSpan(span: Span): Range {
	return {
		start: { line: span.startLine - 1, character: span.startCol },
		end: { line: span.endLine - 1, character: span.endCol },
	};
}

/**
 * Translate an LSP position to a byte offset in the given source.
 * Returns -1 if the position is out of range.
 */
export function offsetFromPosition(src: string, pos: Position): number {
	let line = 0;
	let col = 0;
	for (let i = 0; i < src.length; i++) {
		if (line === pos.line && col === pos.character) return i;
		if (src[i] === "\n") {
			line += 1;
			col = 0;
		} else {
			col += 1;
		}
	}
	// EOF — only valid if the request is for end of file
	if (line === pos.line && col === pos.character) return src.length;
	return -1;
}
