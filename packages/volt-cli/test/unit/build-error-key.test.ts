/**
 * A build error told apart independent of the IDE's UI language (openspec environment-dependency-audit 2.6): CODESYS
 * answers in its UI language (a German one, measured, writes "Bezeichner 'x' nicht definiert" under C0046), so a coded
 * diagnostic is its item, its code and the identifiers it quotes; an uncoded one (TwinCAT, whose compiler stays
 * English — DIALECT D42) is its whole message.
 */
import { describe, expect, it } from "bun:test"
import { buildErrorKey, expectedBuildErrorKey } from "../e2e/lib/build-error-key"

describe("build error key", () => {
	it("a coded error is item + code + quoted identifiers, whatever language the message is in", () => {
		const en = { name: "PLC_PRG", code: "C0046", message: "Identifier 'x_g' not defined" }
		const de = { name: "PLC_PRG", code: "C0046", message: "Bezeichner 'x_g' nicht definiert" }
		expect(buildErrorKey(de)).toBe(buildErrorKey(en))
		expect(buildErrorKey(en)).toBe("PLC_PRG: C0046 [x_g]")
	})

	it("identifiers nested in another quote are read; their order is not the language's", () => {
		expect(buildErrorKey({ name: "M", code: "C0032", message: "Cannot convert type 'Unknown type: 'X_g'' to type 'INT'" })).toBe(
			"M: C0032 [INT,X_g]",
		)
		expect(buildErrorKey({ name: "M", code: "C0032", message: "Typ 'INT' kann nicht aus 'Unbekannter Typ: 'X_g'' konvertiert werden" })).toBe(
			"M: C0032 [INT,X_g]",
		)
	})

	it("a different code, item or identifier is a different error", () => {
		const k = buildErrorKey({ name: "M", code: "C0077", message: "Unknown type: 'A'" })
		expect(buildErrorKey({ name: "M", code: "C0046", message: "Unknown type: 'A'" })).not.toBe(k)
		expect(buildErrorKey({ name: "N", code: "C0077", message: "Unknown type: 'A'" })).not.toBe(k)
		expect(buildErrorKey({ name: "M", code: "C0077", message: "Unknown type: 'B'" })).not.toBe(k)
	})

	it("an uncoded error is its whole message", () => {
		expect(buildErrorKey({ name: "M", message: "Unknown type: 'A'" })).toBe("M: Unknown type: 'A'")
	})

	it("the expected key takes the code only where the vendor reports one", () => {
		const row = { code: "C0077", message: "Unknown type: 'A'" }
		expect(expectedBuildErrorKey("M", row, true)).toBe("M: C0077 [A]")
		expect(expectedBuildErrorKey("M", row, false)).toBe("M: Unknown type: 'A'")
	})

	it("a coded error that quotes no identifier is refused, not keyed on its code alone", () => {
		expect(() => buildErrorKey({ name: "M", code: "C0001", message: "Syntax error" })).toThrow(/quotes no identifier/)
	})
})
