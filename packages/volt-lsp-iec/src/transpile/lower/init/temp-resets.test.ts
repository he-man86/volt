/**
 * Lowering tests of `temp-resets.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

// transpile-review 24: a VAR_TEMP whose initializer is not a constant was queued for the run-once init step and then
// reset to its type's zero on every run — CODESYS evaluates it on EVERY call (`var_temp_dynamic_init`: 9 then 10).
test("a VAR_TEMP with a non-constant initializer re-evaluates it on every run of its body — an FB's and a PROGRAM's", () => {
  const source =
    "PROGRAM P\nVAR inst : FB_T; g : INT := 7; fb1 : INT; fb2 : INT; fbExpr : INT; own1 : INT; own2 : INT; END_VAR\n" +
    "VAR_TEMP t : INT := g; u : INT := g * 2 + 1; END_VAR\n" +
    "inst(src := g); fb1 := inst.seen; inst(src := g + 1); fb2 := inst.seen; fbExpr := inst.seenExpr;\n" +
    "IF own1 = 0 THEN own1 := u; ELSE own2 := u; END_IF\ng := g + t;\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_T\nVAR_INPUT src : INT; END_VAR\nVAR_TEMP t : INT := src; u : INT := src * 2 + 1; END_VAR\nVAR seen : INT; seenExpr : INT; END_VAR\n" +
    "seen := t;\nseenExpr := u;\nEND_FUNCTION_BLOCK\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["fb1", "fb2", "fbExpr", "own1", "g"].map((v) => runner.get(v))).toEqual([7n, 8n, 17n, 15n, 14n])
  runner.scan()
  expect(["fb1", "fb2", "own2", "g"].map((v) => runner.get(v))).toEqual([14n, 15n, 29n, 28n])
  // one reading a VAR_TEMP declared after it (or itself) reads a value no recording gives: refused
  const later = (init: string) => lowerSource(`PROGRAM P
VAR g : INT; rv : INT; END_VAR
VAR_TEMP ${init} END_VAR
rv := a;
END_PROGRAM
`, "P").diagnostics.map((d) => d.code)
  expect(later("a : INT := g + b; b : INT := 1;")).toEqual(["init-reads-later"])
  expect(later("b : INT := 1; a : INT := g + b;")).toEqual([])
})

// transpile-restructure 5.5: a METHOD's and a FUNCTION's VAR (their temporary section; CODESYS refuses VAR_TEMP there)
// re-evaluates a non-constant initializer on every call (`var_temp_dynamic_init_method`, `_function`: 9 then 10, an
// input's `k * 3` 6 then 15) — it was `init-not-constant`. And a VAR_TEMP ARRAY or STRUCT whose initializer has dynamic
// elements re-evaluates each per call, every other element at its static value (`var_temp_dynamic_aggregate_init`: [3, 6,
// 9] then [5, 10, 10]; (3, 4, 18) then (5, 4, 20)) — `IrFresh` of the static part, then one statement per dynamic element.
test("a routine's local and a VAR_TEMP aggregate re-evaluate their dynamic initializers on every call", () => {
  const source =
    "VAR_GLOBAL g : INT := 7; END_VAR\n" +
    "TYPE Rec :\nSTRUCT\n\ta : INT;\n\tb : INT := 4;\n\tc : INT;\nEND_STRUCT\nEND_TYPE\n" +
    "FUNCTION F_Twice : INT\nVAR_INPUT n : INT; END_VAR\nF_Twice := n * 2;\nEND_FUNCTION\n" +
    "FUNCTION F_Seen : INT\nVAR_INPUT k : INT; END_VAR\nVAR t : INT := g; viaInput : INT := k * 3; END_VAR\nF_Seen := t * 100 + viaInput;\ng := g + 1;\nEND_FUNCTION\n" +
    "FUNCTION_BLOCK FB_A\nVAR_INPUT k : INT; END_VAR\nVAR_TEMP arr : ARRAY[0..2] OF INT := [k, 0 + F_Twice(k), g]; rc : Rec := (a := k, c := F_Twice(g)); END_VAR\n" +
    "VAR r0 : INT; r1 : INT; r2 : INT; sa : INT; sb : INT; sc : INT; END_VAR\n" +
    "r0 := arr[0]; r1 := arr[1]; r2 := arr[2]; sa := rc.a; sb := rc.b; sc := rc.c;\narr[1] := 0; rc.b := 0;\nEND_FUNCTION_BLOCK\n" +
    "PROGRAM P\nVAR inst : FB_A; s1 : INT; s2 : INT; END_VAR\ns1 := F_Seen(k := 2);\ns2 := F_Seen(k := 5);\ninst(k := 3);\nEND_PROGRAM\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  expect(["s1", "s2"].map((v) => runner.get(v))).toEqual([706n, 815n])
  expect(["inst.r0", "inst.r1", "inst.r2", "inst.sa", "inst.sb", "inst.sc"].map((v) => runner.get(v))).toEqual([3n, 6n, 9n, 3n, 4n, 18n])
  runner.scan()
  expect(["inst.r1", "inst.r2", "inst.sb", "inst.sc"].map((v) => runner.get(v))).toEqual([6n, 11n, 4n, 22n])
  // a local's initializer reading itself or a later local reads a value no recording gives: refused
  const local = (vars: string) =>
    lowerSource(`VAR_GLOBAL gq : INT; END_VAR\nFUNCTION F : INT\nVAR ${vars} END_VAR\nF := a;\nEND_FUNCTION\nPROGRAM P\nVAR x : INT; END_VAR\nx := F();\nEND_PROGRAM\n`, "P").diagnostics.map((d) => d.code)
  expect(local("a : INT := gq + b; b : INT := 1;")).toEqual(["init-reads-later"])
  expect(local("b : INT := 1; a : INT := gq + b;")).toEqual([])
})
