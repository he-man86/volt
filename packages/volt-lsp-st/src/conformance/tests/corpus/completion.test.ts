/**
 * Completion corpus: snapshot completion items at every member-access
 * position (right after every `.`) in both the test POU AND the
 * synthesized PLC_PRG (built from `plcPrgVar` + `plcPrgBody`).
 *
 * Cross-file workspace mirrors what the recorder does to drive TC —
 * most catalog tests put the call/access in `plcPrgBody`, so probing
 * only the POU misses the majority of real call sites. Probing
 * PLC_PRG too gets ~80% coverage; the remaining tests genuinely have
 * no `.` in either file and snapshot as `[]`.
 *
 * Snapshot per test: list of `{file, line, char, labels[]}`. The
 * `file` field distinguishes POU probes from PLC_PRG probes so a
 * regression in one file's resolution stands out.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import { completion } from "../../../lsp/queries/completion.js";
import { buildCorpusWorkspace, PLC_PRG_URI } from "../../_shared.js";
import { ALL_TESTS } from "../../fixtures/index.js";

interface CompletionProbe {
	file: "pou" | "plc_prg";
	line: number;
	char: number;
	labels: string[];
}

function probeDots(
	source: string,
	doc: Parameters<typeof completion>[0]["doc"],
	project: Parameters<typeof completion>[0]["project"],
	tag: "pou" | "plc_prg",
): CompletionProbe[] {
	const out: CompletionProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "punct" || tok.text !== ".") continue;
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
		out.push({
			file: tag,
			line: position.line,
			char: position.character,
			labels: items.map((it) => it.label).sort(),
		});
	}
	return out;
}

describe("completion corpus (member access — POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			void PLC_PRG_URI; // exported for cross-file location stability
			const probes = [
				...probeDots(pouSource, pouDoc, project, "pou"),
				...probeDots(plcPrgSource, plcPrgDoc, project, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
