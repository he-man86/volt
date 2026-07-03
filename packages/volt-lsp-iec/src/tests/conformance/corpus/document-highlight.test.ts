/**
 * Document-highlight corpus: snapshot highlight regions at every
 * identifier position in the POU and PLC_PRG. Single-file scope by
 * definition (the LSP method scans the cursor's own document).
 *
 * Snapshot per test: list of `{file, text, line, char, highlights:
 * [{kind, line, char}]}`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { documentHighlight } from "../../../lsp/queries/document-highlight.js";
import { buildCorpusWorkspace } from "../_shared.js";
import { ALL_TESTS } from "../fixtures/index.js";

interface HighlightProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	highlights: Array<{ kind: number | undefined; line: number; char: number }>;
}

function probe(
	source: string,
	doc: Parameters<typeof documentHighlight>[0]["doc"],
	tag: "pou" | "plc_prg",
): HighlightProbe[] {
	const out: HighlightProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const highlights = documentHighlight({ doc, position });
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			highlights: highlights.map((h) => ({
				kind: h.kind,
				line: h.range.start.line,
				char: h.range.start.character,
			})),
		});
	}
	return out;
}

describe("documentHighlight corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const probes = [
				...probe(pouSource, pouDoc, "pou"),
				...probe(plcPrgSource, plcPrgDoc, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
