/**
 * Phase F tests — VG type inference (§8) surfaced in hover, plus
 * code-correctness diagnostics (undeclared identifier, undefined jump
 * label, unknown pin).
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js";
import { hover } from "../../lsp/queries/hover.js";
import type { Document } from "../../lsp/workspace.js";

const TON = `FUNCTION_BLOCK TON
VAR_INPUT
	IN : BOOL;
	PT : TIME;
END_VAR
VAR_OUTPUT
	Q : BOOL;
	ET : TIME;
END_VAR
END_FUNCTION_BLOCK
`;

function build(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const doc = { uri: "file:///t.st", source: src, version: 1, parseResult, bodyModels } as unknown as Document;
	return { parseResult, project, bodyModels, doc };
}

function diags(src: string, overrides = {}) {
	const { parseResult, project, bodyModels } = build(src);
	return computeSemanticDiagnostics({
		parseResult,
		source: src,
		project,
		config: { ...DEFAULT_DIAGNOSTIC_CONFIG, ...overrides },
		bodyModels,
	});
}

function posOf(src: string, needle: string, occurrence = 0) {
	let idx = -1;
	for (let i = 0; i <= occurrence; i++) idx = src.indexOf(needle, idx + 1);
	const line = src.slice(0, idx).split("\n").length - 1;
	const character = idx - (src.lastIndexOf("\n", idx - 1) + 1);
	return { line, character };
}

describe("vg type inference: hover", () => {
	it("infers a logic-op wire as BOOL", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	a : BOOL;
	b : BOOL;
	out : BOOL;
	out2 : BOOL;
END_VAR
NETWORK 0 FBD
	LET g1 := (a AND b);
	out := g1;
	out2 := g1;
END_NETWORK
END_FUNCTION_BLOCK`;
		const { doc, project } = build(src);
		const h = hover({ doc, position: posOf(src, "g1 :="), project });
		expect(h?.contents.value).toContain("BOOL");
		expect(h?.contents.value).toContain("wire");
	});

	it("infers an arithmetic wire from its operand var", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	x : INT;
	y : INT;
	out : INT;
	out2 : INT;
END_VAR
NETWORK 0 FBD
	LET g1 := (x + y);
	out := g1;
	out2 := g1;
END_NETWORK
END_FUNCTION_BLOCK`;
		const { doc, project } = build(src);
		const h = hover({ doc, position: posOf(src, "g1 :="), project });
		expect(h?.contents.value).toContain("INT");
	});
});

describe("vg code-correctness diagnostics", () => {
	it("flags an undeclared identifier", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	a : BOOL;
	out : BOOL;
END_VAR
NETWORK 0 FBD
	out := (a AND missing);
END_NETWORK
END_FUNCTION_BLOCK`;
		const d = diags(src);
		const u = d.filter((x) => x.code === "vg-undeclared-identifier");
		expect(u.map((x) => x.message).join(" ")).toContain("missing");
		// `a` and `out` are declared → only `missing` flagged.
		expect(u).toHaveLength(1);
	});

	it("flags a jump to an undefined label", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	done : BOOL;
END_VAR
NETWORK 0 FBD
	IF done THEN JMP nowhere; END_IF
END_NETWORK
END_FUNCTION_BLOCK`;
		const d = diags(src);
		expect(d.map((x) => x.code)).toContain("vg-undefined-label");
	});

	it("does not flag a jump to a defined label", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	done : BOOL;
END_VAR
NETWORK 0 FBD
	IF done THEN JMP here; END_IF
	here:
END_NETWORK
END_FUNCTION_BLOCK`;
		expect(diags(src).filter((x) => x.code === "vg-undefined-label")).toEqual([]);
	});

	it("flags an unknown pin on an FB-instance call", () => {
		const src = `${TON}
FUNCTION_BLOCK FB_Use
VAR
	t1 : TON;
	start : BOOL;
	pt : TIME;
END_VAR
NETWORK 0 FBD
	t1(IN := start, BOGUS := pt);
END_NETWORK
END_FUNCTION_BLOCK`;
		const d = diags(src);
		const p = d.filter((x) => x.code === "vg-unknown-pin");
		expect(p).toHaveLength(1);
		expect(p[0]!.message).toContain("BOGUS");
	});

	it("does not flag valid pins", () => {
		const src = `${TON}
FUNCTION_BLOCK FB_Use
VAR
	t1 : TON;
	start : BOOL;
	pt : TIME;
END_VAR
NETWORK 0 FBD
	t1(IN := start, PT := pt);
END_NETWORK
END_FUNCTION_BLOCK`;
		expect(diags(src).filter((x) => x.code === "vg-unknown-pin")).toEqual([]);
	});

	it("MAX(a,b) function call parses and resolves cleanly", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	a : INT;
	b : INT;
	out : INT;
END_VAR
NETWORK 0 FBD
	out := MAX(a, b);
END_NETWORK
END_FUNCTION_BLOCK`;
		const d = diags(src);
		expect(d.filter((x) => x.code.startsWith("VG_") || x.code === "vg-undeclared-identifier")).toEqual([]);
	});
});
