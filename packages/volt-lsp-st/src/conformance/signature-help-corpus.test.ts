/**
 * Signature-help corpus: snapshot signatureHelp response just after
 * every `IDENT(` token sequence in both the test POU AND the
 * synthesized PLC_PRG (built from `plcPrgVar` + `plcPrgBody`).
 *
 * Most catalog tests put the call site in `plcPrgBody` (e.g.
 * `fb_inst.SomeMethod();`); probing only the POU misses the bulk of
 * them. The dual-file workspace mirrors how the recorder feeds TC.
 *
 * Snapshot per test: list of `{file, callee, line, char, label,
 * activeParameter}`. The `file` field distinguishes POU call sites
 * from PLC_PRG ones.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../lexer/lexer.js";
import { signatureHelp } from "../lsp/queries/signature-help.js";
import { buildCorpusWorkspace } from "./_corpus-helpers.js";
import { ALL_TESTS } from "./index.js";

interface SigProbe {
	file: "pou" | "plc_prg";
	callee: string;
	line: number;
	char: number;
	label: string | null;
	activeParameter: number | null;
}

function probeCallSites(
	source: string,
	doc: Parameters<typeof signatureHelp>[0]["doc"],
	project: Parameters<typeof signatureHelp>[0]["project"],
	tag: "pou" | "plc_prg",
): SigProbe[] {
	const out: SigProbe[] = [];
	const tokens = lex(source);
	for (let i = 0; i < tokens.length - 1; i++) {
		const id = tokens[i]!;
		if (id.kind !== "identifier") continue;
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
		out.push({
			file: tag,
			callee: id.text,
			line: position.line,
			char: position.character,
			label: sig?.label ?? null,
			activeParameter: result?.activeParameter ?? null,
		});
	}
	return out;
}

describe("signatureHelp corpus (every call site — POU + PLC_PRG)", () => {
	for (const t of ALL_TESTS) {
		it(t.name, () => {
			const { ws, pouDoc, pouSource, plcPrgDoc, plcPrgSource } = buildCorpusWorkspace(t);
			const project = ws.getProjectScope();
			const probes = [
				...probeCallSites(pouSource, pouDoc, project, "pou"),
				...probeCallSites(plcPrgSource, plcPrgDoc, project, "plc_prg"),
			];
			expect(probes).toMatchSnapshot();
		});
	}
});
