/**
 * Offline unit tests for `bridgeDiagnosticFileLine`. The `(object, line)`
 * inputs are the EXACT coordinates TwinCAT produced in the live probe
 * (`volt-agent/src/tests/live/tc-diagnostic-lines.test.ts`), so this pins
 * the mapping without needing a bridge.
 */
import { describe, expect, test } from "bun:test";
import { bridgeDiagnosticFileLine } from "../../bridge-diagnostic-lines.js";

const DECL = ["FUNCTION_BLOCK FB_D", "VAR", "\tx : INTT;", "END_VAR", "END_FUNCTION_BLOCK", ""].join("\n");
const IMPL = ["FUNCTION_BLOCK FB_I", "VAR", "\tx : INT;", "END_VAR", "x := nope + 1;", "END_FUNCTION_BLOCK", ""].join("\n");
const METHOD = [
	"FUNCTION_BLOCK FB_M", "VAR", "\tx : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
	"METHOD DoWork", "VAR_INPUT", "\tn : BADTYPE;", "END_VAR", "x := nope;", "END_METHOD", "",
].join("\n");
const GAP = [
	"FUNCTION_BLOCK FB_G", "VAR", "\tx : INT;", "\ty : INT;", "END_VAR", "",
	"x := 1;", "y := nope;", "END_FUNCTION_BLOCK", "",
].join("\n");
// blank line WITHIN the decl — the IDE preserves it (no stripping).
const DECLGAP = ["FUNCTION_BLOCK FB_DG", "", "VAR", "\tx : BADTYPE;", "END_VAR", "END_FUNCTION_BLOCK", ""].join("\n");
// property accessors are 3-part objects (FB.Prop.Get / .Set); the GET/SET
// keyword is not counted, a var-less accessor shows a phantom 2-line VAR.
const PGET = [
	"FUNCTION_BLOCK FB_PG", "VAR", "\tiBack : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
	"PROPERTY Value : INT", "GET", "Value := nope;", "END_GET", "END_PROPERTY", "",
].join("\n");
const PGETVAR = [
	"FUNCTION_BLOCK FB_PGV", "VAR", "\tiBack : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
	"PROPERTY Value : INT", "GET", "VAR", "\ttmp : BADTYPE;", "END_VAR", "Value := iBack;", "END_GET", "END_PROPERTY", "",
].join("\n");
const PSET = [
	"FUNCTION_BLOCK FB_PS", "VAR", "\tiBack : INT;", "END_VAR", "END_FUNCTION_BLOCK", "",
	"PROPERTY Value : INT", "GET", "Value := iBack;", "END_GET", "SET", "iBack := nope;", "END_SET", "END_PROPERTY", "",
].join("\n");

describe("bridgeDiagnosticFileLine", () => {
	test("parent decl: line is counted from the header", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_D", line: 3 }, DECL)).toBe(2);
	});

	test("parent impl: line continues past the declaration", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_I", line: 5 }, IMPL)).toBe(4);
	});

	test("method decl: counted from the METHOD header", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_M.DoWork", line: 3 }, METHOD)).toBe(8);
	});

	test("method impl: decl(4) + impl line 1", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_M.DoWork", line: 5 }, METHOD)).toBe(10);
	});

	test("decl/impl gap: leading blank in the body is NOT counted by the IDE", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_G", line: 7 }, GAP)).toBe(7);
	});

	test("declaration blanks are preserved (not stripped like impl)", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_DG", line: 4 }, DECLGAP)).toBe(3);
	});

	test("property GET body: 3-part object, var-less accessor body offset by 2", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_PG.Value.Get", line: 3 }, PGET)).toBe(8);
	});

	test("property GET decl with VAR: counts from VAR, not GET", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_PGV.Value.Get", line: 2 }, PGETVAR)).toBe(9);
	});

	test("property GET body past a user VAR block", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_PGV.Value.Get", line: 4 }, PGETVAR)).toBe(11);
	});

	test("property SET body maps to the setter", () => {
		expect(bridgeDiagnosticFileLine({ object: "FB_PS.Value.Set", line: 3 }, PSET)).toBe(11);
	});

	test("returns undefined for project-level / missing / cross-file objects", () => {
		expect(bridgeDiagnosticFileLine({ object: null, line: 5 }, IMPL)).toBeUndefined();
		expect(bridgeDiagnosticFileLine({ object: "FB_I", line: 0 }, IMPL)).toBeUndefined();
		expect(bridgeDiagnosticFileLine({ object: "FB_Elsewhere", line: 3 }, IMPL)).toBeUndefined();
		expect(bridgeDiagnosticFileLine({ object: "FB_M.NoSuchMethod", line: 3 }, METHOD)).toBeUndefined();
	});

	test("name matching is case-insensitive (ST convention)", () => {
		expect(bridgeDiagnosticFileLine({ object: "fb_d", line: 3 }, DECL)).toBe(2);
	});
});
