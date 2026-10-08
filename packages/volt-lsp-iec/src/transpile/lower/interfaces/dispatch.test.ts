/**
 * Lowering tests of `dispatch.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
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

test("a call through an interface runs the instance it holds — a store later in the source reaches it next cycle", () => {
  const program = (vars: string, body: string) => `PROGRAM P\nVAR sq : FB_Sq; rc : FB_Rc; shapeRef : I_Shape; baseRef : I_Base; ${vars} END_VAR\n${body}\nEND_PROGRAM\n${INTERFACES}`
  const runner = run(
    ir(program(
      "found : BOOL; lost : BOOL; a1 : INT; later : INT; seen : INT; nulls : INT;",
      "IF baseRef = 0 THEN\n  nulls := nulls + 1;\nELSE\n  later := baseRef.Area();\nEND_IF\nshapeRef := sq;\na1 := shapeRef.Area();\nshapeRef.Size := 5;\nseen := shapeRef.Size;\nbaseRef := shapeRef;\nfound := __QUERYINTERFACE(baseRef, shapeRef);\nbaseRef := rc;\nlost := __QUERYINTERFACE(baseRef, shapeRef);",
    ), "P"),
  )
  runner.scan()
  runner.scan()
  // cycle 2 reaches rc through `baseRef := rc`, stored after the call; the failed query left `shapeRef` null
  expect(["nulls", "later", "a1", "seen", "sq.side", "found", "lost"].map((v) => runner.get(v))).toEqual([1n, 7n, 25n, 5n, 5n, true, false])
  const faulting = run(ir(program("n : INT;", "n := shapeRef.Area();"), "P"))
  expect(() => faulting.scan()).toThrow("holds no instance")
  // an instance passed to a FUNCTION's interface input: refused (`interface-input`) until recorded (`itf_function_input`);
  // now the routine is lent the instance for the call (design §24)
  const input = `${program("n : INT;", "n := F_Area(sq);")}FUNCTION F_Area : INT\nVAR_INPUT shape : I_Base; END_VAR\nF_Area := shape.Area() + 1;\nEND_FUNCTION\n`
  const lent = run(ir(input, "P"))
  lent.scan()
  expect(lent.get("n")).toEqual(10n)
})
