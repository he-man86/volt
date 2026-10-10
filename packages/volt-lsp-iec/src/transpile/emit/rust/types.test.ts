import { describe, expect, test } from "bun:test"
import { emitRust, rustType } from "./index.js"
import { lowerSource } from "../../lower/index.js"



describe("emit/rust", () => {
  test("the IEC type mapping comes from the type's own facts", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR a : SINT; b : INT; c : DINT; d : BYTE; e : WORD; f : REAL; g : LREAL; h : BOOL; END_VAR\na := a;\nEND_PROGRAM\n")
    expect(pou!.slots.map((s) => rustType(s.type))).toEqual(["i8", "i16", "i32", "u8", "u16", "f32", "f64", "bool"])
  })

  test("TIME is a u32 of milliseconds and LTIME a u64 of nanoseconds — not the i64 every duration used to be", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR t : TIME := T#1S500MS; lt1 : LTIME := LTIME#1NS; END_VAR\nt := t;\nEND_PROGRAM\n")
    expect(pou!.slots.map((s) => rustType(s.type))).toEqual(["u32", "u64"])
    expect(pou!.slots.map((s) => s.init)).toEqual([1500n, 1n]) // folded, in each type's unit
  })
})

// transpile-restructure 6.A.6 (Appendix A): an open ARRAY in-out's dimensions and a STRING in-out's capacity are both const
// generics of the routine. They were `N_<NAME>_<d>` and `N_<NAME>`, so `grid : ARRAY[*, *]` (its second dimension
// `N_GRID_2`) beside `grid_2 : STRING` (`N_GRID_2`) declared one generic twice — E0403, on ST CODESYS compiles.
test("an open array in-out's dimension generics never meet a STRING in-out's capacity generic", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION F_Gen : INT\nVAR_IN_OUT grid : ARRAY[*, *] OF INT; grid_2 : STRING; END_VAR\ngrid_2 := 'x';\nF_Gen := grid[0, 0];\nEND_FUNCTION\n" +
      "PROGRAM Gen\nVAR cells : ARRAY[0..1, 0..2] OF INT; label : STRING(12) := 'abc'; n : INT; END_VAR\nn := F_Gen(cells, label);\nEND_PROGRAM\n",
    "Gen",
  )
  expect(diagnostics).toEqual([])
  const signature = emitRust(pou!).code.split("\n").find((line) => line.includes("pub fn f_gen"))!
  const generics = [...signature.matchAll(/const (\w+): usize/g)].map((m) => m[1])
  expect(generics).toHaveLength(2)
  expect(new Set(generics).size).toBe(2)
})
