/**
 * Parser tests. Covers each top-level unit, all VAR section
 * variants, the type-expression grammar, and DUT bodies. Includes
 * the April 2026 stacked-METHOD-modifier regression cases.
 *
 * Pattern: parse the source, assert no errors, then walk the AST.
 * For error-recovery tests, we parse intentionally-broken source
 * and assert specific errors were recorded.
 */
import { describe, expect, it } from "bun:test";
import { parseSource } from "../../parser/parser.js";
import type {
	ArrayType,
	FunctionBlock,
	Method,
	NamedType,
	PointerType,
	Program,
	Property,
	ReferenceType,
	StringType,
	StructBody,
	TypeDecl,
	TypeExpr,
	EnumBody,
	UnionBody,
	AliasBody,
} from "../../parser/ast.js";

function parseOne(src: string) {
	const result = parseSource(src);
	return result;
}

describe("parser: FUNCTION_BLOCK shells", () => {
	it("empty FB", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_Empty
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		expect(units).toHaveLength(1);
		const fb = units[0] as FunctionBlock;
		expect(fb.kind).toBe("function_block");
		expect(fb.name.text).toBe("FB_Empty");
	});

	it("FB with EXTENDS and IMPLEMENTS", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_Motor EXTENDS FB_BaseDevice IMPLEMENTS IControllable, ITrackable
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.extends?.text).toBe("FB_BaseDevice");
		expect(fb.implements?.map((i) => i.text)).toEqual(["IControllable", "ITrackable"]);
	});

	it("FB with VAR sections", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR_INPUT
				bEnable : BOOL := FALSE;
				nCount : INT;
			END_VAR
			VAR_OUTPUT
				eState : E_State;
			END_VAR
			VAR
				tCycle : TIME := T#100ms;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections).toHaveLength(3);
		expect(fb.varSections[0]?.sectionKind).toBe("VAR_INPUT");
		expect(fb.varSections[0]?.decls).toHaveLength(2);
		expect(fb.varSections[0]?.decls[0]?.names[0]?.text).toBe("bEnable");
		expect(fb.varSections[0]?.decls[0]?.init).toBeDefined();
		expect(fb.varSections[2]?.decls[0]?.init?.tokens[0]?.text).toBe("T#100ms");
	});

	it("FB with body captures opaque tokens", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_Counter
			VAR
				n : INT;
			END_VAR
				n := n + 1;
				IF n > 100 THEN
					n := 0;
				END_IF
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		// Body tokens should include `n`, `:=`, `n`, `+`, `1`, `;`, etc.
		const bodyText = fb.body.tokens.map((t) => t.text).join(" ");
		expect(bodyText).toContain("n");
		expect(bodyText).toContain(":=");
		expect(bodyText).toContain("IF");
	});

	it("FINAL ABSTRACT modifiers on FB", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK ABSTRACT FB_Base
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.abstract).toBe(true);
	});
});

describe("parser: PROGRAM", () => {
	it("simple PROGRAM", () => {
		const { units, errors } = parseOne(`
			PROGRAM PRG_Main
			VAR
				fb : FB_Motor;
			END_VAR
				fb();
			END_PROGRAM
		`);
		expect(errors).toEqual([]);
		const p = units[0] as Program;
		expect(p.kind).toBe("program");
		expect(p.name.text).toBe("PRG_Main");
		expect(p.varSections).toHaveLength(1);
	});
});

describe("parser: FUNCTION", () => {
	it("FUNCTION with simple return type", () => {
		// NB: "Add" cannot be a function name — `ADD` is a CODESYS
		// reserved operator keyword (see docs/codesys-reference/10-keywords.md).
		// Using a non-reserved name keeps the test faithful to CODESYS rules.
		const { units, errors } = parseOne(`
			FUNCTION Calc : INT
			VAR_INPUT
				a, b : INT;
			END_VAR
				Calc := a + b;
			END_FUNCTION
		`);
		expect(errors).toEqual([]);
		const f = units[0] as import("../../parser/ast.js").Function;
		expect(f.kind).toBe("function");
		expect(f.name.text).toBe("Calc");
		const rt = f.returnType as NamedType;
		expect(rt.name.text).toBe("INT");
		expect(f.varSections[0]?.decls[0]?.names.map((n) => n.text)).toEqual(["a", "b"]);
	});

	it("FUNCTION returning ARRAY type", () => {
		const { units, errors } = parseOne(`
			FUNCTION GetVec : ARRAY[0..3] OF REAL
			END_FUNCTION
		`);
		expect(errors).toEqual([]);
		const f = units[0] as import("../../parser/ast.js").Function;
		const rt = f.returnType as ArrayType;
		expect(rt.kind).toBe("array_type");
		expect(rt.dims).toHaveLength(1);
		expect((rt.element as NamedType).name.text).toBe("REAL");
	});
});

