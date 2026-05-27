import { describe, expect, it } from "vitest";
import { parseSource } from "../../parser/parser.js";
import { buildDocumentSymbols } from "./document-symbol.js";
import { LspSymbolKind } from "../types.js";

function symbols(src: string) {
	return buildDocumentSymbols(parseSource(src));
}

describe("documentSymbol: top-level POU", () => {
	it("FB with var sections yields nested children", () => {
		const out = symbols(`
			FUNCTION_BLOCK FB_Motor
			VAR_INPUT
				bEnable : BOOL;
			END_VAR
			VAR
				tCycle : TIME;
			END_VAR
			END_FUNCTION_BLOCK
		`);
		expect(out).toHaveLength(1);
		expect(out[0]?.name).toBe("FB_Motor");
		expect(out[0]?.kind).toBe(LspSymbolKind.Class);
		expect(out[0]?.children?.map((c) => c.name)).toEqual(["bEnable", "tCycle"]);
	});

	it("FB detail includes EXTENDS and IMPLEMENTS", () => {
		const out = symbols(`
			FUNCTION_BLOCK FB_X EXTENDS FB_Base IMPLEMENTS IFoo
			END_FUNCTION_BLOCK
		`);
		expect(out[0]?.detail).toContain("EXTENDS FB_Base");
		expect(out[0]?.detail).toContain("IMPLEMENTS IFoo");
	});

	it("METHOD modifiers in detail", () => {
		const out = symbols(`
			METHOD PROTECTED FINAL Execute : BOOL
			END_METHOD
		`);
		expect(out[0]?.detail).toContain("PROTECTED");
		expect(out[0]?.detail).toContain("FINAL");
	});

	it("TYPE STRUCT contains fields", () => {
		const out = symbols(`
			TYPE T_P :
			STRUCT
				x : REAL;
				y : REAL;
			END_STRUCT
			END_TYPE
		`);
		expect(out[0]?.kind).toBe(LspSymbolKind.Struct);
		expect(out[0]?.children?.map((c) => c.name)).toEqual(["x", "y"]);
	});

	it("TYPE ENUM contains values", () => {
		const out = symbols(`TYPE E : (A, B, C) END_TYPE`);
		expect(out[0]?.kind).toBe(LspSymbolKind.Enum);
		expect(out[0]?.children?.map((c) => c.name)).toEqual(["A", "B", "C"]);
		expect(out[0]?.children?.[0]?.kind).toBe(LspSymbolKind.EnumMember);
	});

	it("INTERFACE contains methods and properties", () => {
		const out = symbols(`
			INTERFACE IMotor
				METHOD Start : BOOL
				END_METHOD
				PROPERTY Speed : REAL GET
				END_PROPERTY
			END_INTERFACE
		`);
		expect(out[0]?.kind).toBe(LspSymbolKind.Interface);
		expect(out[0]?.children?.map((c) => c.name)).toEqual(["Start", "Speed"]);
	});

	it("ranges use 0-based lines (LSP convention)", () => {
		const out = symbols(`FUNCTION_BLOCK FB_X END_FUNCTION_BLOCK`);
		expect(out[0]?.range.start.line).toBe(0);
		expect(out[0]?.selectionRange.start.line).toBe(0);
	});
});
