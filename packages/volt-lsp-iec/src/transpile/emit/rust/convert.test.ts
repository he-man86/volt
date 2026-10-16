import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"
import { rust } from "../../../../test/support/transpile.js"

describe("emit/rust", () => {
  test("conversions print CODESYS's rules, not a bare `as` — which truncates, saturates, and has no bool", () => {
    const code = rust(
      "PROGRAM P\nVAR x : REAL; i : INT; b : BOOL; n : INT; y : REAL; d : DINT; END_VAR\ni := REAL_TO_INT(x); b := INT_TO_BOOL(n); y := BOOL_TO_REAL(b); d := TRUNC(x); i := DINT_TO_SINT(300);\nEND_PROGRAM\n",
    )
    // REAL -> INTEGER goes through the DESTINATION'S register width, not always a 64-bit one. That was the shape
    // this pinned — `let __c = x.round()` and a single i64 arm — and it could not produce `LREAL_TO_DINT(-1.0E30)`
    // = -2147483648, which is the 32-BIT indefinite. `conversions/real-to-integer{,-ladder}.ts` measured 192 cells
    // and `iec_r2i32` / `iec_r2i64` are the table; an INT destination takes the 32-bit half.
    expect(code).toContain("self.i = iec_r2i32(f64::from(self.x)) as i16;")
    expect(code).toContain("if c < -2_147_483_648.0 { return i32::MIN; }")
    expect(code).toContain("if c.is_nan() || c >= 9_223_372_036_854_775_808.0 { return 0; }")
    expect(code).toContain("self.b = self.n != 0;")
    expect(code).toContain("self.y = f32::from(u8::from(self.b));")
    // TRUNC out of DINT range is i32::MIN (measured), so it is range-checked, not pushed through a wrapping i64 — in
    // one runtime helper since lean 9.2, not inline at every TRUNC
    expect(code).toContain("self.d = iec_trunc_i32(f64::from(self.x));")
    expect(code).toContain("if (-2_147_483_648.0..=2_147_483_647.0).contains(&t) { t as i32 } else { i32::MIN }")
    expect(code).not.toContain("300i8") // an explicit conversion is a node, never an out-of-range literal
  })
})

/**
 * A BIT CONVERTS AS THE BOOL IT IS (transpile-review task 31). `rustType` maps a BIT to `bool`, but `convert` read
 * the family ("bitstring"), so `TO_STRING(bit)` printed Rust's `true` and `BIT_TO_REAL` / `TO_LREAL` / `INT_TO_BIT`
 * cast to or from `bool` (E0606/E0054). CODESYS reads a BIT as a BOOL: 'TRUE', 1.0, and `INT_TO_BIT(2)` = TRUE
 * (`tr_31_bit_conversions`).
 */
describe("emit/rust — a BIT converts as a BOOL", () => {
  test("TO_STRING, BIT_TO_REAL, TO_LREAL and INT_TO_BIT on BIT fields", () => {
    const code = rust(
      "TYPE ST_B :\nSTRUCT\n\tb : BIT;\n\tc : BIT;\nEND_STRUCT\nEND_TYPE\n\nPROGRAM PLC_PRG\nVAR\n\tbits : ST_B;\n\ti : INT := 2;\n\tsx : STRING;\n\trx : REAL;\n\tl : LREAL;\nEND_VAR\nsx := TO_STRING(bits.b);\nrx := BIT_TO_REAL(bits.b);\nl := TO_LREAL(bits.b);\nbits.c := INT_TO_BIT(i);\nEND_PROGRAM\n",
    )
    expect(code).toContain(`(if self.bits.b { "TRUE" } else { "FALSE" })`)
    expect(code).toContain("self.rx = f32::from(u8::from(self.bits.b));")
    expect(code).toContain("self.l = f64::from(u8::from(self.bits.b));")
    expect(code).toContain("self.bits.c = self.i != 0;")
    expect(code).not.toMatch(/as bool/)
  })
})

/**
 * LTIME_TO_STRING READS THE LTIME AS THE u64 IT IS (transpile-review task 32). The emitter cast the LTIME to i64 for
 * `iec_ltime_text(ns: i64)`, so LTIME#106752d (past 2^63 ns) printed a negative duration; CODESYS prints it whole, up
 * to LTIME#213503d23h34m33s709ms551us615ns (`tr_32_fmt_ltime_past_i64`).
 */
