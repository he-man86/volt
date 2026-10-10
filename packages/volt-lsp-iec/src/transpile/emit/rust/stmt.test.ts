import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

describe("emit/rust", () => {
  test("CASE prints as a match with inclusive ranges", () => {
    const code = rust("PROGRAM P\nVAR m : INT; n : INT; END_VAR\nCASE m OF\n 1: n := 0;\n 2..4: n := 1;\nELSE\n n := 9;\nEND_CASE\nEND_PROGRAM\n")
    expect(code).toContain("1 => {")
    expect(code).toContain("2..=4 => {")
    expect(code).toContain("_ => {")
  })

  // model 2 (design §3.2): a string store reads both capacities — `IecStr::store` writes min(n, m) source units and keeps
  // the destination's units behind them (`string_assign_tail_wide`); at one capacity that is the whole copy, printed as `=`
  test("a STRING into a STRING of another capacity is a store into the place's buffer; at one capacity a plain copy", () => {
    const code = rust("PROGRAM P\nVAR s10 : STRING(10); s20 : STRING(20); t20 : STRING(20); END_VAR\ns20 := s10;\nt20 := s20;\ns20 := 'ab';\nEND_PROGRAM\n")
    expect(code).toContain("self.s20.store(&self.s10);")
    expect(code).toContain("self.t20 = self.s20;")
    // a literal keeps its own unit count (string_literal_nul_tail): it is a source of 2, not of 20
    expect(code).toContain(`self.s20.store(&IecString::<2>::lit(b"ab"));`)
  })

  test("a STRING VAR_IN_OUT, whose capacity is a generic, is stored into — and stored from — at any capacity", () => {
    const code = rust("FUNCTION F : BOOL\nVAR_IN_OUT dest : STRING(20); source : STRING(10); END_VAR\ndest := source;\nF := TRUE;\nEND_FUNCTION\n\nPROGRAM P\nVAR a : STRING(20); b : STRING(10); ok : BOOL; END_VAR\nok := F(dest := a, source := b);\nEND_PROGRAM\n")
    expect(code).toContain("(*dest).store(&*source);")
  })
})

test("one guard per statement: a read through the pointer the statement's line checked prints unchecked — unless a call may move it (lean 9.3)", () => {
  const code = rust(
    "FUNCTION F : INT\nVAR_INPUT x : INT; END_VAR\nF := x;\nEND_FUNCTION\nPROGRAM P\nVAR v : INT := 1; p : POINTER TO INT; END_VAR\np := ADR(v);\np^ := p^ + 1;\np^ := F(p^);\nEND_PROGRAM\n",
  )
  const body = code.slice(code.indexOf("pub fn scan"), code.indexOf("impl Default for P"))
  expect(body.match(/iec_deref\(self\.p\)/g)).toHaveLength(3)
  expect(body).toContain("iec_deref(self.p);\n        { let __v = (i16::from_le_bytes(__mem.ld(self.p)) as i32)")
  expect(body).toContain("f(__mem, { iec_deref(self.p); i16::from_le_bytes(__mem.ld(self.p)) })")
})
