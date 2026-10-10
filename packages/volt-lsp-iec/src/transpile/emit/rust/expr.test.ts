import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { head } from "./expr.js"
import { Prec, printed } from "./precedence.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

describe("emit/rust", () => {
/**
 * TWO SHAPES THE SWEEP THAT MADE THE EMITTED RUST READABLE GOT WRONG, neither of which any conformance fixture
 * reaches — which is why the 5,400-assertion gate stayed green over one of them not compiling at all.
 */
test("an array index keeps its parentheses, because `as` binds tighter than the arithmetic in it", () => {
  // `arr[li / 2]` printed `self.arr[self.li / 2i64 as usize]`, which Rust reads as `self.li / (2i64 as usize)`:
  // E0277, `cannot divide i64 by usize`. Stripping the printer's parentheses is only safe where nothing binds
  // tighter than the expression, and a cast does.
  const code = rust("PROGRAM P\nVAR arr : ARRAY[0..9] OF INT; li : LINT; END_VAR\narr[li / 2] := 1;\nEND_PROGRAM\n")
  expect(code).toContain("self.arr[(self.li / 2i64) as usize] = 1i16;")
})

test("a loop test over REALs is negated, not flipped — NaN makes every ordering false", () => {
  // Flipping `<=` to `>` is negation only over a total order. With a NaN operand both are false, so
  // `WHILE r <= 10.0` exits at once in the interpreter (`!false`) and never exits in the emitted Rust.
  const real = rust("PROGRAM P\nVAR rx : REAL; n : INT; END_VAR\nWHILE rx <= 10.0 DO\n n := n + 1;\n rx := rx + 1.0;\nEND_WHILE\nEND_PROGRAM\n")
  // (since 7.5.4 a head test is the `while` condition itself — nothing negated at all)
  expect(real).toContain("while self.rx <= 10.0f32 {")

  // an integer comparison is a total order, so it still flips — that is what removed 39 `nonminimal_bool`
  const int = rust("PROGRAM P\nVAR i : INT; END_VAR\nWHILE i <= 10 DO\n i := i + 1;\nEND_WHILE\nEND_PROGRAM\n")
  expect(int).toContain("while self.i <= 10i16 {")
})

  test("an enum variable is its base type and an enum value its number; THIS^ is `self`", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Enums\nVAR mode : E_Mode; small : E_Small; inst : FB_This; END_VAR\nmode := E_Mode.Busy;\nsmall := Hi;\ninst.Bump();\nEND_PROGRAM\nTYPE E_Mode : (Idle, Busy := 4); END_TYPE\nTYPE E_Small : (Lo, Hi) BYTE; END_TYPE\nFUNCTION_BLOCK FB_This\nVAR n : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Bump\nTHIS^.n := THIS^.n + 1;\nEND_METHOD\n",
      "Enums",
    )
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub mode: i16,")
    expect(code).toContain("pub small: u8,")
    expect(code).toContain("self.mode = 4i16;")
    expect(code).toContain("self.small = 1u8;")
    expect(code).toContain("self.n = ") // THIS^.n, through `self`
  })

  test("BOOL AND/OR whose right operand calls print Rust's eager `&`/`|`; a quiet one and AND_THEN/OR_ELSE short-circuit", () => {
    // Why missed (transpiler review 2026-09-15): the golden and crate sources used AND_THEN, or AND on operands without
    // a call, where `&&` and `&` give one answer — the interpreter's both-sides evaluation was never compared. A right
    // operand that calls keeps the eager node; one nothing can observe skipping short-circuits (lowering decides, 7.5.6)
    const { pou, diagnostics } = lowerSource("FUNCTION F : BOOL\nF := TRUE;\nEND_FUNCTION\nPROGRAM Eager\nVAR a : BOOL; b : BOOL; c : BOOL; d : BOOL; e : BOOL; END_VAR\nc := a AND F();\nd := a OR_ELSE b;\ne := a AND b;\nEND_PROGRAM\n", "Eager")
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("self.c = self.a & f();")
    expect(code).toContain("self.d = self.a || self.b;")
    expect(code).toContain("self.e = self.a && self.b;")
  })

  test("MOD guards a zero divisor — 0, as measured, where Rust's % panics — and keeps `%`'s MIN MOD -1 panic (6.A.3); NOT of an INT is a u16", () => {
    const { pou, diagnostics } = lowerSource("PROGRAM M\nVAR a : INT := 7; z : INT; m : INT; w : DINT; END_VAR\nm := a MOD z;\nw := NOT a;\nEND_PROGRAM\n", "M")
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    // the operands promoted to DINT first (MOD is a lifted operator), then the guard; the result narrowed back to INT
    // the bindings carry the reserved prefix — they used to be `a` and `d`, which shadowed a parameter of
    // those names and made `7 MOD 3` compile to `7 % 7`; see the hygiene describe below
    expect(code).toContain(
      "self.m = { let __mod_l = i32::from(self.a); let __mod_r = i32::from(self.z); if __mod_r == 0 { 0 } else { __mod_l % __mod_r } } as i16;",
    )
    expect(code).toContain("self.w = i32::from(!(self.a as u16));")
  })

  test("integer negation wraps — Rust's `-` panics on a minimum — while REAL negation stays plain", () => {
    const code = rust("PROGRAM P\nVAR d : DINT; e : DINT; x : REAL; y : REAL; END_VAR\ne := -d; y := -x;\nEND_PROGRAM\n")
    expect(code).toContain("self.d.wrapping_neg()")
    expect(code).toContain("self.y = -self.x;")
  })
})

