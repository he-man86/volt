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

// transpile-restructure 1.1.8: a date minus the same date is its duration (32-bit dates TIME, the L variants LTIME); a date
// plus or minus a duration, and a duration plus a date, are the date; two different dates are no pair.
test("temporalResultType: date - date is its duration; date ± duration and duration + date are the date", () => {
  expect(["DATE", "DT", "TOD", "LDATE", "LDT", "LTOD"].map((d) => temporalResultType("-", d, d))).toEqual(["TIME", "TIME", "TIME", "LTIME", "LTIME", "LTIME"])
  expect([temporalResultType("+", "TIME", "DT"), temporalResultType("-", "LDT", "LTIME"), temporalResultType("+", "TIME", "TIME")]).toEqual(["DT", "LDT", undefined])
  expect([temporalResultType("-", "DATE", "DT"), temporalResultType("-", "TIME", "DATE")]).toEqual([undefined, undefined])
})
