/**
 * References corpus: snapshot find-references at every identifier in
 * both the test POU AND the synthesized PLC_PRG.
 *
 * Cross-file references is the high-value addition: probing on a
 * POU's method declaration should now find the call site in
 * PLC_PRG. The dual-file workspace makes this exercise the actual
 * cross-document scan path (vs single-file scope, which always
 * misses external usages).
 *
 * `includeDeclaration: true` so the snapshot pins both decl + usage.
 *
 * Snapshot per test: list of `{file, text, line, char, count,
 * locations: [{uri, line, char}]}`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { references } from "../lsp/queries/references.js";
import { buildCorpusWorkspace } from "./_corpus-helpers.js";
import { ALL_TESTS } from "./index.js";

interface RefProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	count: number;
	locations: Array<{ uri: string; line: number; char: number }>;
}

function probeIdents(
	source: string,
	doc: Parameters<typeof references>[0]["doc"],
	project: Parameters<typeof references>[0]["project"],
	workspace: Parameters<typeof references>[0]["workspace"],
	tag: "pou" | "plc_prg",
): RefProbe[] {
	const out: RefProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const locs = references({
			workspace,
			doc,
			position,
			project,
			includeDeclaration: true,
		});
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			count: locs.length,
			locations: locs.map((l) => ({
				uri: l.uri.replace("file:///conformance/", ""),
				line: l.range.start.line,
				char: l.range.start.character,
			})),
		});
	}
	return out;
}

describe("references corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probeIdents(pouSource, pouDoc, project, ws, "pou"),
				...probeIdents(plcPrgSource, plcPrgDoc, project, ws, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
