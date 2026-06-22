/**
 * Phase G tests — the VG canonical writer.
 *
 * Core guarantee: a structurally-canonical body round-trips byte-exact —
 * `writeVgBody(parseVgText(x)) === x` for the spec's §12 worked examples.
 * That's what makes the writer usable as the canonical formatter and the
 * basis of the (opt-in) VG_NOT_CANONICAL diagnostic.
 */
import { describe, expect, it } from "bun:test";
import { parseVgText, writeVgBody } from "../../vg/index.js";
import { parseSource } from "../../parser/parser.js";
import { buildSymbolTable } from "../../semantic/symbol-table-build.js";
import { buildBodyModelsForParseResult } from "../../semantic/body.js";
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js";
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js";

const EXAMPLES: string[] = [
	`NETWORK 0 FBD
  out := (a AND b);
END_NETWORK`,
	`NETWORK 0 FBD
  out := ((a AND b) OR c);
END_NETWORK`,
	`NETWORK 0 FBD
  LET g1 := (a AND b);
  out := g1;
  out2 := g1;
END_NETWORK`,
	`NETWORK 0 FBD
  LET i1 := NOT b;
  out := (a AND i1);
END_NETWORK`,
	`NETWORK 0 FBD
  LET en1 := a;
  IF en1 THEN out := (b AND c); END_IF
END_NETWORK`,
	`NETWORK 0 FBD
  t1(IN := start, PT := pt);
  done := t1.Q;
  et := t1.ET;
END_NETWORK`,
	`NETWORK 0 LD
  out := ((a OR b) AND c);
END_NETWORK`,
	`NETWORK 0 LD
  out1 := (a AND b);
END_NETWORK
NETWORK 1 LD
  out2 := (c OR d);
END_NETWORK`,
	`NETWORK 0 FBD
  iCount := (1 + iCount);
END_NETWORK`,
	`NETWORK 0 FBD
  IF done THEN RETURN; END_IF
  step := (step + 1);
END_NETWORK`,
	`NETWORK 0 FBD
  out := a SET;
  clk := b RISING;
END_NETWORK`,
	`NETWORK 0 FBD
  myLabel:
  JMP myLabel;
END_NETWORK`,
];

describe("vg writer: round-trips canonical §12 examples", () => {
	for (const [i, src] of EXAMPLES.entries()) {
		it(`example ${i} is a fixed point`, () => {
			const body = parseVgText(src);
			expect(body.diagnostics).toEqual([]);
			expect(writeVgBody(body)).toBe(src);
		});
	}
});

describe("vg writer: VG_NOT_CANONICAL diagnostic (opt-in)", () => {
	const NON_CANON = `FUNCTION_BLOCK FB_X
VAR
	a : BOOL;
	b : BOOL;
	out : BOOL;
END_VAR
NETWORK 0 FBD
	out:=(a    AND b);
END_NETWORK
END_FUNCTION_BLOCK`;

	function diags(src: string, vgNotCanonical: boolean) {
		const parseResult = parseSource(src);
		const project = buildSymbolTable([{ uri: "file:///t.st", parseResult }]);
		const bodyModels = buildBodyModelsForParseResult(parseResult);
		return computeSemanticDiagnostics({
			parseResult,
			source: src,
			project,
			config: { ...DEFAULT_DIAGNOSTIC_CONFIG, vgNotCanonical },
			bodyModels,
		});
	}

	it("flags a non-canonical body when enabled", () => {
		const d = diags(NON_CANON, true);
		const c = d.filter((x) => x.code === "VG_NOT_CANONICAL");
		expect(c).toHaveLength(1);
		expect(c[0]!.message).toContain("out := (a AND b)");
	});

	it("is silent by default", () => {
		expect(diags(NON_CANON, false).filter((x) => x.code === "VG_NOT_CANONICAL")).toEqual([]);
	});
});
