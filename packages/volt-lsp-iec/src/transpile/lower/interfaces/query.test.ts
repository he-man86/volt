/**
 * Lowering tests of `query.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

// Interfaces (conformance `itf_*`): an interface variable had no representation (`slot-interface`), so nothing called
// through one lowered. It holds the tag of its instance, and each call dispatches once every store has lowered.
const INTERFACES =
  "INTERFACE I_Base\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\n" +
  "INTERFACE I_Shape EXTENDS I_Base\nPROPERTY Size : INT\nGET\nEND_GET\nSET\nEND_SET\nEND_PROPERTY\nEND_INTERFACE\n" +
  "FUNCTION_BLOCK FB_Sq IMPLEMENTS I_Shape\nVAR side : INT := 3; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := side * side;\nEND_METHOD\nPROPERTY Size : INT\nGET\nSize := side;\nEND_GET\nSET\nside := Size;\nEND_SET\nEND_PROPERTY\n" +
  "FUNCTION_BLOCK FB_Rc IMPLEMENTS I_Base\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 7;\nEND_METHOD\n"

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// transpile-review-2026-09-29 task 18 (`tr_18_queryinterface_into_global`): `__QUERYINTERFACE(srcItf, gItf)` from an
// FB's own child into a GLOBAL is the same cross-instance write as `gItf := src` — CODESYS: r1 = r2 = 1 (x1's child).
// The query's edge was hard-coded not-foreign, so the call through the global ran on the CALLING instance's child (r2 = 2).
test("__QUERYINTERFACE into a global is a foreign write, refused like the plain store", () => {
  const source =
    "PROGRAM P\nVAR x1 : FB_Q; x2 : FB_Q; END_VAR\nx1(q := TRUE, tag := 1);\nx2(q := FALSE, tag := 2);\nEND_PROGRAM\n" +
    "VAR_GLOBAL\n  gItf : I_G;\nEND_VAR\n" +
    "INTERFACE I_G EXTENDS __SYSTEM.IQueryInterface\nMETHOD Get : INT\nEND_METHOD\nEND_INTERFACE\n" +
    "FUNCTION_BLOCK FB_I IMPLEMENTS I_G\nVAR_INPUT tag : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Get : INT\nGet := tag;\nEND_METHOD\n" +
    "FUNCTION_BLOCK FB_Q\nVAR_INPUT q : BOOL; tag : INT; END_VAR\nVAR src : FB_I; srcItf : I_G; found : BOOL; res : INT; END_VAR\n" +
    "src(tag := tag);\nsrcItf := src;\nIF q THEN\n  found := __QUERYINTERFACE(srcItf, gItf);\nEND_IF\nres := gItf.Get();\nEND_FUNCTION_BLOCK\n"
  expect(lowerSource(source, "P").diagnostics.map((d) => d.code)).toContain("interface-instance-relative")
})

// pro2193 queries an interface as an IF's condition (`IF __QUERYINTERFACE(transferProducts, prepareTransfer) THEN`, ~30
// uses); only `found := __QUERYINTERFACE(from, into)` lowered (`expr-call`). It is that recorded query into a hidden BOOL
// taken just before the test — an ELSIF's only when reached. Why missed: the recorded case used the assignment form only.
test("__QUERYINTERFACE as an IF's or ELSIF's whole condition, or under NOT, is the recorded query taken just before the test", () => {
  const program = (vars: string, body: string) => `PROGRAM P\nVAR sq : FB_Sq; rc : FB_Rc; shapeRef : I_Shape; baseRef : I_Base; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${INTERFACES}`
  const runner = run(
    ir(
      program(
        "hits : INT; misses : INT; area : INT; elsifArea : INT;",
        "baseRef := sq;\nIF __QUERYINTERFACE(baseRef, shapeRef) THEN\n  area := shapeRef.Area();\n  hits := hits + 1;\nEND_IF\n" +
          "baseRef := rc;\nIF NOT __QUERYINTERFACE(baseRef, shapeRef) THEN\n  misses := misses + 1;\nEND_IF\n" +
          "IF hits = 0 THEN\n  misses := 100;\nELSIF (__QUERYINTERFACE(baseRef, shapeRef)) THEN\n  elsifArea := 1;\nELSE\n  elsifArea := 2;\nEND_IF",
      ),
      "P",
    ),
  )
  runner.scan()
  expect(["hits", "misses", "area", "elsifArea"].map((v) => runner.get(v))).toEqual([1n, 1n, 9n, 2n])
  // the LEADING operand of OR_ELSE / AND_THEN always runs first: pro2193's `IF NOT __QUERYINTERFACE(xuUnit, xuUnitExtended)
  // OR_ELSE NOT xuUnitExtended.InSafePosForMouldEntry THEN` — the right operand reads what the query stored
  const leading = run(
    ir(program("led : INT;", "baseRef := sq;\nIF NOT __QUERYINTERFACE(baseRef, shapeRef) OR_ELSE shapeRef.Area() <> 9 THEN\n  led := 1;\nELSE\n  led := 2;\nEND_IF"), "P"),
  )
  leading.scan()
  expect(leading.get("led")).toEqual(2n)
  // as a right operand a short-circuit may skip, the query is not taken before the test
  expect(lowerSource(program("done : BOOL;", "IF done OR_ELSE __QUERYINTERFACE(baseRef, shapeRef) THEN\n  done := TRUE;\nEND_IF"), "P").diagnostics.map((d) => d.code)).toEqual(["interface-query"])
})
