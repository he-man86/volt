/**
 * Folded constants: what lowering decides before the program runs.
 */
import { test, expect } from "bun:test"
import { lowerSource } from "../index.js"

const fb = (init: string) =>
  `FUNCTION_BLOCK FB\nVAR\n  d : LINT := ${init};\nEND_VAR\nd := d + 0;\nEND_FUNCTION_BLOCK\n` +
  "PROGRAM PLC_PRG\nVAR inst : FB; res : LINT; END_VAR\ninst();\nres := inst.d;\nEND_PROGRAM\n"
const codes = (src: string) => lowerSource(src, "PLC_PRG").diagnostics.map((d) => d.code)

test("a platform-alias conversion is refused in an initializer exactly as in a body (6.B.5 lowers both)", () => {
  // Lowering's builtins refuse `DINT_TO___XINT` as `expr-call` (the platform names are H4's, task 6.B.5). The
  // constant folder must not answer for it on its own: a fold here lowered the initializer while the same call in
  // a body stayed refused — the two paths disagreed, and the new answer had no recording behind it.
  const body = codes("PROGRAM PLC_PRG\nVAR x : LINT; END_VAR\nx := DINT_TO___XINT(5);\nEND_PROGRAM\n")
  expect(body).toContain("expr-call")
  expect(codes(fb("DINT_TO___XINT(5)"))).toContain("expr-call")
})

test("an initializer holding a platform-alias conversion is not folded statically", () => {
  // `5 + __XINT_TO_DINT(5)` is not a compile-time constant to lowering until 6.B.5 decides the platform names:
  // folding it gave `d` the static init 10 where HEAD's runtime init path refused or deferred it.
  const r = lowerSource(fb("5 + __XINT_TO_DINT(5)"), "PLC_PRG")
  const d = r.pou!.layouts.find((l) => l.name === "FB")!.fields.find((f) => f.name === "d")!
  expect(d.init).not.toBe(10n)
})
