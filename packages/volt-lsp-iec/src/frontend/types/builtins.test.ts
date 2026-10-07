/** EXPT's type (openspec transpile-restructure 1.1.8; conformance `cc_expt_*`, `expt_types`, `expt_mixed_width`). */
import { expect, test } from "bun:test"
import { exptResultType } from "./builtins.js"
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
