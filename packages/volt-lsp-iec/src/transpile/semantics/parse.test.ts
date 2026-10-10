/**
 * STRING → integer over every recorded cell of `parse.cases.ts` (transpile-restructure 6.A.10): `parseInteger`, then the
 * target's store (`fit`). The parse read decimal digits only, so '16#FF' was 16 where CODESYS reads 255.
 */
import { expect, test } from "bun:test"
import { elementaryRef } from "../../frontend/types/index.js"
import { PARSE_INT_CASES } from "./parse.cases.js"
import { parseInteger } from "./parse.js"
import { fit } from "./store.js"

test("STRING → integer answers every recorded cell — the based and typed forms, underscores, signs, widths", () => {
  expect(PARSE_INT_CASES).toHaveLength(48)
  const got = PARSE_INT_CASES.map((c) => `${c.name}: ${fit(parseInteger(c.input.text), elementaryRef(c.input.to))}`)
  expect(got).toEqual(PARSE_INT_CASES.map((c) => `${c.name}: ${c.expected}`))
})
