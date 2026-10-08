/**
 * Lowering tests of `case.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { lowerSource } from "../index.js"

// transpile-review 37: a CASE label outside the selector's type, or a range that is inverted (once its bounds are in the
// type), reached the emitter verbatim. CODESYS refuses all four (`tr_37_case_*`): "Cannot convert type 'INT' to type
// 'SINT'" for 300 / -212 on a SINT, "Lower border must be lower than upper border" for 5..1 and 0..200.
test("a CASE label outside the selector's type, or an inverted range, is refused", () => {
  const codes = (label: string) =>
    lowerSource(`PROGRAM P\nVAR sv : SINT := 44; rv : INT; END_VAR\nCASE sv OF ${label}: rv := 1; ELSE rv := 2; END_CASE\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(codes("300")).toEqual(["case-label-type"])
  expect(codes("-212")).toEqual(["case-label-type"])
  expect(codes("5..1")).toEqual(["case-label-type"])
  expect(codes("0..200")).toEqual(["case-label-type"])
  expect(codes("-128, 127, 1..100")).toEqual([])
})
