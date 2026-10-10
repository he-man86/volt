import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"
import { lowerAndEmit } from "../../pipeline/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

const COUNTER = `
PROGRAM Counter
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR
  iCount   : INT;
  MaxCount : INT := 3;
END_VAR
IF Enable AND iCount < MaxCount THEN
  iCount := iCount + 1;
END_IF
END_PROGRAM
`

describe("emit/rust", () => {
  test("globals are a `Globals` struct handed as `g` to the bodies that reach it; called PROGRAMs live apart in `Programs`", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Main\nVAR reader : FB_Reader; seen : INT; END_VAR\nPRG_Writer();\nseen := gShared;\nreader();\nEND_PROGRAM\nVAR_GLOBAL\n  gShared : INT := 3;\nEND_VAR\nFUNCTION_BLOCK FB_Reader\nVAR_OUTPUT q : INT; END_VAR\nq := gShared;\nEND_FUNCTION_BLOCK\nPROGRAM PRG_Writer\nVAR runs : INT; END_VAR\nruns := runs + 1;\ngShared := runs;\nEND_PROGRAM\n",
      "Main",
    )
    expect(diagnostics).toEqual([])
    const emitted = emitRust(pou!)
    expect([emitted.usesGlobals, emitted.usesPrograms]).toEqual([true, true])
    expect(emitted.code).toContain("pub struct Globals {")
    expect(emitted.code).toContain("g_shared: 3,")
    expect(emitted.code).toContain("pub struct Programs {")
    expect(emitted.code).toContain("pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {")
    // A body is handed `g` and `prg` where it reaches them — its own places, or a body it calls, to any depth: any body may
    // call a PROGRAM (conformance `state_program_called_from_fb`), and one that does is handed `prg` (7.7.5; every body
    // was handed both). A program runs moved out of `Programs` and back, so the call never borrows `prg` twice;
    // PRG_Writer reaches the GVL only, so its call takes `g` alone.
    expect(emitted.code).toContain("{ let mut program = std::mem::take(&mut prg.prg_writer); program.call(g); prg.prg_writer = program; }")
    expect(emitted.code).toContain("pub fn call(&mut self, g: &mut Globals) {\n        self.runs")
    expect(emitted.code).toContain("self.seen = g.g_shared;")
    expect(emitted.code).toContain("pub fn call(&mut self, g: &mut Globals) {\n        self.q = g.g_shared;") // FB_Reader: `g` alone
  })

  test("a POU emits as one flat struct with a scan method — no references anywhere", () => {
    const code = rust(COUNTER)
    expect(code).toContain("pub struct Counter {")
    expect(code).toContain("pub i_count: i16,")
    expect(code).toContain("pub fn scan(&mut self) {")
    expect(code).toContain("max_count: 3,") // the declared initial value, not Default's zero
    // The whole point of the flat-frame decision: `&mut self` is the ONLY borrow in the output.
    expect(code.match(/&mut/g)).toEqual(["&mut"])
    expect(code).not.toContain("&'")
  })

  test("IEC integers wrap at their width rather than panicking like Rust's defaults", () => {
    expect(rust(COUNTER)).toContain("wrapping_add")
  })

  test("every emitted statement line maps back to an ST span", () => {
    const { code, sourceMap } = lowerAndEmit(COUNTER).emitted
    expect(sourceMap.length).toBeGreaterThan(0)
    const lines = code.split("\n")
    for (const { line, span } of sourceMap) {
      expect(lines[line - 1]).toBeDefined()
      expect(span.startLine).toBeGreaterThan(0)
    }
    // the assignment inside the IF maps to the ST line that holds it
    const assignment = sourceMap.find(({ line }) => lines[line - 1]?.includes("i_count = "))
    expect(assignment?.span.startLine).toBe(11)
  })
})

