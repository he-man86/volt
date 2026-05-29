/**
 * Completion corpus: snapshot completion items at member-access
 * positions (right after every `.` punctuation token) for every ST
 * source from the conformance catalog. Member completion is the
 * highest-signal context — completion lists are deterministic per
 * (target type, accessible members).
 *
 * Statement-level completion (column 0 of body lines) is intentionally
 * out of scope for this corpus — it returns the same generic
 * top-level set everywhere and produces no useful regression signal.
 *
 * Snapshot per test: list of `{line, char, labels[]}` keyed by each
 * member-access site. Tests without any `.` token snapshot as `[]`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { completion } from "../lsp/queries/completion.js";
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

interface CompletionProbe {
	line: number;
	char: number;
	labels: string[];
}

describe("completion corpus (member access at every '.' position)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const doc = ws.getDocument(uri)!;
			const project = ws.getProjectScope();

			const probes: CompletionProbe[] = [];
			for (const tok of lex(t.source)) {
				if (tok.kind !== "punct" || tok.text !== ".") continue;
				// Position just after the dot — that's where member
				// completion fires (start of the would-be member name).
				const position = {
					line: tok.span.endLine - 1,
					character: tok.span.endCol,
				};
				const items = completion({
					doc,
					position,
					project,
					activeVendor: "twincat",
				});
				probes.push({
					line: position.line,
					char: position.character,
					labels: items.map((it) => it.label).sort(),
				});
			}
			expect(probes).toMatchSnapshot();
		});
	}
});
