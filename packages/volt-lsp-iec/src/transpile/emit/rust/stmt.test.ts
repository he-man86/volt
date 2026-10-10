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
  expect(body).toContain("iec_deref(self.p);\n        { let __v = i16::from_le_bytes(__mem.ld(self.p)).wrapping_add(1i16)")
  expect(body).toContain("f({ iec_deref(self.p); i16::from_le_bytes(__mem.ld(self.p)) })") // F reaches no image byte: no `__mem` (7.7.5)
})

// 7.5.5: ELSIF prints `else if`, not an `else` holding one more `if` (clippy's `collapsible_else_if`)
test("ELSIF is `else if`, its own ELSE last", () => {
  const { pou } = lowerSource("PROGRAM P\nVAR n : INT; k : INT; END_VAR\nIF n = 1 THEN\n  k := 1;\nELSIF n = 2 THEN\n  k := 2;\nELSIF n = 3 THEN\n  k := 3;\nELSE\n  k := 4;\nEND_IF\nEND_PROGRAM\n")
  const code = emitRust(pou!).code
  expect(code).toContain("} else if self.n == 2i16 {")
  expect(code).toContain("} else if self.n == 3i16 {")
  expect(code).toContain("} else {\n            self.k = 4i16;")
  expect(code).not.toMatch(/else \{\s*if/)
})

// Gate review 7.2c+7.5b: Rust's `a op= b` on a primitive evaluates `b` FIRST and reads `a` after it, so a right operand
// holding a call that writes the target (a METHOD of the same FB) must keep `x = x op rhs` — IEC reads `x` first
test("a store back into its own left operand prints `op=` only when the right operand holds no call", () => {
  const src = (op: string, type: string) =>
    `FUNCTION_BLOCK FB\nVAR x : ${type} := 10; y : ${type} := 3; END_VAR\nx := x ${op} Bump();\ny := y ${op} 1;\nEND_FUNCTION_BLOCK\n\nMETHOD Bump : ${type}\nx := x + 100;\nBump := 1;\nEND_METHOD\n`
  const div = rust(src("/", "DINT"))
  expect(div).toContain("self.x = self.x / self.bump(")
  expect(div).not.toMatch(/self\.x \/= /)
  expect(div).toMatch(/self\.y \/= 1i32;/)
  const or = rust(src("OR", "DWORD"))
  expect(or).toContain("self.x = self.x | self.bump(")
  expect(or).toMatch(/self\.y \|= 1u32;/)
})

// 7.5.12 (clippy's `collapsible_if`): an IF with no ELSE whose whole body is one more IF with none is one `if a && b` —
// `&&` tests the inner condition only where the outer held, as the nesting did; an OR operand keeps its parentheses, and
// an ELSE on either, or a statement beside the inner IF, keeps the nesting
test("an IF whose whole body is one more IF, neither with an ELSE, prints as one `if a && b`", () => {
  const code = rust(
    "PROGRAM P\nVAR a : BOOL; b : BOOL; c : BOOL; n : INT; END_VAR\nIF a THEN\n  IF b OR c THEN\n    IF n > 2 THEN\n      n := 1;\n    END_IF\n  END_IF\nEND_IF\nIF a THEN\n  IF b THEN\n    n := 2;\n  ELSE\n    n := 3;\n  END_IF\nEND_IF\nIF c THEN\n  n := 4;\n  IF b THEN\n    n := 5;\n  END_IF\nEND_IF\nEND_PROGRAM\n",
  )
  expect(code).toContain("if self.a && (self.b || self.c) && self.n > 2i16 {\n            self.n = 1i16;\n        }")
  expect(code).toContain("if self.a {\n            if self.b {\n                self.n = 2i16;\n            } else {")
  expect(code).toContain("if self.c {\n            self.n = 4i16;\n            if self.b {")
})

// 7.4.2: a literal or a number's text stored into a NARROWER buffer is built at the target's capacity — storing m <= n units
// writes every unit of the destination, so the value is the same and the n-buffer and the store go; into a wider buffer the
// store stays, the destination keeping its units behind the ones written (`string_assign_tail_wide`, `string_literal_nul_tail`)
test("a literal or a number's text into a narrower STRING is built at the target's capacity; into a wider one it is stored", () => {
  const code = rust("PROGRAM P\nVAR s3 : STRING(3); s20 : STRING(20); s5 : STRING(5); i : INT := -1234; END_VAR\ns3 := 'abcdef';\ns20 := 'ab';\ns5 := INT_TO_STRING(i);\nEND_PROGRAM\n")
  expect(code).toContain(`self.s3 = IecString::<3>::lit(b"abcdef");`)
  expect(code).toContain(`self.s20.store(&IecString::<2>::lit(b"ab"));`)
  expect(code).toContain(`self.s5 = IecString::<5>::lit(format!("{}", self.i).as_bytes());`)
})

// 7.4.3: `s[i] := c` writes one unit in place — `s.set_char(i, c)` — where `s = s.with_char(i, c)` took the string by value
// and moved it back; a position or unit holding a call keeps `with_char` (a call there could write the string in between)
test("`s[i] := c` is an in-place `set_char`, unless its position or unit holds a call", () => {
  const code = rust("FUNCTION F : INT\nF := 1;\nEND_FUNCTION\nPROGRAM P\nVAR txt : STRING(10); i : INT := 2; b : BYTE := 65; END_VAR\ntxt[i] := b;\ntxt[3] := txt[i];\ntxt[F()] := b;\nEND_PROGRAM\n")
  expect(code).toContain("self.txt.set_char(i64::from(self.i), self.b);")
  expect(code).toContain("self.txt.set_char(3, self.txt.char_at(i64::from(self.i)));")
  expect(code).toContain("self.txt = self.txt.with_char(i64::from(f()), self.b);")
})

// review of 7.4.3: the IR reads the target's place AND stores into it, so an index holding a call runs twice there (the
// interpreter: `setchar(load arr[F()], …)` into `arr[F()]`); `with_char` keeps that order — the value, then the place —
// where an in-place `set_char` would run it once, and the backends would disagree
test("`arr[F()][i] := c` — a call in the target's own index — keeps `with_char`", () => {
  const code = rust("FUNCTION F : INT\nF := 1;\nEND_FUNCTION\nPROGRAM P\nVAR arr : ARRAY[0..3] OF STRING(5); END_VAR\narr[F()][1] := 65;\nEND_PROGRAM\n")
  expect(code).not.toContain(".set_char(1, 65u8)")
  expect(code).toContain(".with_char(1, 65u8)")
})

// 7.6.1: a statement's temp — a chain's value here — is a `let` of the fn that runs the statement, bound where it is
// written, not a field of the FB's struct (`IrSlot.scoped`)
test("a chain's value is a local of the body, not a field", () => {
  const code = rust("FUNCTION_BLOCK FB\nVAR a : INT; b : INT; c : INT; END_VAR\na := b := c;\nEND_FUNCTION_BLOCK\n")
  expect(code).toContain("let __chain_value_3: i16 = self.c;\n        self.b = __chain_value_3;\n        self.a = __chain_value_3;")
  expect(code).not.toContain("pub __chain_value")
  expect(code).not.toContain("self.__chain_value")
})

// 7.6.1: a chain of `:=` links over a constant needs no temp at all — each target takes the constant at its own type
test("a chain over a constant stores it into each target, no temp", () => {
  const code = rust("PROGRAM P\nVAR a : INT; b : DINT; END_VAR\na := b := 5;\nEND_PROGRAM\n")
  expect(code).toContain("self.b = 5i32;\n        self.a = 5i16;")
  expect(code).not.toContain("__chain_value")
})

// review of 7.6.1: a constant's conversion only retypes it, so a link that narrows a STRING, rounds to REAL or turns a
// REAL into an INT keeps the temp the chain over a variable has — the outer target receives the inner link's value
test("a chain over a constant whose link narrows it keeps the temp", () => {
  for (const [vars, body] of [
    ["s10 : STRING(10); s3 : STRING(3);", "s10 := s3 := 'abcdef';"],
    ["lr : LREAL; rr : REAL;", "lr := rr := 0.1;"],
    ["lr2 : LREAL; ii : INT;", "lr2 := ii := 2.6;"],
  ])
    expect(rust(`PROGRAM P
VAR ${vars} END_VAR
${body}
END_PROGRAM
`)).toContain("__chain_value")
})
