/**
 * Call-argument-mismatch check (st-type-inference §4). Default OFF, so
 * these enable it explicitly. Covers the true-positive direction (the
 * corpus ratchet covers zero-FP). See openspec change `st-type-inference`.
 */
import { describe, expect, it } from "bun:test";
import { diagnosticsFor } from "../support/diagnostics.js";

const callArgDiags = (src: string) =>
	diagnosticsFor(src, { configOverrides: { callArgumentMismatch: true }, code: "call-argument-mismatch" });

const ADDER = `FUNCTION_BLOCK Adder
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
END_FUNCTION_BLOCK
`;
function main(body: string): string {
	return `${ADDER}
PROGRAM Main
VAR
	inst : Adder;
	flag : BOOL;
	n : INT;
END_VAR
${body}
END_PROGRAM
`;
}

describe("call-argument-mismatch", () => {
	it("flags a named argument that is not a parameter", () => {
		const d = callArgDiags(main("inst(a := 1, c := 2);"));
		expect(d.length).toBe(1);
		expect(d[0]!.message).toContain("'c'");
	});

	it("does NOT flag correct named arguments", () => {
		expect(callArgDiags(main("inst(a := 1, b := 2);"))).toHaveLength(0);
	});

	it("flags too many positional arguments", () => {
		const d = callArgDiags(main("inst(1, 2, 3);"));
		expect(d.length).toBeGreaterThan(0);
		expect(d[0]!.message).toContain("Too many");
	});

	it("does NOT flag the exact positional count", () => {
		expect(callArgDiags(main("inst(n, n);"))).toHaveLength(0);
	});

	it("flags an incompatible argument type", () => {
		const d = callArgDiags(main("inst(a := flag, b := 2);")); // BOOL into INT param
		expect(d.length).toBe(1);
		expect(d[0]!.message).toContain("not compatible");
	});

	it("does NOT flag a compatible argument type", () => {
		expect(callArgDiags(main("inst(a := n, b := 2);"))).toHaveLength(0);
	});
});

describe("call-argument-mismatch: conservative skips (no false positives)", () => {
	it("skips name checking for an FB that EXTENDS a base (inherited params invisible)", () => {
		const src = `FUNCTION_BLOCK Base
VAR_INPUT
	baseIn : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK Derived EXTENDS Base
VAR_INPUT
	derIn : INT;
END_VAR
END_FUNCTION_BLOCK
PROGRAM Main
VAR
	d : Derived;
END_VAR
d(baseIn := 1);
END_PROGRAM
`;
		// baseIn is inherited — the check can't see it, so it must NOT flag it.
		expect(callArgDiags(src)).toHaveLength(0);
	});

	it("skips a standard-library function (REPLACE) — catalog signature, often overloaded", () => {
		const src = `PROGRAM Main
VAR
	s : STRING;
END_VAR
s := REPLACE(STR1 := s, STR2 := 'x', L := 1, P := 1);
END_PROGRAM
`;
		expect(callArgDiags(src)).toHaveLength(0);
	});
});
