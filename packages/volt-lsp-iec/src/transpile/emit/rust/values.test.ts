import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

describe("emit/rust", () => {
  test("a slot without an initial value starts at its type's zero — and a WSTRING's is a WSTRING", () => {
    // `new` printed its own defaults, and gave every string `IecStr::new()`: a STRING for a WSTRING field
    const code = rust("PROGRAM P\nVAR\n  flag : BOOL;\n  wide : WSTRING;\n  ratio : REAL;\nEND_VAR\nflag := TRUE;\nEND_PROGRAM\n")
    expect(code).not.toContain("IecStr::new()")
    expect(code).toMatch(/wide: IecWString::<\d+>::new\(\)/) // an empty one builds no slice (7.4.7)
  })
})

/**
 * A NEGATIVE CONSTANT AS THE RECEIVER OF A METHOD — the `-1.abs()` trap, and it was reachable.
 *
 * In Rust a method call binds TIGHTER than unary minus, and the emitter makes a constant the receiver of a
 * method in a dozen places (`wrapping_*`, `max`/`min`, `limit`, `abs`, the shifts and rotates, `round`,
 * `clone`, the string helpers). A bare `-1i32` let the sign escape every one of them:
 *
 *   MAX(E_Sign.Neg, x)  with Neg := -1 and x := 5  ->  `-1i32.max((self.x as i32))`
 *
 * which Rust reads as `-(1.max(5))` = -5 where the interpreter and CODESYS answer 5. A silent wrong answer from
 * an ordinary negative enum value, and no recorded case caught it.
 *
 * Fixed in `literal` rather than at the dozen receivers, because that is the version a thirteenth receiver
 * cannot defeat. The type MINIMUMS still compile parenthesized — `(-128i8)` keeps Rust's own special case for
 * `-128i8`, checked against rustc for i8/i16/i32/i64.
 */
