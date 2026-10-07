/** The elementary type table and the views derived from it (from `types.test.ts`, transpile-restructure 1.1.11). */
import { expect, test } from "bun:test"
import { ELEMENTARY_TYPES, elementaryType, isIntegerType, isNumericType } from "./index.js"
import { isIsolated, numericRank } from "./predicates.js"

test("elementary facts: ranges, bits, signedness", () => {
  expect(elementaryType("INT")).toMatchObject({ family: "int", bits: 16, signed: true })
  expect(elementaryType("INT")?.range).toEqual({ min: -32768n, max: 32767n })
  expect(elementaryType("BYTE")?.range).toEqual({ min: 0n, max: 255n })
  expect(elementaryType("LWORD")?.range).toEqual({ min: 0n, max: 18446744073709551615n })
  expect(elementaryType("TIME_OF_DAY")?.name).toBe("TOD") // alias canonicalization
  expect(elementaryType("NotAType")).toBeUndefined()
})

test("derived views match the legacy explicit sets", () => {
  const names = [...ELEMENTARY_TYPES.keys()]
  // Integer types = int/bitstring with a rank (BIT excluded — no rank).
  expect(names.filter(isIntegerType).sort()).toEqual(
    ["BYTE", "DINT", "DWORD", "INT", "LINT", "LWORD", "SINT", "UDINT", "UINT", "ULINT", "USINT", "WORD"].sort(),
  )
  // Numeric = everything with a widening rank (integers + REAL/LREAL).
  expect(names.filter(isNumericType).sort()).toEqual(
    [
      "BYTE",
      "DINT",
      "DWORD",
      "INT",
      "LINT",
      "LREAL",
      "LWORD",
      "REAL",
      "SINT",
      "UDINT",
      "UINT",
      "ULINT",
      "USINT",
      "WORD",
    ].sort(),
  )
  // Widening rank lattice: SINT..LREAL = 1..6.
  expect([numericRank("SINT"), numericRank("INT"), numericRank("DINT"), numericRank("LINT")]).toEqual([1, 2, 3, 4])
  expect([numericRank("REAL"), numericRank("LREAL")]).toEqual([5, 6])
  // Isolated families (no cross-family implicit conversion).
  expect(isIsolated("BOOL")).toBe(true)
  expect(isIsolated("STRING")).toBe(true)
  expect(isIsolated("TIME")).toBe(true)
  expect(isIsolated("INT")).toBe(false)
})

test("the parser's elementary type words are every name an elementary type answers to (frontend-conformance 2.8.3, R6)", async () => {
  // `syntax/lex/vocabulary.ts` `ELEMENTARY_TYPE_WORDS` is what the parser refuses where a name belongs; the syntax layer
  // may not import this one, so the two lists are held to each other here
  const { ELEMENTARY_TYPE_WORDS } = await import("../syntax/index.js")
  const { ELEMENTARY_TYPES, ELEM_ALIASES } = await import("./elementary.js")
  const { PLATFORM_ALIASES } = await import("./platform.js")
  const names = [...ELEMENTARY_TYPES.keys(), ...ELEM_ALIASES.keys(), ...PLATFORM_ALIASES.keys()].sort()
  expect([...ELEMENTARY_TYPE_WORDS].sort()).toEqual(names)
})