describe("emit/rust — LTIME_TO_STRING is unsigned", () => {
  test("the LTIME goes to iec_ltime_text uncast, and the helper takes a u64", () => {
    const code = rust(
      "PROGRAM PLC_PRG\nVAR\n\tt : LTIME := LTIME#106752D;\n\tsx : STRING;\nEND_VAR\nsx := LTIME_TO_STRING(t);\nEND_PROGRAM\n",
    )
    // written into the target STRING at its capacity (lean 9.4)
    expect(code).toContain("self.sx = iec_ltime_text::<80>(self.t);")
    expect(code).toContain("fn iec_ltime_text<const N: usize>(ns: u64) -> IecString<N>")
  })
})

test("a constant cast prints as a literal of the target type — a REAL's f32 value, exactly (7.2.10)", () => {
  // (EXP, not SQRT: a REAL SQRT computes in f32 since 7.3.6 — `0.1f32.sqrt()` — and the digits group, 7.2.11)
  const { pou } = lowerSource("PROGRAM P\nVAR a : LREAL; b : LREAL; c : DINT; END_VAR\na := EXP(REAL#0.1);\nb := SQRT(4);\nc := TRUNC(REAL#2.5);\nEND_PROGRAM\n")
  const code = emitRust(pou!).code
  expect(code).toContain("iec_fn(0.100_000_001_490_116_12f64, f64::exp)") // the f32 0.1, widened — not the f64 0.1
  expect(code).not.toContain("iec_widen(0.1f32)")
})

/**
 * A LOSSLESS WIDENING PRINTS `T::from(x)` (7.3.5) — every widening Rust has a `From` for (an integer into a wider one that
 * holds all its values, a narrow integer or an f32 into a float that holds it exactly, a BOOL into an integer) — and `as`
 * is left for the casts that truncate or reinterpret.
 */
test("a lossless widening prints T::from, a truncating or reinterpreting cast `as`", () => {
  const code = rust(
    "PROGRAM P\nVAR si : SINT := -5; ui : UINT := 7; rl : REAL := 1.5; b : BOOL := TRUE; di : DINT; li : LINT; lr : LREAL; rb : REAL; i2 : INT; ud : UDINT; END_VAR\ndi := si;\nli := ui;\nlr := rl;\nrb := BOOL_TO_REAL(b);\ndi := BOOL_TO_DINT(b);\ni2 := DINT_TO_INT(di);\nud := DINT_TO_UDINT(di);\nlr := ui;\nEND_PROGRAM\n",
  )
  expect(code).toContain("self.di = i32::from(self.si);")
  expect(code).toContain("self.li = i64::from(self.ui);")
  // REAL -> LREAL is `iec_widen`: lossless too, and it moves a NaN's payload as CODESYS does (gate 8c)
  expect(code).toContain("self.lr = iec_widen(self.rl);")
  expect(code).toContain("self.rb = f32::from(u8::from(self.b));")
  expect(code).toContain("self.di = i32::from(self.b);")
  expect(code).toContain("self.i2 = self.di as i16;")
  expect(code).toContain("self.ud = self.di as u32;")
  expect(code).toContain("self.lr = f64::from(self.ui);")
})

/**
 * A TICK CONVERSION IN THE WIDTH IT NEEDS (7.3.9, 7.3.10): a 32-bit source scaled down, at the same tick, or cut to its
 * day stays in its own u32 (`self.t / 1000u32`, `self.d`); one scaled up computes in u64, where the product cannot
 * overflow, with a plain `*`; the whole days `count / day * day` are at most the count, a plain `*` too. And a widening
 * that keeps every value followed by a conversion is that one conversion (`self.u as i16`).
 */
test("tick conversions compute in the width they need, a product that cannot overflow with `*`; a cast chain is one cast", () => {
  const code = rust(
    "PROGRAM P\nVAR t : TOD := TOD#1:0:0; d : DATE := D#2024-1-1; dt1 : DT; dt2 : DT; ldd : LDATE; dt3 : DT := DT#2024-1-1-10:0:0; dd : DATE; u : UINT := 40000; e : INT; END_VAR\ndt1 := TOD_TO_DT(t);\ndt2 := DATE_TO_DT(d);\nldd := DATE_TO_LDATE(d);\ndd := DT_TO_DATE(dt3);\ne := UINT_TO_INT(u);\nEND_PROGRAM\n",
  )
  expect(code).toContain("self.dt1 = self.t / 1000u32;")
  expect(code).toContain("self.dt2 = self.d;")
  expect(code).toContain("self.ldd = u64::from(self.d) * 1_000_000_000u64;")
  expect(code).toContain("self.dd = self.dt3 / 86400u32 * 86400u32;")
  expect(code).toContain("self.e = self.u as i16;")
})
