/**
 * Source span — byte offsets + 1-based line / 0-based column for both
 * endpoints. We carry line/column eagerly so the LSP doesn't have to
 * rescan the source to translate offsets to LSP positions on every
 * query. The cost (two ints per token) is trivial compared to the
 * lookup-on-demand alternative.
 *
 * `end` is exclusive — `text.slice(start, end)` reconstructs the token.
 */
export interface Span {
	start: number;
	end: number;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
}

export function spanFromOffsets(
	src: string,
	start: number,
	end: number,
): Span {
	const [startLine, startCol] = lineColAt(src, start);
	const [endLine, endCol] = lineColAt(src, end);
	return { start, end, startLine, startCol, endLine, endCol };
}

/** 1-based line, 0-based column at byte offset. Newline-aware. */
function lineColAt(src: string, offset: number): [number, number] {
	let line = 1;
	let col = 0;
	for (let i = 0; i < offset && i < src.length; i++) {
		if (src[i] === "\n") {
			line += 1;
			col = 0;
		} else {
			col += 1;
		}
	}
	return [line, col];
}
