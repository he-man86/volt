/**
 * Hover corpus: snapshot the hover response at every identifier and
 * keyword position in both the test POU AND the synthesized PLC_PRG.
 *
 * PLC_PRG hover probes (e.g. on `fb_inst.SomeMethod`) exercise
 * cross-file symbol resolution — the FB lives in one document, the
 * usage in another. This catches regressions where hover stops
 * resolving across file boundaries even when same-file resolution
 * still works.
 *
 * Snapshot per test: one consolidated array of `{file, text, line,
 * char, contents | null}`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { hover } from "../../../lsp/queries/hover.js";
import { buildCorpusWorkspace } from "../_shared.js";
import { ALL_TESTS } from "../fixtures/index.js";

interface HoverProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	contents: string | null;
}

function probeIdentsAndKeywords(
	source: string,
	doc: Parameters<typeof hover>[0]["doc"],
	project: Parameters<typeof hover>[0]["project"],
	tag: "pou" | "plc_prg",
): HoverProbe[] {
	const out: HoverProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier" && tok.kind !== "keyword") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const result = hover({ doc, position, project });
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			contents: result?.contents.value ?? null,
		});
	}
	return out;
}

describe("hover corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probeIdentsAndKeywords(pouSource, pouDoc, project, "pou"),
				...probeIdentsAndKeywords(plcPrgSource, plcPrgDoc, project, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
