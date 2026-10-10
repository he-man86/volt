import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

describe("emit/rust", () => {
  test("LIMIT prints as max-then-min, never `clamp` — Rust's clamp panics when MN > MX, CODESYS answers it", () => {
    const code = rust("PROGRAM P\nVAR x : INT; y : INT; g : BOOL; END_VAR\ny := LIMIT(100, x, 0); y := MAX(x, 1, 2); y := SEL(g, 1, 2);\nEND_PROGRAM\n")
    expect(code).not.toContain("clamp")
    expect(code).toContain(".max(")
    expect(code).toContain(".min(")
    // SEL runs ONLY the input it selects — CODESYS leaves the unselected call's counter untouched
    // (conformance `tr_41_sel_side_effects`, recorded; transpile-review-2026-09-29 task 41)
    // …its literal arms typed at the result type (7.2.7), not met at LINT and cast back
    expect(code).toContain("self.y = if self.g { 2i16 } else { 1i16 };")
  })

  // transpile-review-2026-09-29 task 28 (conformance `tr_28_minmax_limit_nan_signed_zero_*`, recorded as bits): a REAL
  // MAX is `if a > b { a } else { b }` — the second argument on a tie or NaN — where f32::max drops the NaN and picks
  // either zero; LIMIT is MIN(MAX(MN, IN), MX) over the same two.
  test("REAL MAX / MIN / LIMIT print as compare-select, never f32::max / f32::min", () => {
    const code = rust("PROGRAM P\nVAR a : REAL; b : REAL; y : REAL; END_VAR\ny := MAX(a, b); y := MIN(a, b); y := LIMIT(0.0, a, b);\nEND_PROGRAM\n")
    expect(code).toContain("self.y = iec_fmax(self.a, self.b);")
    expect(code).toContain("self.y = iec_fmin(self.a, self.b);")
    expect(code).toContain("iec_fmin(iec_fmax(")
    expect(code).toContain("fn iec_fmax<T: PartialOrd>(a: T, b: T) -> T { if a > b { a } else { b } }")
    expect(code).toContain("fn iec_fmin<T: PartialOrd>(a: T, b: T) -> T { if a < b { a } else { b } }")
  })

  test("LIMIT evaluates MN before IN; MUX runs only the selected input (transpile-review-2026-09-29 task 41)", () => {
    const code = rust(
      "FUNCTION Add1 : INT\nVAR_IN_OUT x : INT; END_VAR\nx := x + 1;\nAdd1 := x;\nEND_FUNCTION\n" +
        "PROGRAM P\nVAR x : INT := 1; y : INT; k : INT; END_VAR\ny := LIMIT(Add1(x), x, 1000); y := MUX(k, Add1(x), x);\nEND_PROGRAM\n",
    )
    // `tr_41_limit_evaluation_order`, recorded: MN is bound before IN is read
    expect(code).toContain("(add1(&mut self.x) as i32).max(self.x as i32)")
    expect(code).toContain("match ")
  })

  test("math computes through f64 and narrows; ABS wraps a signed minimum and is the identity on unsigned", () => {
    const code = rust(
      "PROGRAM P\nVAR x : REAL; y : REAL; i : INT; j : DINT; u : ULINT; v : ULINT; END_VAR\ny := LN(x); j := ABS(i); y := ABS(x); v := ABS(u);\nEND_PROGRAM\n",
    )
    // LN GOES THROUGH `iec_log` — `LN(0)` and `LOG(0)` stop the task on CODESYS and Rust answers `-inf` and carries
    // on (`operators/math-domain.ts`, which asked every math function's domain edges). The `as f64` / `as f32` trip
    // this test is really about is unchanged.
    expect(code).toContain("iec_log(self.x as f64).ln() as f32")
    expect(code).toContain('assert!(x != 0.0, "the logarithm of zero stops the task on CODESYS")')
    expect(code).toContain("(self.i as i32).wrapping_abs()") // promoted to DINT; `abs` would panic on the minimum
    expect(code).toContain("self.x.abs()")
    expect(code).toContain("self.v = self.u;") // u64 has no `abs`
  })

  test("EXPT is `powf` through f64, narrowed to REAL only when both arguments are REAL", () => {
    const code = rust("PROGRAM P\nVAR x : REAL; y : REAL; n : INT; z : LREAL; END_VAR\ny := EXPT(x, y); z := EXPT(x, n);\nEND_PROGRAM\n")
    expect(code).toContain("iec_pow(self.x as f64, self.y as f64) as f32")
    expect(code).toContain("self.z = iec_pow(self.x as f64, self.n as f64);") // one INT: LREAL
    // through `iec_pow`: EXPT(0, -1) stops the task on CODESYS where `powf` answers inf (`tr_46_exptdom_zero_pow_*`)
    expect(code).toContain('assert!(!stops, "zero to a negative power stops the task on CODESYS"); x.powf(y)')
  })

  test("bit operations print Rust's own wrapping_shl/rotate_left, MUX a match, and bit access one slot's mask", () => {
    const code = rust(
      "PROGRAM P\nVAR b : BYTE; n : INT; w : WORD; x : BOOL; i : INT; k : INT; END_VAR\nw := SHL(b, n); b := ROL(b, n); x := w.3; i.15 := x; i := MUX(k, 1, 2, 3);\nEND_PROGRAM\n",
    )
    expect(code).toContain("(self.b as i32).wrapping_shl(self.n as u32)") // promoted, then Rust's own mask
    expect(code).toContain("self.b.rotate_left(self.n as u32)") // the BYTE's own width
    expect(code).toContain("self.x = ((self.w >> 3) & 1) != 0;")
    // the place named once (review 2026-09-15: printed on both sides, a call in its index ran twice)
    expect(code).toContain(
      "{ let __bit_v = self.x; let __bit_w = &mut self.i; *__bit_w = if __bit_v { *__bit_w | (1i16 << 15) } else { *__bit_w & !(1i16 << 15) }; }",
    )
    expect(code).toContain("_ => ") // out-of-range K picks the last input
  })
})

test("a constant shift or rotate count prints bare, and a shift by 0 is its operand (7.2.5)", () => {
  const code = rust(
    "PROGRAM P\nVAR w : WORD := 16#1234; a : WORD; b : WORD; c : WORD; n : INT := 2; d : WORD; END_VAR\na := SHL(w, 3);\nb := ROL(w, 4);\nc := SHR(w, 0);\nd := SHL(w, n);\nEND_PROGRAM\n",
  )
  expect(code).toContain("self.a = (self.w as i32).wrapping_shl(3) as u16;")
  expect(code).toContain("self.b = self.w.rotate_left(4);")
  expect(code).toContain("self.c = (self.w as i32) as u16;") // the promotion is lean 3's (7.3)
  expect(code).toContain("self.d = (self.w as i32).wrapping_shl(self.n as u32) as u16;")
})
