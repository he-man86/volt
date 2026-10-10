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

// transpile-restructure 4.0: the 8 bytes per IMPLEMENTS are measured for interfaces that EXTEND nothing
// (`mem_fb_implements_one`/`_two`). Whether an interface that EXTENDS another adds one pointer or one per interface in its
// chain is not measured (0 interfaces that EXTEND another in the six corpora — the one grep hit is a comment), so SIZEOF of such an FB is refused, not guessed.
test("SIZEOF of an FB implementing an interface that EXTENDS another is refused as unmeasured", () => {
  const { pou, diagnostics } = lowerSource(
    "INTERFACE I_A\nEND_INTERFACE\nINTERFACE I_B EXTENDS I_A\nEND_INTERFACE\nFUNCTION_BLOCK FB_K IMPLEMENTS I_B\nVAR kept : DINT; END_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inst : FB_K; n : ULINT; END_VAR\nn := SIZEOF(inst);\nEND_PROGRAM\n",
    "P",
  )
  expect(pou).toBeUndefined()
  expect(diagnostics.map((d) => d.code)).toEqual(["sizeof-unmeasured"])
})

// transpile-restructure 4a (gate review): an IMPLEMENTS name that resolves to no interface declaration has no chain to
// measure — whether it EXTENDS anything is unknown — so its 8 bytes are not assumed either; before 4.0 it was answered
// 8 bytes like a measured one.
test("SIZEOF of an FB implementing a name that is no interface declaration is refused as unmeasured", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION_BLOCK FB_K IMPLEMENTS I_Missing\nVAR kept : DINT; END_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inst : FB_K; n : ULINT; END_VAR\nn := SIZEOF(inst);\nEND_PROGRAM\n",
    "P",
  )
  expect(pou).toBeUndefined()
  expect(diagnostics.map((d) => d.code)).toEqual(["sizeof-unmeasured"])
})

// 6Af gate review (recorded `tr_a31_sizeof_bound_fb_var_input_constant`, both vendors, `tr_a31_sizeof_fb_var_input_constant`
// run, 2026-10-10: 24): a VAR_INPUT CONSTANT is a per-call parameter, not a constant the compiler replaces — it takes its
// room in the instance. `replacedConstants` skipped it with the replaced VAR CONSTANTs (16).
test("SIZEOF of an FB lays out its VAR_INPUT CONSTANT", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION_BLOCK G\nVAR_INPUT CONSTANT i : LINT; END_VAR\nVAR d : DINT; END_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR g : G; n : ULINT; END_VAR\nn := SIZEOF(g);\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect(runner.get("n")).toBe(24n)
})

// 6Af gate review (recorded `tr_a29_sizeof_bound_widened_*_constant`, both vendors, `tr_a29_widened_constant_reads` run,
// 2026-10-10): a CONSTANT held past its type (`D : DINT := K + 1` 2^31, `B : BYTE := KB + 1` 256) is still of its DECLARED
// type — SIZEOF(D) 4, SIZEOF(B) 1. SIZEOF measured the wider slot that holds it (8, 2).
test("SIZEOF of a CONSTANT held in a wider slot is its declared type's", () => {
  const { pou, diagnostics } = lowerSource(
    "PROGRAM P\nVAR s1 : ULINT; s2 : ULINT; END_VAR\nVAR CONSTANT K : DINT := 2147483647; D : DINT := K + 1; KB : BYTE := 255; B : BYTE := KB + 1; END_VAR\ns1 := SIZEOF(D); s2 := SIZEOF(B);\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const runner = run(pou!)
  runner.scan()
  expect([runner.get("s1"), runner.get("s2")]).toEqual([4n, 1n])
})
