/**
 * parseFile regression coverage. Most paths are exercised end-to-end
 * via ops.test.ts (TestBridge → materialize → assemble → parse →
 * push); this file targets the interface branch directly because it
 * doesn't ride a code-generating round-trip in the TestBridge tests.
 */
import { describe, expect, it } from "bun:test";
import { parseFile } from "./st-parse.js";

describe("parseFile (interface)", () => {
	it("parses an empty interface", () => {
		const src = `INTERFACE I_Empty\nEND_INTERFACE\n`;
		const result = parseFile(src, "I_Empty");
		expect(result.pou.declaration).toContain("INTERFACE I_Empty");
		expect(result.pou.implementation).toBe("");
		expect(result.children.size).toBe(0);
	});

	it("parses an interface with one signature method", () => {
		const src = `INTERFACE I_Sample
METHOD Run : INT
VAR_INPUT
    x : INT;
END_VAR
END_METHOD
END_INTERFACE
`;
		const result = parseFile(src, "I_Sample");
		expect(result.children.size).toBe(1);
		const method = result.children.get("Run");
		expect(method).toBeDefined();
		expect(method!.kind).toBe("method");
		expect(method!.declaration).toContain("METHOD Run : INT");
		expect(method!.declaration).toContain("VAR_INPUT");
		expect(method!.declaration).toContain("x : INT;");
		expect(method!.implementation).toBe("");
	});

	it("parses an interface with a method that has no varSections", () => {
		const src = `INTERFACE I_Bare
METHOD DoIt
END_METHOD
END_INTERFACE
`;
		const result = parseFile(src, "I_Bare");
		const method = result.children.get("DoIt");
		expect(method).toBeDefined();
		expect(method!.declaration).toContain("METHOD DoIt");
		// Slice must stop short of END_METHOD so the bridge can wrap it.
		expect(method!.declaration).not.toContain("END_METHOD");
		expect(method!.implementation).toBe("");
	});

	it("parses an interface property signature with GET only", () => {
		const src = `INTERFACE I_ReadOnly
PROPERTY Counter : DINT GET
END_PROPERTY
END_INTERFACE
`;
		const result = parseFile(src, "I_ReadOnly");
		const prop = result.children.get("Counter");
		expect(prop).toBeDefined();
		expect(prop!.kind).toBe("property");
		expect(prop!.declaration).toContain("PROPERTY Counter : DINT");
		// Empty accessor signals "create with no body" to the bridge.
		expect(prop!.getter).toEqual({ declaration: "", implementation: "" });
		expect(prop!.setter).toBeUndefined();
	});

	it("parses an interface property with both GET and SET", () => {
		const src = `INTERFACE I_RW
PROPERTY Value : INT GET SET
END_PROPERTY
END_INTERFACE
`;
		const result = parseFile(src, "I_RW");
		const prop = result.children.get("Value");
		expect(prop).toBeDefined();
		expect(prop!.getter).toEqual({ declaration: "", implementation: "" });
		expect(prop!.setter).toEqual({ declaration: "", implementation: "" });
	});

	it("parses an interface with mixed methods and properties", () => {
		const src = `INTERFACE I_Mixed
METHOD M1 : BOOL
END_METHOD
PROPERTY P1 : INT GET
END_PROPERTY
METHOD M2 : DINT
VAR_INPUT a : INT; END_VAR
END_METHOD
END_INTERFACE
`;
		const result = parseFile(src, "I_Mixed");
		expect(result.children.size).toBe(3);
		expect(result.children.get("M1")?.kind).toBe("method");
		expect(result.children.get("M2")?.kind).toBe("method");
		expect(result.children.get("P1")?.kind).toBe("property");
		expect(result.children.get("M2")?.declaration).toContain("a : INT;");
	});

	it("parses an interface with EXTENDS", () => {
		const src = `INTERFACE I_Child EXTENDS I_Base
METHOD Extra : BOOL
END_METHOD
END_INTERFACE
`;
		const result = parseFile(src, "I_Child");
		expect(result.pou.declaration).toContain("EXTENDS I_Base");
		expect(result.children.size).toBe(1);
	});

	it("rejects a file whose declared name doesn't match expectedName", () => {
		const src = `INTERFACE I_A\nEND_INTERFACE\n`;
		expect(() => parseFile(src, "I_B")).toThrow(/expected POU "I_B"/);
	});
});

describe("parseFile (POU outer kind validation)", () => {
	it("still rejects a GVL file at the outer level", () => {
		const src = `VAR_GLOBAL\n    g : INT;\nEND_VAR\n`;
		expect(() => parseFile(src, "GVL_X")).toThrow(/first declaration must be/);
	});
});
