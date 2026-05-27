/**
 * Assembler unit tests — bridge children → workspace `.st` file shape.
 *
 * Round-trip with the LSP parser is the load-bearing property: anything
 * we assemble must parse back into the same structural shape so
 * `plc import → plc export` is a no-op when nothing changed. We assert
 * both the visible format (children OUTSIDE END_FUNCTION_BLOCK, stable
 * order, GET/SET correctness) and the round-trip itself.
 */
import { describe, expect, it } from "vitest";
import { parseSource } from "@opencode-ai/plc-lsp-st";
import { assemblePou } from "./st-assemble.js";

describe("assemblePou", () => {
	it("emits an FB with no children, no body — just declaration + END_FUNCTION_BLOCK", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR",
		});
		expect(out).toContain("FUNCTION_BLOCK FB_X");
		expect(out).toContain("END_FUNCTION_BLOCK");
		// No METHOD/ACTION/PROPERTY sections at all.
		expect(out).not.toContain("METHOD");
		expect(out).not.toContain("ACTION");
		expect(out).not.toContain("PROPERTY");
	});

	it("places children AFTER END_FUNCTION_BLOCK (top-level siblings, LSP format)", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR",
			children: [
				{
					kind: "method",
					name: "Reset",
					declaration: "METHOD Reset : BOOL\nVAR_INPUT END_VAR\nVAR END_VAR",
					implementation: "Reset := TRUE;",
				},
			],
		});
		const endIdx = out.indexOf("END_FUNCTION_BLOCK");
		const methodIdx = out.indexOf("METHOD Reset");
		expect(endIdx).toBeGreaterThan(0);
		expect(methodIdx).toBeGreaterThan(endIdx); // METHOD must come AFTER END_FUNCTION_BLOCK
	});

	it("emits children in canonical order: methods → actions → properties, alphabetical within", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_X\nVAR END_VAR",
			children: [
				// Deliberately out-of-order input
				{ kind: "property", name: "BProp", declaration: "PROPERTY BProp : INT" },
				{ kind: "property", name: "AProp", declaration: "PROPERTY AProp : INT" },
				{ kind: "action", name: "BAction", declaration: "ACTION BAction", implementation: "x := 1;" },
				{ kind: "action", name: "AAction", declaration: "ACTION AAction", implementation: "x := 2;" },
				{
					kind: "method",
					name: "BMethod",
					declaration: "METHOD BMethod : BOOL\nVAR END_VAR",
					implementation: "BMethod := TRUE;",
				},
				{
					kind: "method",
					name: "AMethod",
					declaration: "METHOD AMethod : BOOL\nVAR END_VAR",
					implementation: "AMethod := TRUE;",
				},
			],
		});
		// Find positions of each child block in the output.
		const positions = {
			AMethod: out.indexOf("METHOD AMethod"),
			BMethod: out.indexOf("METHOD BMethod"),
			AAction: out.indexOf("ACTION AAction"),
			BAction: out.indexOf("ACTION BAction"),
			AProp: out.indexOf("PROPERTY AProp"),
			BProp: out.indexOf("PROPERTY BProp"),
		};
		// Methods before actions before properties:
		expect(positions.BMethod).toBeGreaterThan(positions.AMethod);
		expect(positions.AAction).toBeGreaterThan(positions.BMethod);
		expect(positions.BAction).toBeGreaterThan(positions.AAction);
		expect(positions.AProp).toBeGreaterThan(positions.BAction);
		expect(positions.BProp).toBeGreaterThan(positions.AProp);
	});

	it("emits PROPERTY with GET only when setter is absent", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_X\nVAR _v : INT; END_VAR",
			children: [
				{
					kind: "property",
					name: "V",
					declaration: "PROPERTY V : INT",
					getter: { implementation: "V := _v;" },
				},
			],
		});
		expect(out).toContain("PROPERTY V : INT");
		expect(out).toMatch(/GET\s+V := _v;\s+END_GET/);
		expect(out).not.toContain("END_SET");
		expect(out).toContain("END_PROPERTY");
	});

	it("emits PROPERTY with both GET and SET when both present", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_X\nVAR _v : INT; END_VAR",
			children: [
				{
					kind: "property",
					name: "V",
					declaration: "PROPERTY V : INT",
					getter: { implementation: "V := _v;" },
					setter: { implementation: "_v := V;" },
				},
			],
		});
		expect(out).toMatch(/GET\s+V := _v;\s+END_GET/);
		expect(out).toMatch(/SET\s+_v := V;\s+END_SET/);
	});

	it("is deterministic: same input → same bytes; child input order doesn't matter", () => {
		const inputA = {
			kind: "function_block" as const,
			declaration: "FUNCTION_BLOCK FB_Det\nVAR END_VAR",
			children: [
				{ kind: "method" as const, name: "B", declaration: "METHOD B : BOOL\nVAR END_VAR", implementation: "B := TRUE;" },
				{ kind: "method" as const, name: "A", declaration: "METHOD A : BOOL\nVAR END_VAR", implementation: "A := TRUE;" },
			],
		};
		const inputB = { ...inputA, children: [...inputA.children].reverse() };
		expect(assemblePou(inputA)).toBe(assemblePou(inputA));
		expect(assemblePou(inputA)).toBe(assemblePou(inputB));
	});

	it("matches the right END_X keyword per outer POU kind", () => {
		expect(assemblePou({ kind: "function_block", declaration: "FUNCTION_BLOCK X\nVAR END_VAR" })).toContain("END_FUNCTION_BLOCK");
		expect(assemblePou({ kind: "program", declaration: "PROGRAM X\nVAR END_VAR" })).toContain("END_PROGRAM");
		expect(assemblePou({ kind: "function", declaration: "FUNCTION X : INT\nVAR END_VAR" })).toContain("END_FUNCTION");
		expect(assemblePou({ kind: "interface", declaration: "INTERFACE IX" })).toContain("END_INTERFACE");
	});

	it("output parses cleanly through @opencode-ai/plc-lsp-st (full round-trip: method + action + property)", () => {
		const src = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_RT\nVAR _state : INT; END_VAR",
			implementation: "_state := _state + 1;",
			children: [
				{
					kind: "method",
					name: "Run",
					declaration: "METHOD Run : BOOL\nVAR_INPUT END_VAR\nVAR END_VAR",
					implementation: "Run := TRUE;",
				},
				{
					kind: "action",
					name: "Step",
					declaration: "ACTION Step",
					implementation: "_state := _state + 10;",
				},
				{
					kind: "property",
					name: "State",
					declaration: "PROPERTY State : INT",
					getter: { implementation: "State := _state;" },
					setter: { implementation: "_state := State;" },
				},
			],
		});
		const { units, errors } = parseSource(src);
		expect(errors).toHaveLength(0);
		expect(units).toHaveLength(4);
		expect(units[0]!.kind).toBe("function_block");
		const kinds = units.slice(1).map((u) => u.kind).sort();
		expect(kinds).toEqual(["action", "method", "property"]);
	});

	it("emits in-FB folder as a trailing (* folder: X *) comment on the signature line", () => {
		const out = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_F\nVAR END_VAR",
			children: [
				{
					kind: "method",
					name: "Run",
					declaration: "METHOD Run : BOOL\nVAR END_VAR",
					implementation: "Run := TRUE;",
					folder: "Modes",
				},
				{
					kind: "action",
					name: "Deep",
					declaration: "ACTION Deep",
					implementation: "x := 1;",
					folder: "Helpers/Drives/Stage1",
				},
			],
		});
		// Comment goes on the SIGNATURE line (line containing METHOD/ACTION),
		// not anywhere later.
		expect(out).toMatch(/METHOD Run : BOOL\s+\(\* folder: Modes \*\)/);
		expect(out).toMatch(/ACTION Deep\s+\(\* folder: Helpers\/Drives\/Stage1 \*\)/);
		// Parser doesn't care — it treats the comment as trivia.
		const { errors } = parseSource(out);
		expect(errors).toHaveLength(0);
	});

	it("re-emit is idempotent for the folder annotation (doesn't double-add)", () => {
		const child = {
			kind: "method" as const,
			name: "Run",
			declaration: "METHOD Run : BOOL\nVAR END_VAR",
			implementation: "Run := TRUE;",
			folder: "Modes",
		};
		const once = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_F\nVAR END_VAR",
			children: [child],
		});
		// Pretend we round-tripped: feed the same children back in.
		const twice = assemblePou({
			kind: "function_block",
			declaration: "FUNCTION_BLOCK FB_F\nVAR END_VAR",
			children: [{ ...child, declaration: child.declaration }],
		});
		expect(twice).toBe(once);
	});
});
