/**
 * Narrowing-conversion warning (st-type-inference §5). Default OFF —
 * enabled explicitly here. LREAL→REAL warns; widening / same-type does not.
 */
import { describe, expect, it } from "bun:test";
import { diagnosticsFor } from "../support/diagnostics.js";

const wrap = (body: string) => `PROGRAM Main\nVAR\n\tr : REAL;\n\tlr : LREAL;\n\ti : INT;\nEND_VAR\n${body}\nEND_PROGRAM\n`;

/** Narrowing diagnostics with the check enabled. */
const narrowingDiags = (body: string) =>
	diagnosticsFor(wrap(body), { configOverrides: { narrowingConversion: true }, code: "narrowing-conversion" });

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
		// Default config — the check must not fire even on a real LREAL→REAL narrowing.
		expect(diagnosticsFor(wrap("r := lr;"), { code: "narrowing-conversion" })).toHaveLength(0);
	});
});
