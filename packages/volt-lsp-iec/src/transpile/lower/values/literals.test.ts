/**
 * Lowering tests of `literals.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { elementaryType, elementaryTypeRef } from "../../../frontend/types/index.js"
import { stored } from "../values/convert.js"

// STORE-AT-WIDTH REACHES A TEMPORAL, which `stored`'s own family list said it did and its rank guard prevented.
// Only BIT is an int/bit-string family with no rank, so `rank === undefined` excluded every TIME and DATE too —
// and `fit` (the interpreter's copy of the same rule) has no such guard. Two backends, one program, two answers.
test("an over-range TIME initializer wraps at its width, in lowering as in the interpreter", () => {
	const over = 2n ** 32n + 5n
	expect(stored(over, elementaryTypeRef(elementaryType("TIME")!))).toBe(5n)
	expect(stored(over, elementaryTypeRef(elementaryType("DATE")!))).toBe(5n)
	// the 64-bit ones do not wrap there
	expect(stored(over, elementaryTypeRef(elementaryType("LTIME")!))).toBe(over)
	// …and a BIT still does not wrap — it holds a boolean, which is what the rank guard was really excluding
	expect(stored(1n, elementaryTypeRef(elementaryType("BIT")!))).toBe(1n)
	// the integer rule it always had is unchanged
	expect(stored(40000n, elementaryTypeRef(elementaryType("INT")!))).toBe(-25536n)
})
