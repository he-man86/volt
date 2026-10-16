/**
 * Lowering tests of `borrowed.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

// `p := ADR(io.y)` in an FB with `io` a VAR_IN_OUT (conformance `mem_adr_of_inout_member`) was refused outright: the pointer
// is a field and outlives the call. It is exact where the body stored it on this run; anywhere else is refused.
test("a pointer into a VAR_IN_OUT dereferences in the run that stored it; before the store, or conditionally, it is refused", () => {
  const fb = (body: string) =>
    `PROGRAM P\nVAR rec : T_IO; inst : FB_IO; END_VAR\ninst(io := rec);\nEND_PROGRAM\nTYPE T_IO : STRUCT x : INT; y : INT; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_IO\nVAR_IN_OUT io : T_IO; END_VAR\nVAR p : POINTER TO INT; flag : BOOL; END_VAR\n${body}\nEND_FUNCTION_BLOCK\n`
  const runner = run(ir(fb("p := ADR(io.y);\np^ := 99;"), "P"))
  runner.scan()
  expect([runner.get("rec.x"), runner.get("rec.y")]).toEqual([0n, 99n])
  expect(lowerSource(fb("IF flag THEN p := ADR(io.y); END_IF\np^ := 99;"), "P").diagnostics.map((d) => d.code)).toEqual(["pointer-outlives"])
})

/**
 * THE TWO REFUSALS pointer-model.md D4 and D5 asked for, both of which were a MESSAGE problem rather than a
 * missing capability — each was reported under a code that named the wrong thing, which is how a work list gets
 * pointed at work that does not exist.
 */
