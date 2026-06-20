/**
 * CLI first line of defence: a workspace file's extension must match its content. The bridge is
 * extension-agnostic (it sees a bare name + content), so a `.st`→`.fbd` rename can ONLY be caught here —
 * before a push reaches the bridge. Mirrors the bridge's VgBody body-language detection.
 */
import { describe, test, expect } from "bun:test"
import { validateExtensionMatchesContent } from "../merge/ops.js"

const ST = "PROGRAM Foo\nVAR\n\tx : BOOL;\nEND_VAR\n\nx := TRUE;\nEND_PROGRAM\n"
const FBD = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := x;\n  y := i1;\nEND_NETWORK\n"
const LD = "NETWORK 0 LD\n  VAR_TEMP\n    i1 : BOOL;\n  END_VAR\n  i1 := a;\n  q := i1;\nEND_NETWORK\n"
describe("extension↔content guard", () => {
	test("matching files pass", () => {
		expect(() => validateExtensionMatchesContent("POUs/Foo.st", ST)).not.toThrow()
		expect(() => validateExtensionMatchesContent("POUs/Foo.fbd", FBD)).not.toThrow()
		expect(() => validateExtensionMatchesContent("POUs/Foo.ld", LD)).not.toThrow()
		expect(() => validateExtensionMatchesContent("DUTs/Bar.struct", "TYPE Bar :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE\n")).not.toThrow()
	})

	test("a .fbd holding ST text is refused (the .st→.fbd rename)", () => {
		expect(() => validateExtensionMatchesContent("POUs/Foo.fbd", ST)).toThrow(/\.fbd file but contains plain ST text/)
	})

	test("a .fbd holding an LD body is refused (language mismatch)", () => {
		expect(() => validateExtensionMatchesContent("POUs/Foo.fbd", LD)).toThrow(/body language is LD/)
	})

	test("a .st holding a graphical body is refused", () => {
		expect(() => validateExtensionMatchesContent("POUs/Foo.st", FBD)).toThrow(/graphical body/)
	})

	test("a textual DUT extension holding a graphical body is refused", () => {
		expect(() => validateExtensionMatchesContent("DUTs/Bar.struct", FBD)).toThrow(/graphical body/)
	})
})
