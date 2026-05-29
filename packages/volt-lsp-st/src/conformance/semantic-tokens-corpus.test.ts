/**
 * Semantic-tokens corpus: snapshot the decoded token classification for
 * every ST construct in the conformance catalog. Catches regressions
 * where the classifier silently re-labels a construct (e.g. starts
 * treating a keyword as an identifier or vice versa).
 *
 * Position-free: runs the query on whole `source`. Snapshot stores the
 * decoded (line, char, length, type) tuple list — readable in a diff,
 * unlike the raw delta-encoded integer array LSP emits over the wire.
 */
import { describe, expect, it } from "bun:test";
import { semanticTokens, TOKEN_TYPES } from "../lsp/queries/semantic-tokens.js";
import { Workspace } from "../lsp/workspace.js";
import { ALL_TESTS, type LanguageTest } from "./index.js";

const KIND_EXT: Record<LanguageTest["kind"], string> = {
	function_block: "st",
	function: "st",
	program: "st",
	gvl: "gvl",
	structure: "dut",
	interface: "itf",
};

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
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const result = semanticTokens({
				source: t.source,
				project: ws.getProjectScope(),
				docUri: uri,
			});
			expect(decode(result.data)).toMatchSnapshot();
		});
	}
});
