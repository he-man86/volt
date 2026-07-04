/**
 * Narrowing-conversion warning (st-type-inference §5). Default OFF —
 * enabled explicitly here. LREAL→REAL warns; widening / same-type does not.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js";

function narrowingDiags(body: string) {
	const src = `PROGRAM Main
VAR
	r : REAL;
	lr : LREAL;
	i : INT;
END_VAR
${body}
END_PROGRAM
`;
	const parseResult = parseSource(src);
	const project = buildSymbolTable([{ uri: "file:///t.st", parseResult, source: src }]);
	const bodyModels = buildBodyModelsForParseResult(parseResult, src);
	return computeSemanticDiagnostics({
		parseResult,
		source: src,
		project,
		config: { ...DEFAULT_DIAGNOSTIC_CONFIG, narrowingConversion: true },
		bodyModels,
		libraryNamespaces: new Set(),
		deviceInstances: new Set(),
	}).filter((d) => d.code === "narrowing-conversion");
}

describe("narrowing-conversion", () => {
	it("warns on LREAL → REAL", () => {
		const d = narrowingDiags("r := lr;");
		expect(d.length).toBe(1);
		expect(d[0]!.severity).toBe("warning");
		expect(d[0]!.message).toContain("LREAL");
		expect(d[0]!.message).toContain("REAL");
	});

	it("does NOT warn on REAL → LREAL (widening)", () => {
		expect(narrowingDiags("lr := r;")).toHaveLength(0);
	});

	it("does NOT warn on REAL → REAL", () => {
		expect(narrowingDiags("r := r;")).toHaveLength(0);
	});

	it("does NOT warn on an unknown/complex RHS", () => {
		expect(narrowingDiags("r := i;")).toHaveLength(0); // INT→REAL is widening, not a loss
	});

	it("is OFF by default (no config override)", () => {
		const src = `PROGRAM Main
VAR
	r : REAL;
	lr : LREAL;
END_VAR
r := lr;
END_PROGRAM
`;
		const parseResult = parseSource(src);
		const project = buildSymbolTable([{ uri: "file:///t.st", parseResult, source: src }]);
		const bodyModels = buildBodyModelsForParseResult(parseResult, src);
		const diags = computeSemanticDiagnostics({
			parseResult,
			source: src,
			project,
			config: DEFAULT_DIAGNOSTIC_CONFIG,
			bodyModels,
			libraryNamespaces: new Set(),
			deviceInstances: new Set(),
		});
		expect(diags.filter((d) => d.code === "narrowing-conversion")).toHaveLength(0);
	});
});
