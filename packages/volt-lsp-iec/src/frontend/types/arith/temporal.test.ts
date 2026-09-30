import { expect, test } from "bun:test"
import { temporalResultType } from "./temporal.js"

// transpile-review-2026-09-29 task 40 (`tr_40_*`): a 32-bit date (DATE, DT, TOD) and an LTIME are no temporal pair —
// CODESYS computes them as ULINT and refuses the result ("Cannot convert type 'LTIME' to type 'ULINT'" …).
test("DATE / DT / TOD with an LTIME is no temporal pair, either order; with a TIME it is", () => {
  expect(temporalResultType("+", "DATE", "LTIME")).toBeUndefined()
  expect(temporalResultType("+", "DT", "LTIME")).toBeUndefined()
  expect(temporalResultType("-", "TOD", "LTIME")).toBeUndefined()
  expect(temporalResultType("+", "LTIME", "DATE")).toBeUndefined()
  expect(temporalResultType("+", "DATE", "TIME")).toBe("DATE")
  expect(temporalResultType("-", "TOD", "TIME")).toBe("TOD")
})