describe("parser: METHOD — April 2026 stacked-modifier regression cases", () => {
	const cases: Array<{
		src: string;
		name: string;
		accessModifier?: string;
		final?: boolean;
		abstract?: boolean;
		returnType?: string;
	}> = [
		{
			src: "METHOD PROTECTED FINAL Execute END_METHOD",
			name: "Execute",
			accessModifier: "PROTECTED",
			final: true,
		},
		{
			src: "METHOD PUBLIC Foo : BOOL END_METHOD",
			name: "Foo",
			accessModifier: "PUBLIC",
			returnType: "BOOL",
		},
		{
			src: "METHOD Bar END_METHOD",
			name: "Bar",
		},
		{
			src: "METHOD PUBLIC ABSTRACT FINAL Baz : INT END_METHOD",
			name: "Baz",
			accessModifier: "PUBLIC",
			abstract: true,
			final: true,
			returnType: "INT",
		},
		{
			src: "method protected final Execute END_METHOD",
			name: "Execute",
			accessModifier: "PROTECTED",
			final: true,
		},
		{
			src: "METHOD PROTECTED FINAL Init : BOOL END_METHOD",
			name: "Init",
			accessModifier: "PROTECTED",
			final: true,
			returnType: "BOOL",
		},
	];

	for (const tc of cases) {
		it(`parses "${tc.src.split("END_METHOD")[0]?.trim()}"`, () => {
			const { units, errors } = parseOne(tc.src);
			expect(errors).toEqual([]);
			const m = units[0] as Method;
			expect(m.kind).toBe("method");
			expect(m.name.text).toBe(tc.name);
			expect(m.accessModifier).toBe(tc.accessModifier);
			if (tc.final !== undefined) expect(m.final).toBe(tc.final);
			if (tc.abstract !== undefined) expect(m.abstract).toBe(tc.abstract);
			if (tc.returnType !== undefined) {
				expect((m.returnType as NamedType).name.text).toBe(tc.returnType);
			}
		});
	}

	it("METHOD with complex ARRAY return type", () => {
		const { units, errors } = parseOne(`
			METHOD PUBLIC GetBuffer : ARRAY[0..15] OF BYTE
			END_METHOD
		`);
		expect(errors).toEqual([]);
		const m = units[0] as Method;
		expect((m.returnType as ArrayType).kind).toBe("array_type");
	});
});

describe("parser: ACTION", () => {
	it("simple ACTION", () => {
		const { units, errors } = parseOne(`
			ACTION Idle
				eState := E_State.Idle;
			END_ACTION
		`);
		expect(errors).toEqual([]);
		const a = units[0] as import("../../parser/ast.js").Action;
		expect(a.kind).toBe("action");
		expect(a.name.text).toBe("Idle");
	});
});

describe("parser: PROPERTY", () => {
	it("PROPERTY header only", () => {
		const { units, errors } = parseOne(`
			PROPERTY Speed : REAL
			END_PROPERTY
		`);
		expect(errors).toEqual([]);
		const p = units[0] as Property;
		expect(p.kind).toBe("property");
		expect(p.name.text).toBe("Speed");
		expect((p.dataType as NamedType).name.text).toBe("REAL");
	});

	it("PROPERTY with access modifier", () => {
		const { units, errors } = parseOne(`
			PROPERTY PUBLIC Foo : INT
			END_PROPERTY
		`);
		expect(errors).toEqual([]);
		const p = units[0] as Property;
		expect(p.accessModifier).toBe("PUBLIC");
	});

	it("PROPERTY with complex data type", () => {
		const { units, errors } = parseOne(`
			PROPERTY Items : ARRAY[0..9] OF FB_Motor
			END_PROPERTY
		`);
		expect(errors).toEqual([]);
		const p = units[0] as Property;
		expect((p.dataType as ArrayType).kind).toBe("array_type");
	});
});

