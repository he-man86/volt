/**
 * Phase D tests — VG network-local navigation: go-to-definition,
 * references, and rename for LET wires and jump labels, plus real-var
 * navigation still flowing through the scope path.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { definition } from "../../lsp/queries/definition.js";
import { references } from "../../lsp/queries/references.js";
import { rename } from "../../lsp/queries/rename.js";
import type { Document, Workspace } from "../../lsp/workspace.js";

const SRC = `FUNCTION_BLOCK FB_Logic
VAR
	a : BOOL;
	b : BOOL;
	c : BOOL;
	out : BOOL;
	out2 : BOOL;
END_VAR
NETWORK 0 FBD
	LET g1 := (a AND b);
	out  := g1;
	out2 := (g1 OR c);
END_NETWORK
END_FUNCTION_BLOCK`;

function ctx(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const doc = {
		uri: "file:///t.st",
		source: src,
		version: 1,
		parseResult,
		bodyModels,
	} as unknown as Document;
	const workspace = { allDocuments: () => [doc] } as unknown as Workspace;
	return { doc, project, workspace };
}

/** LSP position of the Nth occurrence (0-based) of `needle` in `src`. */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {
	let idx = -1;
	for (let i = 0; i <= occurrence; i++) idx = src.indexOf(needle, idx + 1);
	const line = src.slice(0, idx).split("\n").length - 1;
	const character = idx - (src.lastIndexOf("\n", idx - 1) + 1);
	return { line, character };
}

describe("vg navigation: LET wire", () => {
	it("go-to-definition from a use jumps to the LET definition", () => {
		const { doc, project } = ctx(SRC);
		// `out  := g1;` — the g1 use.
		const locs = definition({ doc, position: posOf(SRC, "g1", 1), project });
		expect(locs).toHaveLength(1);
		// The definition span is the g1 in `LET g1 := …` (first occurrence).
		const defLine = SRC.slice(0, SRC.indexOf("g1")).split("\n").length - 1;
		expect(locs[0]!.range.start.line).toBe(defLine);
	});

	it("references returns all three occurrences in the network", () => {
		const { doc, project, workspace } = ctx(SRC);
		const locs = references({ doc, workspace, position: posOf(SRC, "g1", 0), project, includeDeclaration: true });
		// LET g1, out := g1, (g1 OR c) → 3 occurrences.
		expect(locs).toHaveLength(3);
	});

	it("rename rewrites every wire occurrence, network-local", () => {
		const { doc, project, workspace } = ctx(SRC);
		const edit = rename({ doc, workspace, position: posOf(SRC, "g1", 0), project, newName: "wAndResult" });
		expect(edit).not.toBeNull();
		const edits = edit!.changes["file:///t.st"]!;
		expect(edits).toHaveLength(3);
		expect(edits.every((e) => e.newText === "wAndResult")).toBe(true);
	});
});

describe("vg navigation: labels", () => {
	const LBL = `FUNCTION_BLOCK FB_J
VAR
	done : BOOL;
END_VAR
NETWORK 0 FBD
	IF done THEN JMP skip; END_IF
	skip:
END_NETWORK
END_FUNCTION_BLOCK`;

	it("go-to-definition from JMP jumps to the label", () => {
		const { doc, project } = ctx(LBL);
		const locs = definition({ doc, position: posOf(LBL, "skip", 0), project });
		expect(locs).toHaveLength(1);
		// Label declaration is the `skip:` (second occurrence of "skip").
		const declLine = LBL.slice(0, LBL.indexOf("skip:")).split("\n").length - 1;
		expect(locs[0]!.range.start.line).toBe(declLine);
	});
});

describe("vg navigation: real variables still resolve via scope", () => {
	it("go-to-definition on a real var lands on its VAR declaration", () => {
		const { doc, project } = ctx(SRC);
		// the `a` inside (a AND b)
		const locs = definition({ doc, position: posOf(SRC, "a AND", 0), project });
		expect(locs).toHaveLength(1);
		const declLine = SRC.slice(0, SRC.indexOf("a : BOOL")).split("\n").length - 1;
		expect(locs[0]!.range.start.line).toBe(declLine);
	});
});
