/**
 * Phase B regression tests — VG body discrimination and ST-check
 * suppression.
 *
 * A POU whose body is VG must:
 *   1. be modelled as a VG BodyModel (language === "vg", `vg` populated);
 *   2. expose only declaration-scope references (real vars / instances /
 *      functions), never the network-local `LET` wire names;
 *   3. NOT trigger any ST-grammar diagnostic (those assume ST bodies).
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js";
import type { FunctionBlock } from "../../parser/ast.js";

const VG_FB = `FUNCTION_BLOCK FB_Logic
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

function setup(src: string) {
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult);
	const diags = computeSemanticDiagnostics({
		parseResult,
		source: src,
		project,
		config: DEFAULT_DIAGNOSTIC_CONFIG,
		bodyModels,
	});
	return { parseResult, project, bodyModels, diags };
}

describe("vg body model: discrimination", () => {
	it("marks a NETWORK body as VG and parses it", () => {
		const { parseResult, bodyModels } = setup(VG_FB);
		const fb = parseResult.units[0] as FunctionBlock;
		const model = bodyModels.get(fb.body)!;
		expect(model.language).toBe("vg");
		expect(model.vg).toBeDefined();
		expect(model.vg!.networks).toHaveLength(1);
		expect(model.vg!.diagnostics).toEqual([]);
	});

	it("collects declaration-scope refs but NOT the LET wire name", () => {
		const { parseResult, bodyModels } = setup(VG_FB);
		const fb = parseResult.units[0] as FunctionBlock;
		const model = bodyModels.get(fb.body)!;
		const names = model.identifiers.map((i) => i.name);
		expect(names).toContain("a");
		expect(names).toContain("b");
		expect(names).toContain("c");
		expect(names).toContain("out");
		expect(names).toContain("out2");
		// `g1` is a network-local wire — must not be a project-scope ref.
		expect(names).not.toContain("g1");
	});

	it("keeps an ordinary ST body classified as ST", () => {
		const { parseResult, bodyModels } = setup(`FUNCTION_BLOCK FB_St
VAR
	x : INT;
END_VAR
	x := x + 1;
END_FUNCTION_BLOCK`);
		const fb = parseResult.units[0] as FunctionBlock;
		expect(bodyModels.get(fb.body)!.language).toBe("st");
	});
});

describe("vg body model: ST checks are suppressed on VG bodies", () => {
	it("emits no ST-grammar diagnostics for a valid VG body", () => {
		const { diags } = setup(VG_FB);
		// No unresolved-identifier (wires/keywords would otherwise leak),
		// no assignment/binary-operator type mismatches from VG operators.
		const stCodes = new Set([
			"unresolved-identifier",
			"assignment-type-mismatch",
			"binary-operator-type-mismatch",
			"conversion-source-mismatch",
			"deref-non-pointer",
			"vendor-only-operator",
		]);
		const leaked = diags.filter((d) => stCodes.has(d.code));
		expect(leaked).toEqual([]);
	});
});
