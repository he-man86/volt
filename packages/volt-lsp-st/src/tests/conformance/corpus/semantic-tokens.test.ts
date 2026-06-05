/**
 * Semantic-tokens corpus: snapshot the decoded token classification for
 * every ST construct in the conformance catalog. Catches regressions
 * where the classifier silently re-labels a construct (e.g. starts
 * treating a keyword as an identifier or vice versa).
 *
 * Position-free: targets the POU's URI only. PLC_PRG is also in the
 * workspace (via the shared helper) but its tokens aren't snapshotted
 * — every test's PLC_PRG is structurally similar and would add noise
 * without signal.
 */
import { describe, expect, it } from "bun:test";
import { semanticTokens, TOKEN_TYPES } from "../../../lsp/queries/semantic-tokens.js";
import { buildCorpusWorkspace } from "../_shared.js";
import { ALL_TESTS } from "../fixtures/index.js";

interface DecodedToken {
	line: number;
	char: number;
	length: number;
	type: string;
}

function decode(data: readonly number[]): DecodedToken[] {
	const out: DecodedToken[] = [];
	let line = 0;
	let start = 0;
	for (let i = 0; i < data.length; i += 5) {
		const dLine = data[i]!;
		const dStart = data[i + 1]!;
		const length = data[i + 2]!;
		const typeIdx = data[i + 3]!;
		line += dLine;
		start = dLine === 0 ? start + dStart : dStart;
		out.push({ line, char: start, length, type: TOKEN_TYPES[typeIdx]! });
	}
	return out;
}

describe("semanticTokens corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouUri, pouSource } = buildCorpusWorkspace(t);
			const result = semanticTokens({
				source: pouSource,
				project: ws.getProjectScope(),
				docUri: pouUri,
			});
			expect(decode(result.data)).toMatchSnapshot();
		});
	}
});
