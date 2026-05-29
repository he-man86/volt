/**
 * Hover corpus: snapshot the hover response at every identifier and
 * keyword position in every ST source from the conformance catalog.
 * Catches regressions where hover stops resolving a known symbol,
 * returns wrong info for a keyword, or crashes on any documented ST
 * construct.
 *
 * One consolidated snapshot per test (list of {text, line, char,
 * contents | null}). One snapshot per token would explode the snapshot
 * file (~10k entries); the list form keeps it ~193 entries while still
 * pinpointing which token's hover regressed via the position fields.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { hover } from "../lsp/queries/hover.js";
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

interface HoverProbe {
	text: string;
	line: number;
	char: number;
	contents: string | null;
}

describe("hover corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const doc = ws.getDocument(uri)!;
			const project = ws.getProjectScope();

			const probes: HoverProbe[] = [];
			for (const tok of lex(t.source)) {
				if (tok.kind !== "identifier" && tok.kind !== "keyword") continue;
				const position = {
					line: tok.span.startLine - 1,
					character: tok.span.startCol,
				};
				const result = hover({ doc, position, project });
				probes.push({
					text: tok.text,
					line: position.line,
					char: position.character,
					contents: result?.contents.value ?? null,
				});
			}
			expect(probes).toMatchSnapshot();
		});
	}
});