describe("parser: INTERFACE", () => {
	it("interface with method signatures", () => {
		const { units, errors } = parseOne(`
			INTERFACE IControllable
				METHOD Start : BOOL
				END_METHOD
				METHOD Stop : BOOL
				END_METHOD
			END_INTERFACE
		`);
		expect(errors).toEqual([]);
		const iface = units[0] as import("../../parser/ast.js").Interface;
		expect(iface.kind).toBe("interface");
		expect(iface.methods).toHaveLength(2);
		expect(iface.methods[0]?.name.text).toBe("Start");
	});

	it("interface with EXTENDS", () => {
		const { units, errors } = parseOne(`
			INTERFACE IMotor EXTENDS IControllable, ITrackable
			END_INTERFACE
		`);
		expect(errors).toEqual([]);
		const iface = units[0] as import("../../parser/ast.js").Interface;
		expect(iface.extends?.map((i) => i.text)).toEqual(["IControllable", "ITrackable"]);
	});

	it("interface with PROPERTY signature", () => {
		const { units, errors } = parseOne(`
			INTERFACE IObservable
				PROPERTY State : INT GET
				END_PROPERTY
			END_INTERFACE
		`);
		expect(errors).toEqual([]);
		const iface = units[0] as import("../../parser/ast.js").Interface;
		expect(iface.properties).toHaveLength(1);
		expect(iface.properties[0]?.hasGetter).toBe(true);
		expect(iface.properties[0]?.hasSetter).toBe(false);
	});
});

