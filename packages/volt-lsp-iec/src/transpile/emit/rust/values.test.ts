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
    expect(code).toMatch(/wide: IecWString\S*::lit\(/)
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
    expect(code).toContain("(-1i32).max(")
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
    expect(call).toContain("self.sx = { let mut v = ST_P::new(); v.a = 9; v };")
  })
})
