/**
 * Definition corpus: snapshot go-to-definition response at every
 * identifier token in every ST source from the conformance catalog.
 * Catches regressions where definition stops resolving a known symbol
 * or returns the wrong target.
 *
 * Each identifier token gets a probe. Non-resolving identifiers
 * (free names like keywords-misused-as-idents, or external symbols
 * we don't know about) snapshot as empty locations — equally part of
 * the contract.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { definition } from "../lsp/queries/definition.js";
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

interface DefProbe {
	text: string;
	line: number;
	char: number;
	locations: Array<{ line: number; char: number }>;
}

describe("definition corpus (every conformance test)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const doc = ws.getDocument(uri)!;
			const project = ws.getProjectScope();

			const probes: DefProbe[] = [];
			for (const tok of lex(t.source)) {
				if (tok.kind !== "identifier") continue;
				const position = {
					line: tok.span.startLine - 1,
					character: tok.span.startCol,
				};
				const locs = definition({ doc, position, project });
				probes.push({
					text: tok.text,
					line: position.line,
					char: position.character,
					// Drop uri (always equals the test's own uri) and end position;
					// the (line, char) of the definition's start is the signal.
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
