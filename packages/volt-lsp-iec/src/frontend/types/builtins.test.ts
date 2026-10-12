/** EXPT's type (openspec transpile-restructure 1.1.8; conformance `cc_expt_*`, `expt_types`, `expt_mixed_width`). */
import { expect, test } from "bun:test"
import { builtinName, exptResultType } from "./builtins.js"
import { elementaryRef, elemOf } from "./type.js"

test("exptResultType: REAL only when both arguments are REAL, LREAL otherwise", () => {
  const expt = (a: string, b: string): string | undefined => elemOf(exptResultType(elementaryRef(a), elementaryRef(b)))?.name
  expect([expt("REAL", "REAL"), expt("INT", "INT"), expt("REAL", "INT"), expt("LREAL", "REAL"), expt("DINT", "LREAL")]).toEqual([
    "REAL",
    "LREAL",
    "LREAL",
    "LREAL",
    "LREAL",
  ])
})

// lsp-same-standard 3.1, findings R4 + R8: what a name is comes from ONE fact per dialect. A type name is a type only where
// the dialect has it — `LDATE` hovered and coloured as a type on TwinCAT, which has no such type — and a platform integer
// is a type though it is spelled `__` (it answered "system-operator": the `__` test ran first).
test("builtinName: a type only where the dialect has it; the platform integers are types", () => {
  for (const d of ["codesys", "twincat"] as const) {
    expect(["__XINT", "__UXINT", "__XWORD", "INT"].map((n) => builtinName(n, d))).toEqual(["type", "type", "type", "type"])
    expect(builtinName("__SYSTEM", d)).toBe("system-operator")
  }
  expect(["LDATE", "LTOD", "LDT", "LTIME_OF_DAY", "LDATE_AND_TIME"].map((n) => builtinName(n, "codesys"))).toEqual(["type", "type", "type", "type", "type"])
  expect(["LDATE", "LTOD", "LDT", "LTIME_OF_DAY", "LDATE_AND_TIME"].map((n) => builtinName(n, "twincat"))).toEqual([undefined, undefined, undefined, undefined, undefined])
})
