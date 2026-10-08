/**
 * Lowering tests of `namespace.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

// transpile-review 21: a FUNCTION routine was keyed and scoped by its bare name, and a bare call took the first symbol
// bound, so a project FUNCTION named like a library element and the library's own, called both ways, ran whichever was
// lowered first for both. CODESYS: a qualified call names the library element, a bare one in project code the project's
// (`tr_21_namespace_qualified_first`, `tr_21_namespace_bare_first`).
test("a namespace-qualified FUNCTION and a project FUNCTION of the same name are two routines, whichever runs first", () => {
  const LIB = "C:/p/Device/Plc Logic/Application/Library Manager/LibScale"
  const libraries = [
    { uri: `${LIB}/LibScale.library`, source: "LIBRARY LibScale\nNAMESPACE LSC\nRESOLUTION LibScale, 1.0.0.0 (Acme)\n" },
    { uri: `${LIB}/F_Scale.pou`, source: "FUNCTION F_Scale : INT\nVAR_INPUT x : INT; END_VAR\nF_Scale := x * 10 + 1000;\nEND_FUNCTION\n" },
  ]
  const fn = "FUNCTION F_Scale : INT\nVAR_INPUT x : INT; END_VAR\nF_Scale := x + 1;\nEND_FUNCTION\n"
  for (const body of ["a := LSC.F_Scale(2);\nb := F_Scale(2);", "b := F_Scale(2);\na := LSC.F_Scale(2);"]) {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR a : INT; b : INT; END_VAR\n${body}\nEND_PROGRAM\n${fn}`, "P", libraries, "C:/p/Device/Plc Logic/Application/P.pou")
    expect(diagnostics).toEqual([])
    const runner = run(pou!)
    runner.scan()
    expect([runner.get("a"), runner.get("b")]).toEqual([1020n, 3n])
  }
})
