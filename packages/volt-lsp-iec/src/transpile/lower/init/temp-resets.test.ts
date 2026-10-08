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
