/**
 * STRING → integer over every recorded cell of `parse.cases.ts` (transpile-restructure 6.A.10): `parseInteger`, then the
 * target's store (`fit`). The parse read decimal digits only, so '16#FF' was 16 where CODESYS reads 255. And WSTRING →
 * integer (8.2): `parseIntegerWide`, which answers only a parse that reads the whole text — both backends narrowed a
 * WSTRING and parsed it as a STRING, so "5 " was 5 where CODESYS reads 0 (`wstring_parse_trailing_spaces`).
 */
import { expect, test } from "bun:test"
import { elementaryRef, elementaryType } from "../../frontend/types/index.js"
import { PARSE_INT_CASES, WIDE_PARSE_INT_CASES } from "./parse.cases.js"
import { parseInteger, parseIntegerWide } from "./parse.js"
import { fit } from "./store.js"

/** Whether a parse's target is unsigned — a negative text into one is 0 (`wstring_parse_widths`, gate 8c). */
function unsigned(to: string): boolean {
  const elem = elementaryType(to)
  if (elem === undefined) throw new Error(`no elementary type ${to}`)
  return !elem.signed
}

test("STRING → integer answers every recorded cell — the based and typed forms, underscores, signs, widths", () => {
  expect(PARSE_INT_CASES).toHaveLength(47 + 108)
  const got = PARSE_INT_CASES.map((c) => `${c.name}: ${fit(parseInteger(c.input.text, unsigned(c.input.to)), elementaryRef(c.input.to))}`)
  expect(got).toEqual(PARSE_INT_CASES.map((c) => `${c.name}: ${c.expected}`))
})

test("WSTRING → integer answers every recorded cell — the STRING parse's reading, only where it reads the whole text", () => {
  expect(WIDE_PARSE_INT_CASES).toHaveLength(46 + 108)
  const got = WIDE_PARSE_INT_CASES.map((c) => `${c.name}: ${fit(parseIntegerWide(c.input.text, unsigned(c.input.to)), elementaryRef(c.input.to))}`)
  expect(got).toEqual(WIDE_PARSE_INT_CASES.map((c) => `${c.name}: ${c.expected}`))
})
