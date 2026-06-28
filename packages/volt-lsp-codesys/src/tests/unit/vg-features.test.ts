/**
 * Phase C tests — VG read-only LSP features: structural diagnostics,
 * folding, document symbols, semantic tokens, hover.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js";
import { foldingRanges } from "../../lsp/queries/folding-range.js";
import { buildDocumentSymbols } from "../../lsp/queries/document-symbol.js";
import { semanticTokens, TOKEN_TYPES } from "../../lsp/queries/semantic-tokens.js";
import { hover } from "../../lsp/queries/hover.js";
import { vgBodiesOf } from "../../lsp/queries/vg/shared.js";
import type { Document } from "../../lsp/workspace.js";

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

function build(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	return { parseResult, project, bodyModels };
}

function fakeDoc(src: string): Document {
	const { parseResult, bodyModels } = build(src);
	return {
		uri: "file:///t.st",
		source: src,
		version: 1,
		parseResult,
		bodyModels,
		// textDocument is unused by the queries under test.
	} as unknown as Document;
}

describe("vg features: structural diagnostics", () => {
	it("flags VG_BAD_EXPRESSION via the diagnostics pipeline", () => {
		const bad = SRC.replace("out2 := (g1 OR c);", "out2 := (g1 AND b OR c);");
		const { parseResult, project, bodyModels } = build(bad);
		const diags = computeSemanticDiagnostics({
			parseResult,
			source: bad,
			project,
			config: DEFAULT_DIAGNOSTIC_CONFIG,
			bodyModels,
		});
		expect(diags.map((d) => d.code)).toContain("VG_BAD_EXPRESSION");
	});

	it("clean VG body yields no vg diagnostics", () => {
		const { parseResult, project, bodyModels } = build(SRC);
		const diags = computeSemanticDiagnostics({
			parseResult,
			source: SRC,
			project,
			config: DEFAULT_DIAGNOSTIC_CONFIG,
			bodyModels,
		});
		expect(diags.filter((d) => d.code.startsWith("VG_"))).toEqual([]);
	});

	it("respects the vgStructure config flag", () => {
		const bad = SRC.replace("out2 := (g1 OR c);", "out2 := (g1 NAND c);");
		const { parseResult, project, bodyModels } = build(bad);
		const diags = computeSemanticDiagnostics({
			parseResult,
			source: bad,
			project,
			config: { ...DEFAULT_DIAGNOSTIC_CONFIG, vgStructure: false },
			bodyModels,
		});
		expect(diags.filter((d) => d.code.startsWith("VG_"))).toEqual([]);
	});
});

describe("vg features: folding", () => {
	it("folds the network block", () => {
		const { parseResult, bodyModels } = build(SRC);
		const ranges = foldingRanges({ parseResult, source: SRC, vgBodies: vgBodiesOf(bodyModels) });
		// NETWORK line (0-based) is index 8; END_NETWORK is index 12.
		const net = ranges.find((r) => r.startLine === 8 && r.endLine === 12);
		expect(net).toBeDefined();
	});
});

describe("vg features: document symbols", () => {
	it("adds a network child symbol to the POU", () => {
		const { parseResult, bodyModels } = build(SRC);
		const syms = buildDocumentSymbols(parseResult, bodyModels);
		const fb = syms[0]!;
		const network = (fb.children ?? []).find((c) => c.name.startsWith("NETWORK 0"));
		expect(network).toBeDefined();
		expect(network!.detail).toContain("FBD");
	});
});

describe("vg features: semantic tokens", () => {
	it("colours LET as a keyword and AND as an operator", () => {
		const { project, bodyModels } = build(SRC);
		const res = semanticTokens({
			source: SRC,
			project,
			docUri: "file:///t.st",
			vgBodies: vgBodiesOf(bodyModels),
		});
		// Decode: every 5 ints is one token; index 3 is the type.
		const keywordIdx = TOKEN_TYPES.indexOf("keyword");
		const operatorIdx = TOKEN_TYPES.indexOf("operator");
		const types = new Set<number>();
		for (let i = 0; i < res.data.length; i += 5) types.add(res.data[i + 3]!);
		expect(types.has(keywordIdx)).toBe(true);
		expect(types.has(operatorIdx)).toBe(true);
	});
});

describe("vg features: hover", () => {
	function hoverAt(src: string, needle: string) {
		const doc = fakeDoc(src);
		const offset = src.indexOf(needle);
		const line = src.slice(0, offset).split("\n").length - 1;
		const character = offset - (src.lastIndexOf("\n", offset - 1) + 1);
		return hover({ doc, position: { line, character }, project: build(src).project });
	}

	it("hovers an operator", () => {
		const h = hoverAt(SRC, "AND b");
		expect(h?.contents.value).toContain("logic operator");
	});

	it("hovers a LET wire", () => {
		const h = hoverAt(SRC, "g1 := ");
		expect(h?.contents.value).toContain("wire");
	});

	it("hovers the LET keyword", () => {
		const h = hoverAt(SRC, "LET g1");
		expect(h?.contents.value.toLowerCase()).toContain("wire");
	});
});
