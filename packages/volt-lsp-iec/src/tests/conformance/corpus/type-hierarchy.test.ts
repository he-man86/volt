/**
 * Type-hierarchy corpus: snapshot prepare + supertypes + subtypes for
 * every identifier in the POU and PLC_PRG. Same three-step shape as
 * call-hierarchy:
 *
 *   1. prepareTypeHierarchy(pos) -> items[]   (types at the cursor)
 *   2. supertypes(item)           -> EXTENDS chain
 *   3. subtypes(item)             -> derived FBs
 *
 * Per probe snapshots the prepared name + its supertype/subtype name
 * lists. Catches regressions in EXTENDS-chain walking and the reverse
 * "who EXTENDS me" scan.
 */
import { describe, expect, it } from "bun:test";
import { lex } from "../../../lexer/lexer.js";
import {
	prepareTypeHierarchy,
	subtypes,
	supertypes,
	type TypeHierarchyItem,
} from "../../../lsp/queries/type-hierarchy.js";
import { buildCorpusWorkspace } from "../_shared.js";
import { ALL_TESTS } from "../fixtures/index.js";

interface THProbe {
	file: "pou" | "plc_prg";
	text: string;
	line: number;
	char: number;
	prepared: Array<{
		name: string;
		supertypes: string[];
		subtypes: string[];
	}>;
}

function probe(
	source: string,
	doc: Parameters<typeof prepareTypeHierarchy>[0]["doc"],
	project: Parameters<typeof prepareTypeHierarchy>[0]["project"],
	workspace: Parameters<typeof supertypes>[0]["workspace"],
	tag: "pou" | "plc_prg",
): THProbe[] {
	const out: THProbe[] = [];
	for (const tok of lex(source)) {
		if (tok.kind !== "identifier") continue;
		const position = {
			line: tok.span.startLine - 1,
			character: tok.span.startCol,
		};
		const prepared = prepareTypeHierarchy({ doc, position, project });
		if (prepared.length === 0) continue;
		out.push({
			file: tag,
			text: tok.text,
			line: position.line,
			char: position.character,
			prepared: prepared.map((item: TypeHierarchyItem) => ({
				name: item.name,
				supertypes: supertypes({ workspace, project, item })
					.map((s) => s.name)
					.sort(),
				subtypes: subtypes({ workspace, project, item })
					.map((s) => s.name)
					.sort(),
			})),
		});
	}
	return out;
}

describe("typeHierarchy corpus (POU + PLC_PRG)", () => {
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
