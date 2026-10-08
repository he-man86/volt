/**
 * Lowering tests of `calendar.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { lowerSource } from "../index.js"

// transpile-review 40: DATE / DT / TOD ± LTIME narrowed the duration into the date's 32 bits before scaling. CODESYS
// refuses every form (`tr_40_*`: "Cannot convert type 'LTIME' to type 'ULINT'").
test("a 32-bit date plus or minus an LTIME is refused", () => {
  const codes = (vars: string, body: string) =>
    lowerSource(`PROGRAM P\nVAR ${vars} END_VAR\n${body}\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(codes("d : DATE; dur : LTIME := LTIME#1D;", "d := d + dur;")).toEqual(["calendar-width"])
  expect(codes("d : DT; dur : LTIME := LTIME#1D;", "d := d + dur;")).toEqual(["calendar-width"])
  expect(codes("t : TOD; dur : LTIME := LTIME#1H;", "t := t - dur;")).toEqual(["calendar-width"])
  expect(codes("d : DATE; dur : LTIME := LTIME#1D;", "d := dur + d;")).toEqual(["calendar-width"])
  expect(codes("d : DATE; dur : TIME := T#1D;", "d := d + dur;")).toEqual([])
})
