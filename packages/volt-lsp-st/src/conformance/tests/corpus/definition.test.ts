/**
 * Definition corpus: snapshot go-to-definition at every identifier in
 * both the test POU AND the synthesized PLC_PRG.
 *
 * The cross-file probes are the high-value signal here — PLC_PRG's
 * call sites (`fb_inst.SomeMethod`) should resolve back to the POU's
 * method declaration. A regression in cross-file definition shows
 * up as the location's `uri` flipping to the wrong file or empty.
 *
 * Snapshot per test: list of `{file, text, line, char,
 * locations: [{uri, line, char}]}`.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { definition } from "../../../lsp/queries/definition.js";
import { buildCorpusWorkspace } from "../../_shared.js";
import { ALL_TESTS } from "../../fixtures/index.js";

interface DefProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	locations: Array<{ uri: string; line: number; char: number }>;
}

function probeIdents(
	source: string,
	doc: Parameters<typeof definition>[0]["doc"],
	project: Parameters<typeof definition>[0]["project"],
	tag: "pou" | "plc_prg",
): DefProbe[] {
	const out: DefProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const locs = definition({ doc, position, project });
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			// Strip the URI prefix (always file:///conformance/) to keep
			// snapshots focused on the cross-file routing signal.
			locations: locs.map((l) => ({
				uri: l.uri.replace("file:///conformance/", ""),
				line: l.range.start.line,
				char: l.range.start.character,
			})),
		});
	}
	return out;
}

describe("definition corpus (POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probeIdents(pouSource, pouDoc, project, "pou"),
				...probeIdents(plcPrgSource, plcPrgDoc, project, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