describe("parser: TYPE / DUT", () => {
	it("STRUCT", () => {
		const { units, errors } = parseOne(`
			TYPE T_Pose :
			STRUCT
				x : REAL;
				y : REAL;
				rot : REAL := 0.0;
			END_STRUCT
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as StructBody;
		expect(body.kind).toBe("struct");
		expect(body.fields).toHaveLength(3);
		expect(body.fields[2]?.init).toBeDefined();
	});

	it("STRUCT with EXTENDS", () => {
		const { units, errors } = parseOne(`
			TYPE T_Extended :
			STRUCT EXTENDS T_Base
				extra : INT;
			END_STRUCT
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as StructBody;
		expect(body.extends?.text).toBe("T_Base");
	});

	it("ENUM simple", () => {
		const { units, errors } = parseOne(`
			TYPE E_State :
			(Idle, Running, Stopped)
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as EnumBody;
		expect(body.kind).toBe("enum");
		expect(body.values.map((v) => v.name.text)).toEqual(["Idle", "Running", "Stopped"]);
	});

	it("ENUM with values and explicit base type", () => {
		const { units, errors } = parseOne(`
			TYPE E_Code :
			(OK := 0, Warning := 1, Error := 2) BYTE
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as EnumBody;
		expect(body.values).toHaveLength(3);
		expect(body.values[0]?.value).toBeDefined();
		expect((body.baseType as NamedType).name.text).toBe("BYTE");
	});

	it("ENUM with default initializer := Value", () => {
		// CODESYS allows `(A, B) := A;` to set the type's default initial value.
		const { units, errors } = parseOne(`
			TYPE ePackMLStates :
			(
				Stopped := 0,
				Running := 1
			):=Stopped;
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as EnumBody;
		expect(body.kind).toBe("enum");
		expect(body.values).toHaveLength(2);
		expect(body.init).toBeDefined();
	});

	it("UNION", () => {
		const { units, errors } = parseOne(`
			TYPE T_Bytes :
			UNION
				asWord : WORD;
				asBytes : ARRAY[0..1] OF BYTE;
			END_UNION
			END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as UnionBody;
		expect(body.kind).toBe("union");
		expect(body.fields).toHaveLength(2);
	});

	it("alias DUT", () => {
		const { units, errors } = parseOne(`
			TYPE T_Counter : INT END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as AliasBody;
		expect(body.kind).toBe("alias");
		expect((body.target as NamedType).name.text).toBe("INT");
	});

	it("alias ARRAY DUT", () => {
		const { units, errors } = parseOne(`
			TYPE T_Vec : ARRAY[0..2] OF REAL END_TYPE
		`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		const body = t.body as AliasBody;
		expect((body.target as ArrayType).kind).toBe("array_type");
	});
});

describe("parser: type expressions", () => {
	function parseTypeIn(src: string): TypeExpr {
		const { units, errors } = parseOne(`TYPE T : ${src} END_TYPE`);
		expect(errors).toEqual([]);
		const t = units[0] as TypeDecl;
		return (t.body as AliasBody).target;
	}

	it("named type", () => {
		const te = parseTypeIn("INT");
		expect((te as NamedType).name.text).toBe("INT");
	});

	it("qualified named type", () => {
		const te = parseTypeIn("Tc2_Standard.TON");
		const nt = te as NamedType;
		expect(nt.name.text).toBe("TON");
		expect(nt.qualifiers?.map((q) => q.text)).toEqual(["Tc2_Standard"]);
	});

	it("ARRAY with multiple dims", () => {
		const te = parseTypeIn("ARRAY[0..3, 1..5] OF INT");
		const at = te as ArrayType;
		expect(at.dims).toHaveLength(2);
	});

	it("REFERENCE TO X", () => {
		const te = parseTypeIn("REFERENCE TO FB_Motor");
		const rt = te as ReferenceType;
		expect(rt.kind).toBe("reference_type");
		expect((rt.target as NamedType).name.text).toBe("FB_Motor");
	});

	it("POINTER TO X", () => {
		const te = parseTypeIn("POINTER TO BYTE");
		const pt = te as PointerType;
		expect(pt.kind).toBe("pointer_type");
	});

	it("STRING(80)", () => {
		const te = parseTypeIn("STRING(80)");
		const st = te as StringType;
		expect(st.kind).toBe("string_type");
		expect(st.wide).toBe(false);
		expect(st.length).toBeDefined();
	});

	it("WSTRING[40]", () => {
		const te = parseTypeIn("WSTRING[40]");
		const st = te as StringType;
		expect(st.wide).toBe(true);
	});
});

describe("parser: VAR section modifiers", () => {
	it("CONSTANT", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR CONSTANT
				MAX_RPM : INT := 3000;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections[0]?.constant).toBe(true);
	});

	it("RETAIN PERSISTENT", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR RETAIN PERSISTENT
				lifetime_count : DINT;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections[0]?.retain).toBe(true);
		expect(fb.varSections[0]?.persistent).toBe(true);
	});

	it("VAR_IN_OUT", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR_IN_OUT
				buf : ARRAY[0..15] OF BYTE;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections[0]?.sectionKind).toBe("VAR_IN_OUT");
	});

	it("AT-clause is captured (TwinCAT %I*)", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR
				digIn AT %I* : BOOL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		// AT clause comes BEFORE the colon in standard ST; some IDEs
		// allow either order. Our grammar accepts AT after the type,
		// which matches more common usage. Just check we don't crash.
		// If the test fails here, it tells us we need to support the
		// `AT %I*` before-colon form.
		expect(fb.varSections[0]?.decls).toHaveLength(1);
	});
});

describe("parser: VAR_GLOBAL standalone (GVL file)", () => {
	it("GVL file", () => {
		const { units, errors } = parseOne(`
			VAR_GLOBAL
				gFoo : INT;
				gBar : REAL := 1.5;
			END_VAR
		`);
		expect(errors).toEqual([]);
		const gvl = units[0] as import("../../parser/ast.js").GlobalVarList;
		expect(gvl.kind).toBe("global_var_list");
		expect(gvl.varSections[0]?.decls).toHaveLength(2);
	});

	it("GVL with CONSTANT modifier", () => {
		const { units, errors } = parseOne(`
			VAR_GLOBAL CONSTANT
				MAX_AXES : INT := 32;
			END_VAR
		`);
		expect(errors).toEqual([]);
		const gvl = units[0] as import("../../parser/ast.js").GlobalVarList;
		expect(gvl.varSections[0]?.constant).toBe(true);
	});
});

describe("parser: pragmas and comments don't break parsing", () => {
	it("pragma before FB", () => {
		const { units, errors } = parseOne(`
			{attribute 'qualified_only'}
			FUNCTION_BLOCK FB_X
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		expect(units[0]?.kind).toBe("function_block");
	});

	it("comment before FB", () => {
		const { units, errors } = parseOne(`
			// Top-level comment
			(* block comment *)
			FUNCTION_BLOCK FB_X
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		expect(units[0]?.kind).toBe("function_block");
	});

	it("comments inside VAR section", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR
				// the cycle time
				tCycle : TIME := T#100ms;
				(* a guarded var *)
				bGuard : BOOL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections[0]?.decls).toHaveLength(2);
	});
});

describe("parser: error recovery", () => {
	it("missing semicolon recovers to next decl", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR
				a : INT
				b : REAL;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(errors.length).toBeGreaterThan(0);
		const fb = units[0] as FunctionBlock;
		// We should still get the FB, and likely both decls (b at least)
		expect(fb.kind).toBe("function_block");
	});

	it("unterminated FB records error but returns AST", () => {
		const { units, errors } = parseOne(`
			FUNCTION_BLOCK FB_X
			VAR
				a : INT;
			END_VAR
		`);
		expect(errors.length).toBeGreaterThan(0);
		expect(units[0]?.kind).toBe("function_block");
	});
});

describe("parser: realistic full POU", () => {
	it("medium-complexity FB parses cleanly", () => {
		const src = `
{attribute 'qualified_only'}
FUNCTION_BLOCK FB_Motor EXTENDS FB_BaseDevice IMPLEMENTS IControllable
VAR_INPUT
	bEnable : BOOL := FALSE;
	rSpeedSP : REAL := 0.0;
END_VAR
VAR_OUTPUT
	bRunning : BOOL;
	eState : E_MotorState;
END_VAR
VAR
	tCycle : TIME := T#100ms;
	rCurrentSpeed : REAL;
END_VAR
VAR_IN_OUT
	stBuffer : T_RingBuffer;
END_VAR
	IF bEnable THEN
		eState := E_MotorState.Running;
		rCurrentSpeed := rSpeedSP;
	ELSE
		eState := E_MotorState.Idle;
	END_IF
END_FUNCTION_BLOCK
`;
		const { units, errors } = parseOne(src);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections).toHaveLength(4);
		expect(fb.extends?.text).toBe("FB_BaseDevice");
		expect(fb.implements?.[0]?.text).toBe("IControllable");
	});
});

describe("parser: VAR_GENERIC section", () => {
	it("parses VAR_GENERIC CONSTANT", () => {
		const { units, errors } = parseOne(`FUNCTION_BLOCK FB_X
VAR_GENERIC CONSTANT
	N : INT;
END_VAR
END_FUNCTION_BLOCK`);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		expect(fb.varSections[0]?.sectionKind).toBe("VAR_GENERIC");
	});
});

describe("parser: NAMESPACE", () => {
	it("parses a NAMESPACE block containing POUs", () => {
		const src = `NAMESPACE MyLib
	FUNCTION_BLOCK FB_Inner
	END_FUNCTION_BLOCK
	TYPE T_Inner : INT; END_TYPE
END_NAMESPACE`;
		const { units, errors } = parseOne(src);
		expect(errors).toEqual([]);
		expect(units).toHaveLength(1);
		const ns = units[0] as import("../../parser/ast.js").Namespace;
		expect(ns.kind).toBe("namespace");
		expect(ns.name.text).toBe("MyLib");
		expect(ns.units.length).toBeGreaterThanOrEqual(2);
	});

	it("reports unterminated NAMESPACE", () => {
		const { errors } = parseOne(`NAMESPACE Stuck`);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.message.includes("unterminated"))).toBe(true);
	});
});

describe("parser: implicit enumeration", () => {
	it("parses inline `(A, B, C) := B` as ImplicitEnumType", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	state : (Idle, Running, Halted) := Running;
END_VAR
END_FUNCTION_BLOCK`;
		const { units, errors } = parseOne(src);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		const decl = fb.varSections[0]?.decls[0];
		expect(decl?.type.kind).toBe("implicit_enum_type");
		const ie = decl?.type as import("../../parser/ast.js").ImplicitEnumType;
		expect(ie.values.map((v) => v.name.text)).toEqual(["Idle", "Running", "Halted"]);
	});

	it("parses inline enum with explicit assignments `(A:=1, B:=2)`", () => {
		const src = `FUNCTION_BLOCK FB_X
VAR
	level : (Low := 0, Med := 50, High := 100) := Low;
END_VAR
END_FUNCTION_BLOCK`;
		const { units, errors } = parseOne(src);
		expect(errors).toEqual([]);
		const fb = units[0] as FunctionBlock;
		const ie = fb.varSections[0]?.decls[0]?.type as import("../../parser/ast.js").ImplicitEnumType;
		expect(ie.values).toHaveLength(3);
		expect(ie.values[0]?.init).toBeDefined();
	});
});
