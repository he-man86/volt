/**
 * Lowering tests of `names.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// transpile-review-2026-09-29 task 19 (conformance `tr_19_method_inout_shadows_member`, `tr_19_method_inout_shadows_var_stat`,
// recorded): a METHOD's own VAR_IN_OUT lost to the FB's field or VAR_STAT of the same name — `x := x + 100` wrote the member,
// so res = 105 and v stayed 1. CODESYS resolves the method's declaration first: res = v = 101, the member keeps 5.
test("a METHOD's own VAR_IN_OUT shadows the FB field and the FB VAR_STAT of its name", () => {
  for (const section of ["VAR", "VAR_STAT"]) {
    const source =
      `FUNCTION_BLOCK FB_S\nVAR_OUTPUT seen : INT; END_VAR\n${section}\n\tx : INT := 5;\nEND_VAR\nseen := x;\nEND_FUNCTION_BLOCK\n\n` +
      "METHOD M : INT\nVAR_IN_OUT\n\tx : INT;\nEND_VAR\nx := x + 100;\nM := x;\nEND_METHOD\n\n" +
      "PROGRAM P\nVAR inst : FB_S; v : INT := 1; res : INT; member : INT; END_VAR\nres := inst.M(x := v);\ninst();\nmember := inst.seen;\nEND_PROGRAM\n"
    const runner = run(ir(source, "P"))
    runner.scan()
    expect([section, runner.get("res"), runner.get("v"), runner.get("member")]).toEqual([section, 101n, 101n, 5n])
  }
})
