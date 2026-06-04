/**
 * Selection-range corpus: snapshot the smart-expand range hierarchy at
 * every identifier position in the POU. One batched call per file
 * (selectionRanges takes an array of positions). The result is a list
 * of linked `SelectionRange` chains — each chain expands outward from
 * the cursor.
 *
 * Snapshot per test: `{pou, plc_prg}` each carrying an array of
 * `{at, ranges: [{startLine, startChar, endLine, endChar}, ...]}`.
 * Flattens the linked-list `parent` chain into a flat array for
 * readability in the diff.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { selectionRanges } from "../../../lsp/queries/selection-range.js";
import type { SelectionRange } from "../../../lsp/types.js";
import { buildCorpusWorkspace } from "../../_shared.js";
import { ALL_TESTS } from "../../fixtures/index.js";

function flatten(r: SelectionRange | undefined): Array<{
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
}> {
	const out: ReturnType<typeof flatten> = [];
	let cur: SelectionRange | undefined = r;
	while (cur !== undefined) {
		out.push({
			startLine: cur.range.start.line,
			startChar: cur.range.start.character,
			endLine: cur.range.end.line,
			endChar: cur.range.end.character,
		});
		cur = cur.parent;
	}
	return out;
}

function probe(
	source: string,
	doc: Parameters<typeof selectionRanges>[0]["doc"],
): Array<{ line: number; char: number; ranges: ReturnType<typeof flatten> }> {
	const positions: Array<{ line: number; character: number }> = [];
	const tokenStarts: Array<{ line: number; char: number }> = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const p = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		positions.push(p);
		tokenStarts.push({ line: p.line, char: p.character });
	}
	if (positions.length === 0) return [];
	const ranges = selectionRanges({ doc, positions });
	return tokenStarts.map((t, i) => ({
		line: t.line,
		char: t.char,
		ranges: flatten(ranges[i]),
	}));
}

describe("selectionRange corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			expect({
				pou: probe(pouSource, pouDoc),
				plc_prg: probe(plcPrgSource, plcPrgDoc),
			}).toMatchSnapshot();
		});
	}
});
