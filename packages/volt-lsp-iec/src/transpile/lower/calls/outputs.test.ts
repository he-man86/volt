/**
 * Lowering tests of `outputs.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// transpile-review 43: an FB output bound `name => target` converts like an assignment, not by family. CODESYS runs
// WORD 16#FFFF => INT as -1, WORD => UDINT as 65535 and INT -3 => REAL as -3.0, and refuses DINT => INT ("Cannot convert
// type 'DINT' to type 'INT'") (`tr_43_output_*`). The lowering refused the first three and truncated the last.
test("an FB output binding converts by the assignment relation", () => {
  const fb = (out: string, value: string) => `FUNCTION_BLOCK FB_O\nVAR_OUTPUT o : ${out}; END_VAR\no := ${value};\nEND_FUNCTION_BLOCK\n`
  const src = (into: string, out: string, value: string) => `PROGRAM P\nVAR fb1 : FB_O; t : ${into}; END_VAR\nfb1(o => t);\nEND_PROGRAM\n${fb(out, value)}`
  const value = (into: string, out: string, v: string) => {
    const runner = run(ir(src(into, out, v), "P"))
    runner.scan()
    return runner.get("t")
  }
  expect(value("INT", "WORD", "16#FFFF")).toBe(-1n)
  expect(value("UDINT", "WORD", "16#FFFF")).toBe(65535n)
  expect(value("REAL", "INT", "-3")).toBe(-3)
  expect(lowerSource(src("INT", "DINT", "100000"), "P").diagnostics.map((d) => d.code)).toEqual(["call-output-type"])
})

// transpile-review 20: a routine's `o => target` was lent `&mut` before the call, so an index the callee moves was read
// too early. CODESYS copies the output out AFTER the call (`tr_20_output_index_moved_by_callee`): arr[1] = 5 through a
// METHOD moving its FB's own k, arr2[1] = 5 through a FUNCTION moving a global.
test("a routine's output is copied out after the call, at the index the callee moved", () => {
  const src = [
    "PROGRAM P",
    "VAR fb1 : FB_O; arr : ARRAY[0..3] OF INT; arr2 : ARRAY[0..3] OF INT; b : BOOL; c : BOOL; END_VAR",
    "b := fb1.M(o => arr[fb1.k]);",
    "c := F_O(o => arr2[gK]);",
    "END_PROGRAM",
    "VAR_GLOBAL gK : INT; END_VAR",
    "FUNCTION F_O : BOOL\nVAR_OUTPUT o : INT; END_VAR\ngK := gK + 1;\no := 5;\nF_O := TRUE;\nEND_FUNCTION",
    "FUNCTION_BLOCK FB_O\nVAR_OUTPUT k : INT; END_VAR\nEND_FUNCTION_BLOCK",
    "METHOD M : BOOL\nVAR_OUTPUT o : INT; END_VAR\nk := k + 1;\no := 5;\nM := TRUE;\nEND_METHOD",
  ].join("\n")
  const runner = run(ir(src, "P"))
  runner.scan()
  expect(["arr[0]", "arr[1]", "arr2[0]", "arr2[1]"].map((v) => runner.get(v))).toEqual([0n, 5n, 0n, 5n])
})