// 6Aa+6Ae gate review of 6.A.17: two lists' same-named globals were made two Rust fields by turning the global field names'
// collision refusal off for every global, so two DIFFERENT ST names snaking to one field were silently suffixed `_2`, and
// which list kept the plain name followed which body reached it first. The two slots of one name are told apart by their
// LIST (`IrSlot.list`), whatever order they are reached in; any other collision still refuses.
describe("emit/rust — two lists' globals", () => {
  const lists = [
    { uri: "file:///GVL_One.gvl", source: "VAR_GLOBAL\n\tg : INT := 3;\nEND_VAR\n" },
    { uri: "file:///GVL_Two.gvl", source: "VAR_GLOBAL\n\tg : INT := 5;\nEND_VAR\n" },
  ]
  const fields = (body: string): string[] => {
    const { pou, diagnostics } = lowerSource(`PROGRAM P\nVAR a : INT; b : INT; END_VAR\n${body}\nEND_PROGRAM\n`, "P", lists)
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    const globals = code.slice(code.indexOf("pub struct Globals {"), code.indexOf("}", code.indexOf("pub struct Globals {")))
    return [...globals.matchAll(/pub (\w+):/g)].map((m) => m[1]!).sort()
  }

  test("one name in two lists is two fields, named by their lists whatever order they are reached in", () => {
    const one = fields("a := GVL_One.g;\nb := GVL_Two.g;")
    expect(one).toEqual(["gvl_one_g", "gvl_two_g"])
    expect(fields("b := GVL_Two.g;\na := GVL_One.g;")).toEqual(one)
  })

  test("two different ST names snaking to one field still refuse", () => {
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR a : INT; b : INT; END_VAR\na := GVL_A.myVal;\nb := GVL_B.my_val;\nEND_PROGRAM\n", "P", [
      { uri: "file:///GVL_A.gvl", source: "VAR_GLOBAL\n\tmyVal : INT;\nEND_VAR\n" },
      { uri: "file:///GVL_B.gvl", source: "VAR_GLOBAL\n\tmy_val : INT;\nEND_VAR\n" },
    ])
    expect(diagnostics).toEqual([])
    expect(() => emitRust(pou!)).toThrow(/both become the Rust field `my_val`/)
  })
})

// 7.4.5: a FUNCTION lowered once per caller's argument type prints one fn where its variants print alike — here an ANY input
// over ARRAY[0..3] and ARRAY[1..4] OF INT (`tr_42_any_array_variant_key`: same size, so the same body); the variant of
// another size keeps its own
test("FUNCTION variants that print alike are one fn", () => {
  const code = rust(
    "FUNCTION F : DINT\nVAR_INPUT v : ANY; END_VAR\nF := v.diSize;\nEND_FUNCTION\nPROGRAM P\nVAR a : ARRAY[0..3] OF INT; b : ARRAY[1..4] OF INT; c : ARRAY[0..5] OF INT; x : DINT; y : DINT; z : DINT; END_VAR\nx := F(a);\ny := F(b);\nz := F(c);\nEND_PROGRAM\n",
  )
  const fns = [...code.matchAll(/pub fn (f_\w+)/g)].map((m) => m[1])
  expect(fns).toHaveLength(2)
  expect(code).toContain(`self.x = ${fns[0]}(`)
  expect(code).toContain(`self.y = ${fns[0]}(`)
  expect(code).toContain(`self.z = ${fns[1]}(`)
})

// 7.7.4: `new` is `#[must_use]`, and a `const fn` where every initial value can be built at compile time — numbers, BOOLs,
// arrays of them, a nested FB whose own `new` is one — not where a STRING's `lit` / `new` builds a buffer
test("`new` is #[must_use], and const where every initial value can be", () => {
  const { pou } = lowerSource("FUNCTION_BLOCK FB_N\nVAR n : INT := 3; a : ARRAY[0..2] OF INT := [1, 2, 3]; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB_S\nVAR t : STRING(4) := 'ab'; END_VAR\nEND_FUNCTION_BLOCK\nPROGRAM P\nVAR inner : FB_N; flag : BOOL := TRUE; sf : FB_S; END_VAR\ninner();\nsf();\nEND_PROGRAM\n", "P")
  const code = emitRust(pou!).code
  expect(code).toContain("impl FB_N {\n    #[must_use]\n    pub const fn new() -> Self {")
  expect(code).toContain("impl FB_S {\n    #[must_use]\n    pub fn new() -> Self {")
  expect(code).toContain("impl P {\n    #[must_use]\n    pub fn new() -> Self {") // it holds an FB_S
})
