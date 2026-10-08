/**
 * Lowering tests of `sizeof.ts`'s concern — split by topic out of the one lowering test file (transpile-restructure 1.8.1).
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { lowerSource } from "../index.js"

// transpile-review 26: SIZEOF of an FB laid out every VAR CONSTANT and never read IMPLEMENTS. CODESYS (`mem_fb_var_constant_*`,
// `mem_fb_implements_*`): a replaced scalar constant takes no room (16), a `const_non_replaced` one (24) and a STRUCT one (32)
// do, and each implemented interface adds 8 (24, 32). A constant whose replacement is not measured is refused.
test("SIZEOF of an FB skips a replaced scalar VAR CONSTANT and adds a pointer per implemented interface", () => {
  const sized = (decls: string, implementsList = "") => {
    const itfs = implementsList === "" ? "" : implementsList.split(",").map((i) => `INTERFACE ${i.trim()}\nEND_INTERFACE\n`).join("")
    const { pou, diagnostics } = lowerSource(
      `${itfs}TYPE T_K : STRUCT wide : LINT; narrow : DINT; END_STRUCT END_TYPE\nFUNCTION_BLOCK FB_K${implementsList === "" ? "" : ` IMPLEMENTS ${implementsList}`}\nVAR kept : DINT; END_VAR\n${decls}\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inst : FB_K; n : ULINT; END_VAR\nn := SIZEOF(inst);\nEND_PROGRAM\n`,
      "P",
    )
    if (pou === undefined) return diagnostics.map((d) => d.code)
    const runner = run(pou)
    runner.scan()
    return runner.get("n")
  }
  expect(sized("")).toBe(16n)
  expect(sized("VAR CONSTANT c : LINT := 5; END_VAR")).toBe(16n)
  expect(sized("VAR CONSTANT\n{attribute 'const_non_replaced'}\nc : LINT := 5;\nEND_VAR")).toBe(24n)
  expect(sized("VAR CONSTANT c : T_K := (wide := 5, narrow := 6); END_VAR")).toBe(32n)
  expect(sized("", "I_A")).toBe(24n)
  expect(sized("", "I_A, I_B")).toBe(32n)
  expect(sized("VAR CONSTANT sv : STRING := 'abc'; END_VAR")).toEqual(["sizeof-unmeasured"])
})
