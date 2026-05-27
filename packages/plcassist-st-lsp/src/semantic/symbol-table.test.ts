/**
 * Symbol table tests. Verify each top-level unit contributes the
 * right symbols at the right scope, that nested scopes are linked,
 * and that case-insensitive lookup behaves correctly.
 */
import { describe, expect, it } from "vitest";
import { parseSource } from "../parser/parser.js";
import {
	buildSymbolTable,
	lookupLocal,
	type Scope,
	type Symbol,
} from "./symbol-table.js";

function table(...files: string[]): Scope {
	return buildSymbolTable(files.map((f) => parseSource(f)));
}

function findScope(project: Scope, name: string): Scope | undefined {
	return project.children.find((c) => c.name === name);
}

describe("symbol table: FUNCTION_BLOCK", () => {
	it("creates one project-level symbol and one pou-scope per FB", () => {
		const project = table(`
			FUNCTION_BLOCK FB_Motor
			VAR_INPUT
				bEnable : BOOL;
			END_VAR
			VAR
				tCycle : TIME;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(lookupLocal(project, "FB_Motor")).toHaveLength(1);
		expect(lookupLocal(project, "FB_Motor")[0]?.kind).toBe("function_block");
		const fbScope = findScope(project, "FB_Motor");
		expect(fbScope).toBeDefined();
		expect(lookupLocal(fbScope!, "bEnable")[0]?.kind).toBe("var");
		expect(lookupLocal(fbScope!, "tCycle")[0]?.kind).toBe("var");
	});

	it("var section kind is captured on each var symbol", () => {
		const project = table(`
			FUNCTION_BLOCK FB_X
			VAR_INPUT
				a : BOOL;
			END_VAR
			VAR_OUTPUT
				b : BOOL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		const fbScope = findScope(project, "FB_X")!;
		expect(lookupLocal(fbScope, "a")[0]?.varSection).toBe("VAR_INPUT");
		expect(lookupLocal(fbScope, "b")[0]?.varSection).toBe("VAR_OUTPUT");
	});

	it("comma-separated var names each get their own symbol", () => {
		const project = table(`
			FUNCTION_BLOCK FB_X
			VAR
				a, b, c : INT;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		const fbScope = findScope(project, "FB_X")!;
		expect(lookupLocal(fbScope, "a")).toHaveLength(1);
		expect(lookupLocal(fbScope, "b")).toHaveLength(1);
		expect(lookupLocal(fbScope, "c")).toHaveLength(1);
	});
});

describe("symbol table: case-insensitivity", () => {
	it("looks up by any casing", () => {
		const project = table(`
			FUNCTION_BLOCK FB_Motor
			VAR
				bEnable : BOOL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(lookupLocal(project, "FB_MOTOR")).toHaveLength(1);
		expect(lookupLocal(project, "fb_motor")).toHaveLength(1);
		const fbScope = findScope(project, "FB_Motor")!;
		expect(lookupLocal(fbScope, "BENABLE")).toHaveLength(1);
	});

	it("preserves original casing on the symbol", () => {
		const project = table(`
			FUNCTION_BLOCK FB_MOTOR
			END_FUNCTION_BLOCK
		`);
		const sym = lookupLocal(project, "fb_motor")[0] as Symbol;
		expect(sym.name).toBe("FB_MOTOR");
	});
});

describe("symbol table: TYPE / DUTs", () => {
	it("struct fields land in struct scope", () => {
		const project = table(`
			TYPE T_Pose :
			STRUCT
				x, y : REAL;
				rot : REAL := 0.0;
			END_STRUCT
			END_TYPE
		`);
		expect(lookupLocal(project, "T_Pose")[0]?.kind).toBe("type");
		const structScope = findScope(project, "T_Pose")!;
		expect(lookupLocal(structScope, "x")[0]?.kind).toBe("struct_field");
		expect(lookupLocal(structScope, "y")[0]?.kind).toBe("struct_field");
		expect(lookupLocal(structScope, "rot")[0]?.kind).toBe("struct_field");
	});

	it("enum values land in enum scope", () => {
		const project = table(`
			TYPE E_State :
			(Idle, Running, Stopped)
			END_TYPE
		`);
		const enumScope = findScope(project, "E_State")!;
		expect(enumScope.kind).toBe("enum");
		expect(lookupLocal(enumScope, "Idle")[0]?.kind).toBe("enum_value");
		expect(lookupLocal(enumScope, "Running")[0]?.kind).toBe("enum_value");
	});

	it("alias DUT has no inner scope members", () => {
		const project = table(`TYPE T_Counter : INT END_TYPE`);
		const aliasSym = lookupLocal(project, "T_Counter")[0];
		expect(aliasSym?.kind).toBe("type");
		// No alias-scope children
		expect(findScope(project, "T_Counter")).toBeUndefined();
	});
});

describe("symbol table: INTERFACE", () => {
	it("interface methods/properties go into interface scope", () => {
		const project = table(`
			INTERFACE IMotor
				METHOD Start : BOOL
				END_METHOD
				PROPERTY Speed : REAL GET
				END_PROPERTY
			END_INTERFACE
		`);
		const ifaceScope = findScope(project, "IMotor")!;
		expect(ifaceScope.kind).toBe("interface");
		expect(lookupLocal(ifaceScope, "Start")[0]?.kind).toBe("interface_method");
		expect(lookupLocal(ifaceScope, "Speed")[0]?.kind).toBe("interface_property");
	});
});

describe("symbol table: GVL", () => {
	it("VAR_GLOBAL contents land in project scope as gvl_var", () => {
		const project = table(`
			VAR_GLOBAL
				gFoo : INT;
				gBar : REAL;
			END_VAR
		`);
		expect(lookupLocal(project, "gFoo")[0]?.kind).toBe("gvl_var");
		expect(lookupLocal(project, "gBar")[0]?.kind).toBe("gvl_var");
	});
});

describe("symbol table: standalone METHOD/ACTION (materialized child file)", () => {
	it("method as top-level unit", () => {
		const project = table(`
			METHOD PUBLIC Execute : BOOL
			VAR_INPUT
				count : INT;
			END_VAR
			END_METHOD
		`);
		expect(lookupLocal(project, "Execute")[0]?.kind).toBe("method");
		const methodScope = findScope(project, "Execute")!;
		expect(methodScope.kind).toBe("method");
		expect(lookupLocal(methodScope, "count")[0]?.kind).toBe("method_param");
	});

	it("action as top-level unit", () => {
		const project = table(`
			ACTION Idle
			END_ACTION
		`);
		expect(lookupLocal(project, "Idle")[0]?.kind).toBe("action");
	});
});

describe("symbol table: multi-file project", () => {
	it("merges symbols from multiple parsed files", () => {
		const project = table(
			`FUNCTION_BLOCK FB_A END_FUNCTION_BLOCK`,
			`FUNCTION_BLOCK FB_B END_FUNCTION_BLOCK`,
			`TYPE T_State : (S1, S2) END_TYPE`,
		);
		expect(lookupLocal(project, "FB_A")).toHaveLength(1);
		expect(lookupLocal(project, "FB_B")).toHaveLength(1);
		expect(lookupLocal(project, "T_State")).toHaveLength(1);
	});
});

describe("symbol table: NAMESPACE", () => {
	it("creates a namespace scope and a project-level symbol", () => {
		const project = table(`
			NAMESPACE MyLib
				FUNCTION_BLOCK FB_Inner
				END_FUNCTION_BLOCK
			END_NAMESPACE
		`);
		expect(lookupLocal(project, "MyLib")[0]?.kind).toBe("namespace");
		const nsScope = findScope(project, "MyLib")!;
		expect(nsScope.kind).toBe("namespace");
		// Inner FB lives in the namespace scope, NOT the project root.
		expect(lookupLocal(nsScope, "FB_Inner")[0]?.kind).toBe("function_block");
		expect(lookupLocal(project, "FB_Inner")).toHaveLength(0);
	});

	it("ingests multiple inner units into the namespace scope", () => {
		const project = table(`
			NAMESPACE Util
				FUNCTION_BLOCK FB_Timer END_FUNCTION_BLOCK
				TYPE T_Mode : (Auto, Manual) END_TYPE
				VAR_GLOBAL gCount : INT; END_VAR
			END_NAMESPACE
		`);
		const ns = findScope(project, "Util")!;
		expect(lookupLocal(ns, "FB_Timer")).toHaveLength(1);
		expect(lookupLocal(ns, "T_Mode")).toHaveLength(1);
		expect(lookupLocal(ns, "gCount")).toHaveLength(1);
	});
});
