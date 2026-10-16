/**
 * Lowering tests of `statics.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"
import { ir } from "../../../../test/support/transpile.js"

// Review 2026-09-15 (declarations), recorded first (conformance `life_*`). An FB body's VAR_STAT was a field of each
// instance where CODESYS shares one; a PROGRAM's VAR_TEMP kept its value across scans, and an FB's was refused, where both
// start over at their initial value on every run. Why missed: no running fixture declared VAR_STAT in an FB body, and
// VAR_TEMP was only ever recorded in a METHOD.
test("an FB's VAR_STAT is shared by every instance; a VAR_TEMP starts over on every run of its body", () => {
  const source =
    "PROGRAM P\nVAR first : FB_Derived; second : FB_Derived; runs : INT; END_VAR\nVAR_TEMP scratch : INT := 2; END_VAR\n" +
    "scratch := scratch + 1;\nruns := scratch;\nfirst();\nsecond();\nfirst.Peek();\nEND_PROGRAM\n" +
    "FUNCTION_BLOCK FB_Base\nVAR_STAT counter : INT; END_VAR\nVAR_TEMP baseTemp : INT := 10; END_VAR\nVAR seenBase : INT; END_VAR\nbaseTemp := baseTemp + 1;\nseenBase := baseTemp;\nEND_FUNCTION_BLOCK\n" +
    "FUNCTION_BLOCK FB_Derived EXTENDS FB_Base\nVAR_TEMP own : INT; END_VAR\nVAR seen : INT; peeked : INT; END_VAR\nown := own + 1;\ncounter := counter + own;\nseen := counter;\nSUPER^();\nEND_FUNCTION_BLOCK\n" +
    "METHOD Peek\npeeked := counter;\nEND_METHOD\n"
  const runner = run(ir(source, "P"))
  runner.scan()
  runner.scan()
  // two instances, two scans: the one counter reaches 4, read through either instance, the base body and a method alike
  // (`first.Peek()` runs after `second()`, so it sees the 4)
  expect(["first.counter", "second.counter", "first.seen", "second.seen", "first.peeked"].map((v) => runner.get(v))).toEqual([4n, 4n, 3n, 4n, 4n])
  // every temp at its initial value plus the one increment of its run — the root's, the derived body's, the base's
  expect(["runs", "first.seenBase", "second.seenBase"].map((v) => runner.get(v))).toEqual([3n, 11n, 11n])
  // A COMPOSITE VAR_TEMP RESETS TOO, and is no longer refused. `decl_temp_array_counts` counts 1 after three scans
  // where `decl_var_array_counts` counts 3 — the same split the scalars show — so the behaviour was never in doubt,
  // only the IR to express it, which `IrFresh` now does.
  // A fresh local of every run now (7.6.4), which no path after the scan names (no recording reads a VAR_TEMP): the run
  // copies it out.
  const tempArray = lowerSource("PROGRAM P\nVAR out : INT; END_VAR\nVAR_TEMP pair : ARRAY[0..1] OF INT; END_VAR\npair[0] := pair[0] + 1;\nout := pair[0];\nEND_PROGRAM\n", "P")
  expect(tempArray.diagnostics.map((d) => d.code)).toEqual([])
  const fresh = run(tempArray.pou!)
  for (let i = 0; i < 3; i++) fresh.scan()
  expect(fresh.get("out")).toBe(1n)
})
