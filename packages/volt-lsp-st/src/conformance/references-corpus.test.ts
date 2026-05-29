/**
 * References corpus: snapshot the find-references response at every
 * identifier token in every ST source from the conformance catalog.
 * Catches regressions where references stops finding a known usage
 * site, double-counts, or crashes.
 *
 * Single-file scope (workspace contains only the test's own document).
 * Cross-file references — the pattern `language.test.ts` uses via
 * `CROSS_TEST_DECLS` — is intentionally out of scope here; single-file
 * is the cleaner regression signal first.
 *
 * `includeDeclaration: true` so the snapshot pins the full
 * decl + usage shape, not just the usage subset.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { references } from "../lsp/queries/references.js";
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

interface RefProbe {
	text: string;
	line: number;
	char: number;
	count: number;
	locations: Array<{ line: number; char: number }>;
}

describe("references corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const doc = ws.getDocument(uri)!;
			const project = ws.getProjectScope();

			const probes: RefProbe[] = [];
			for (const tok of lex(t.source)) {
				if (tok.kind !== "identifier") continue;
				const position = {
					line: tok.span.startLine - 1,
					character: tok.span.startCol,
				};
				const locs = references({
					workspace: ws,
					doc,
					position,
					project,
					includeDeclaration: true,
				});
				probes.push({
					text: tok.text,
					line: position.line,
					char: position.character,
					count: locs.length,
					locations: locs.map((l) => ({
						line: l.range.start.line,
						char: l.range.start.character,
					})),
				});
			}
			expect(probes).toMatchSnapshot();
		});
	}
});