describe("emit/rust — a negative constant keeps its sign inside a method call", () => {
  test("the sign cannot escape the receiver position", () => {
    const code = rust("TYPE E_Sign : (Neg := -1, Zero := 0); END_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tx : INT := 5;\n\ty : INT;\n\tz : INT;\n\tmn : SINT := -128;\nEND_VAR\ny := MAX(E_Sign.Neg, x);\nz := ABS(-1);\nEND_PROGRAM\n")
    expect(code).toContain("(-1i16).max(")
    // and nowhere does a bare negative constant sit directly before a `.`
    expect(code).not.toMatch(/[^(\w]-\d+[iuf]\d+\./)
  })

  test("a type minimum is still emitted as Rust accepts it", () => {
    expect(rust("TYPE E_Sign : (Neg := -1, Zero := 0); END_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tx : INT := 5;\n\ty : INT;\n\tz : INT;\n\tmn : SINT := -128;\nEND_VAR\ny := MAX(E_Sign.Neg, x);\nz := ABS(-1);\nEND_PROGRAM\n")).toContain("mn: -128,")
  })
})

/**
 * A VAR_TEMP RESET HONOURS ITS DECLARED INITIALIZER (transpile-review task 30). A composite VAR_TEMP is reset on
 * every call through a `fresh` expression; that printed the free, init-blind `initOf`, so `arr := [5, 6, 7]` and
 * `s := (a := 9)` came back as the type's zeros where CODESYS resets them to the declared values
 * (`decl_temp_array_init_resets`, `decl_temp_struct_init_resets`).
 */
describe("emit/rust — a VAR_TEMP reset", () => {
  test("an initialized array or struct in VAR_TEMP is reset to its initializer, not to zero", () => {
    const code = rust(
      "TYPE ST_P :\nSTRUCT\n\ta : INT;\n\tb : INT := 4;\nEND_STRUCT\nEND_TYPE\n\nFUNCTION_BLOCK FB\nVAR_TEMP\n\tarr : ARRAY[0..2] OF INT := [5, 6, 7];\n\tsx : ST_P := (a := 9);\nEND_VAR\nVAR\n\tout : INT;\nEND_VAR\nout := arr[1] + sx.a;\nEND_FUNCTION_BLOCK\n",
    )
    // the reset at the top of `call`, not the declaration in `new()`
    const call = code.slice(code.indexOf("pub fn call("))
    expect(call).toContain("self.arr = [5i16, 6i16, 7i16];")
    expect(call).toContain("self.sx = ST_P { a: 9, ..ST_P::new() };") // struct-update syntax (7.8.3)
  })
})

/**
 * A LONG LITERAL GROUPS ITS DIGITS (7.2.11) — an integer part or a fraction of six digits or more, by three, as clippy's
 * `unreadable_literal` asks (`1_709_078_400u32`); five or fewer stay as they are. A REAL prints from its rounded f32
 * value (7.2.12): the fewest digits naming that f32, never the f64 decimal of the value before rounding.
 */
describe("emit/rust — a literal's digits", () => {
  test("six or more digits group by three, in the integer part and the fraction; five stay bare", () => {
    const code = rust(
      "PROGRAM P\nVAR\n  d : UDINT;\n  u : ULINT;\n  t : INT;\n  big : LREAL;\n  small : LREAL;\nEND_VAR\nd := 1709078400;\nu := 1000000000;\nt := 12345;\nbig := 1234567.125;\nsmall := 0.000001;\nEND_PROGRAM\n",
    )
    expect(code).toContain("self.d = 1_709_078_400u32;")
    expect(code).toContain("self.u = 1_000_000_000u64;")
    expect(code).toContain("self.t = 12345i16;")
    expect(code).toContain("self.big = 1_234_567.125f64;")
    expect(code).toContain("self.small = 0.000_001f64;")
  })

  test("a REAL literal prints the shortest decimal of its f32, a field's initializer too", () => {
    const code = rust("PROGRAM P\nVAR\n  a : REAL := REAL#0.1;\n  b : REAL;\nEND_VAR\nb := 3.14159;\nEND_PROGRAM\n")
    expect(code).toContain("a: 0.1,")
    expect(code).toContain("self.b = 3.14159f32;")
  })
})

// 7.4.7 / 7.4.8: an empty string literal is the empty string `new()` builds; a WSTRING literal's units need no `u16` each —
// `lit`'s `&[T]` is the WSTRING's `&[u16]`
test("an empty literal prints `new()`; a WSTRING literal's units print bare", () => {
  const code = rust("PROGRAM P\nVAR e : STRING(8) := ''; w : WSTRING(10) := \"he\"; a : ARRAY[1..3] OF STRING(4); END_VAR\nw := \"he\";\nEND_PROGRAM\n")
  expect(code).toContain("e: IecString::<8>::new(),")
  expect(code).toContain("a: [IecString::<4>::new(); 3],")
  expect(code).toContain("w: IecWString::<10>::lit(&[104, 101]),")
  expect(code).not.toContain("104u16")
})

// 7.4.9: a string compared with a literal compares against the literal's units — `IecStr`'s `==` and `<` ARE the comparison
// of the two `units()` slices — never a whole string built to compare with; the units stop at the literal's first 0
test("a string compared with a literal reads the literal's units", () => {
  const code = rust(
    "PROGRAM P\nVAR t : STRING(10) := 'abc'; w : WSTRING(5); b1 : BOOL; b2 : BOOL; b3 : BOOL; b4 : BOOL; b5 : BOOL; END_VAR\nb1 := t = 'abc';\nb2 := 'b' < t;\nb3 := t <> '';\nb4 := w = \"hi\";\nb5 := t >= 'ab$00cd';\nEND_PROGRAM\n",
  )
  expect(code).toContain(`self.b1 = self.t.units() == b"abc";`)
  expect(code).toContain(`self.b2 = &b"b"[..] < self.t.units();`)
  expect(code).toContain(`self.b3 = !self.t.units().is_empty();`)
  expect(code).toContain(`self.b4 = self.w.units() == [104u16, 105u16];`)
  expect(code).toContain(`self.b5 = self.t.units() >= &b"ab"[..];`)
  expect(code).not.toMatch(/[=<>] IecW?String::/)
})

// 7.8.2 / 7.8.3: an array of a Copy element is a repeat expression, nested arrays and Copy structs included, and
// `from_fn` is left to an element that is not Copy (an FB instance); an aggregate initializer is struct-update syntax;
// a partial array initializer of a Copy element is the repeat plus a store per stated element, where that is shorter
test("Copy arrays repeat, a struct initializer is struct-update syntax, a short partial initializer stores into a repeat", () => {
  const { pou, diagnostics } = lowerSource(
    "TYPE ST_P : STRUCT a : INT; b : INT; END_STRUCT END_TYPE\nTYPE ST_Q : STRUCT p : ST_P; c : INT; END_STRUCT END_TYPE\n" +
      "FUNCTION_BLOCK FB_K\nVAR n : INT; END_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n" +
      "PROGRAM P\nVAR grid : ARRAY[1..2, 0..2] OF INT; pts : ARRAY[0..2] OF ST_P; fbs : ARRAY[0..1] OF FB_K; q : ST_Q := (p := (a := 1), c := 2);\n" +
      "few : ARRAY[1..30] OF INT := [4, 5]; most : ARRAY[1..3] OF INT := [7, 8]; END_VAR\nq.c := grid[1, 0] + pts[0].a + fbs[0].n + few[1] + most[1];\nEND_PROGRAM\n",
    "P",
  )
  expect(diagnostics).toEqual([])
  const code = emitRust(pou!).code
  expect(code).toContain("grid: [[0; 3]; 2],")
  expect(code).toContain("pts: [ST_P::new(); 3],")
  expect(code).toContain("fbs: std::array::from_fn(|_| FB_K::new()),")
  // every field of ST_Q named: no `..ST_Q::new()` to update from (clippy's `needless_update`)
  expect(code).toContain("q: ST_Q { p: ST_P { a: 1, ..ST_P::new() }, c: 2 },")
  expect(code).toContain("few: { let mut a = [0; 30]; a[0] = 4; a[1] = 5; a },")
  expect(code).toContain("most: [7, 8, 0],")
})
