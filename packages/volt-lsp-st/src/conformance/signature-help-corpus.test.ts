/**
 * Signature-help corpus: snapshot the signature-help response just
 * after every `(` that follows an identifier — i.e., every call site
 * in every ST source from the conformance catalog. Catches regressions
 * where signature help stops resolving a callee or returns the wrong
 * parameter list.
 *
 * Picker: scan lex tokens for the pattern `identifier '('` and probe
 * the position immediately after the `(`. Snapshot per test: list of
 * `{callee, line, char, label, activeParameter}` per call site.
 * Tests without any call sites snapshot as `[]`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { signatureHelp } from "../lsp/queries/signature-help.js";
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

interface SigProbe {
	callee: string;
	line: number;
	char: number;
	label: string | null;
	activeParameter: number | null;
}

describe("signatureHelp corpus (every call site)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const uri = `file:///conformance/${t.pouName}.${KIND_EXT[t.kind]}`;
			const ws = new Workspace();
			ws.openDocument(uri, t.source, 1);
			const doc = ws.getDocument(uri)!;
			const project = ws.getProjectScope();

			const tokens = lex(t.source);
			const probes: SigProbe[] = [];
			for (let i = 0; i < tokens.length - 1; i++) {
				const id = tokens[i]!;
				if (id.kind !== "identifier") continue;
				// Look past any trivia for a `(`.
				let j = i + 1;
				while (
					j < tokens.length &&
					(tokens[j]!.kind === "whitespace" ||
						tokens[j]!.kind === "line_comment" ||
						tokens[j]!.kind === "block_comment")
				) {
					j++;
				}
				const next = tokens[j];
				if (next === undefined || next.kind !== "punct" || next.text !== "(") continue;
				const position = {
					line: next.span.endLine - 1,
					character: next.span.endCol,
				};
				const result = signatureHelp({ doc, position, project });
				const sig = result?.signatures?.[result.activeSignature ?? 0];
				probes.push({
					callee: id.text,
					line: position.line,
					char: position.character,
					label: sig?.label ?? null,
					activeParameter: result?.activeParameter ?? null,
				});
			}
			expect(probes).toMatchSnapshot();
		});
	}
});
