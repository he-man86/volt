/**
 * Implementation corpus: snapshot the go-to-implementation response
 * at every identifier in both the POU and PLC_PRG. Useful signal is
 * concentrated on interface-method references — these should resolve
 * to the implementing FB's method body (cross-file).
 *
 * Snapshot per test: list of `{file, text, line, char, locations:
 * [{uri, line, char}]}`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { implementation } from "../../../lsp/queries/implementation.js";
import { buildCorpusWorkspace } from "../_shared.js";
import { ALL_TESTS } from "../fixtures/index.js";

interface ImplProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	locations: Array<{ uri: string; line: number; char: number }>;
}

function probe(
	source: string,
	doc: Parameters<typeof implementation>[0]["doc"],
	project: Parameters<typeof implementation>[0]["project"],
	workspace: Parameters<typeof implementation>[0]["workspace"],
	tag: "pou" | "plc_prg",
): ImplProbe[] {
	const out: ImplProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const locs = implementation({ workspace, doc, position, project });
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			locations: locs.map((l) => ({
				uri: l.uri.replace("file:///conformance/", ""),
				line: l.range.start.line,
				char: l.range.start.character,
			})),
		});
	}
	return out;
}

describe("implementation corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probe(pouSource, pouDoc, project, ws, "pou"),
				...probe(plcPrgSource, plcPrgDoc, project, ws, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
