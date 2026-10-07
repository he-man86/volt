import { expect, test } from "bun:test"
import { globalsArgs, globalsParams, tmp } from "./names.js"

test("a generated temporary is `__<purpose>`, numbered as `__<purpose>_<n>`", () => {
  expect([tmp("program"), tmp("mod_l"), tmp("arg", 0), tmp("guard", 3), tmp("lent", 1n)]).toEqual([
    "__program",
    "__mod_l",
    "__arg_0",
    "__guard_3",
    "__lent_1",
  ])
})

test("`g` and `prg` as arguments and as parameters — one list, in that order, as far as the program has them", () => {
  const cases = [
    { usesGlobals: false, usesPrograms: false },
    { usesGlobals: true, usesPrograms: false },
    { usesGlobals: false, usesPrograms: true },
    { usesGlobals: true, usesPrograms: true },
  ]
  expect(cases.map(globalsArgs)).toEqual([[], ["g"], ["prg"], ["g", "prg"]])
  expect(cases.map(globalsParams)).toEqual([[], ["g: &mut Globals"], ["prg: &mut Programs"], ["g: &mut Globals", "prg: &mut Programs"]])
})
