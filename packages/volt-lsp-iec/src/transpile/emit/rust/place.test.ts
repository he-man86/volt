import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"



describe("emit/rust", () => {
  // MODEL 3 (design.md §3.3 step 4d): a data pointer holds a BYTE ADDRESS into the program's image, where the variables
  // whose address it stores live — it was "a usize index of its one target" (form 1's tag) until the decision of 4.2
  test("a data pointer is a usize address into the image; every access through it checks for null first", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Ptrs\nVAR iValue : INT := 7; pInt : POINTER TO INT; iCopy : INT; arr : ARRAY[0..2] OF INT; pa : POINTER TO INT; END_VAR\npInt := ADR(iValue);\niCopy := pInt^;\npa := ADR(arr[1]);\npa[1] := 5;\nEND_PROGRAM\n",
      "Ptrs",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub p_int: usize,")
    expect(code).toContain("self.p_int = 0x1_0000_0000;") // iValue is the image's first variable, at its start
    expect(code).toContain("self.i_copy = { iec_deref(self.p_int); i16::from_le_bytes(__mem.ld(self.p_int)) };")
    expect(code).toContain("iec_ix(") // the element index is checked against its bounds, then scaled to bytes
    expect(code).toContain("iec_deref(self.pa);") // a write through a pointer is checked on the line before
    expect(code).toContain('fn iec_deref(at: usize) { assert!(at != 0, "dereference of a null pointer"); }')
  })

  test("a string cursor steps in its own usize — by a literal, or by an INT — and every character is null-checked", () => {
    // Why missed: `P := P + 1` printed `p.wrapping_add(1i8)`, the literal's own SINT, which rustc refuses beside a
    // usize; no Rust test stepped a cursor by a literal until lib_prim_string_cursor_offset did.
    const lib = { uri: "Library Manager/Lib/CSTEP.pou", source: "FUNCTION CSTEP : BYTE\nVAR_INPUT\n\tP : POINTER TO BYTE;\n\tK : INT;\nEND_VAR\nP := P + 1;\nP := P - K;\nCSTEP := P^;\nEND_FUNCTION\n" }
    const { pou, diagnostics } = lowerSource("PROGRAM Steps\nVAR sx : STRING := 'abc'; c : BYTE; END_VAR\nc := CSTEP(ADR(sx), 1);\nEND_PROGRAM\n", "Steps", [lib])
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("p = p.wrapping_add(1);")
    expect(code).toContain("p = p.wrapping_sub(k as usize);")
    expect(code).toContain("iec_deref(p);")
  })
})

test("a constant index prints as the element's position, a usize literal (7.2.3)", () => {
  const { pou } = lowerSource("PROGRAM P\nVAR a : ARRAY[3..7] OF INT; i : INT := 4; END_VAR\na[5] := 1;\na[i] := 2;\nEND_PROGRAM\n")
  const code = emitRust(pou!).code
  expect(code).toContain("self.a[2] = 1i16;")
  expect(code).toContain("self.a[((self.i as i64) - 3i64) as usize] = 2i16;")
})

test("an ARRAY[*] index minus its lower bound prints as a fixed array's does, a plain `-` (7.2.3)", () => {
  const { pou, diagnostics } = lowerSource(
    "FUNCTION F : INT\nVAR_IN_OUT a : ARRAY[*] OF INT; END_VAR\nVAR_INPUT i : INT; END_VAR\nF := a[i];\nEND_FUNCTION\nPROGRAM P\nVAR arr : ARRAY[2..4] OF INT; res : INT; txt : STRING := 'abc'; c : BYTE; END_VAR\nres := F(arr, 3);\nc := txt[1];\nEND_PROGRAM\n",
  )
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toMatch(/a\[\(\(i as i64\) - \(\w+ as i64\)\) as usize\]/)
  expect(code).not.toContain("wrapping_sub(")
  expect(code).toContain(".char_at(1)") // a constant character position prints bare
})

test("a constant index outside its array keeps its run-time check — a bare one rustc refuses to build", () => {
  const { pou } = lowerSource("PROGRAM P\nVAR a : ARRAY[0..3] OF INT; END_VAR\na[30000] := 1;\nEND_PROGRAM\n")
  expect(emitRust(pou!).code).not.toContain("self.a[30000]")
})