test("MOD and a REAL `/` by a constant lowering proved harmless print plain `%` and `/`; by a variable or -1 they keep their check (7.2.6)", () => {
  const code = rust(
    "PROGRAM P\nVAR i : DINT := 7; z : DINT := 3; a : DINT; b : DINT; c : DINT; x : REAL := 1.5; y : REAL; w : REAL; END_VAR\na := i MOD 4;\nb := i MOD z;\nc := i MOD -1;\ny := x / 2.0;\nw := x / x;\nEND_PROGRAM\n",
  )
  expect(code).toContain("self.a = self.i % 4i32;")
  expect(code).toContain("self.b = { let __mod_l = self.i; let __mod_r = self.z;")
  expect(code).toContain("self.c = { let __mod_l = self.i; let __mod_r = -1i32;")
  expect(code).toContain("self.y = self.x / 2.0f32;")
  expect(code).toContain("self.w = iec_div(self.x, self.x);")
})

// the narrow rule's fallout (7.3.1, 7.3.3): a range test over one operand prints `contains`, a store back into its own
// left operand `op=`, and an `if` whose condition starts with a block RECEIVER needs no parentheses
describe("emit/rust — the forms the narrow rule exposed", () => {
  test("x >= lo AND x <= hi is a range's contains; w := w AND m is `&=`; a block receiver heads an if bare", () => {
    const code = rust("PROGRAM P\nVAR c : BYTE; w : WORD; g : BOOL; END_VAR\ng := c >= 97 AND c <= 122;\ng := c >= 97 AND_THEN c < 123;\nw := w AND 16#FF;\nEND_PROGRAM\n")
    expect(code).toContain("self.g = (97u8..=122u8).contains(&self.c);")
    expect(code).toContain("self.g = (97u8..123u8).contains(&self.c);")
    expect(code).toContain("self.w &= 255u16;")
    expect(head(printed("{ s }.char_at(1) < 3u8", Prec.Compare))).toBe("{ s }.char_at(1) < 3u8")
    expect(head(printed("{ s }", Prec.Postfix))).toBe("({ s })")
    expect(head(printed("if g { 1 } else { 2 }", Prec.Block))).toBe("(if g { 1 } else { 2 })")
  })
})
