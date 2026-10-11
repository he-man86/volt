/**
 * The numeric helpers the emitted code calls — the twins of `semantics/` (`convert.ts` `realToInt`, `builtins.ts` `select`,
 * `math.ts`, `arith.ts`'s zero-divisor check); `numeric.cases.ts` holds the two together (the twin harness). Each is a whole
 * Rust item, exactly the lines the module prints.
 */
import { rustFaultLiteral } from "../../../ir/faults.js"

/** MAX / MIN over a STRING (`builtins.ts` prints them for a string operand). */
export const IEC_MAX = `// MAX / MIN OVER A STRING. Rust's .max() comes from Ord, and an IecStr has only the cross-length PartialOrd
// above, so these take its place. Two equal strings are the same value, so which one a tie answers with is not
// observable (a REAL tie is: iec_fmax / iec_fmin answer the second argument, as measured). CODESYS compares byte by byte, UNSIGNED,
// a prefix losing to what it is a prefix of (conformance strord_prefix, strord_high_byte and their four
// neighbours), which is exactly what that PartialOrd does over a byte slice.
fn iec_max<T: PartialOrd>(a: T, b: T) -> T { if b > a { b } else { a } }
`
export const IEC_MIN = `fn iec_min<T: PartialOrd>(a: T, b: T) -> T { if b < a { b } else { a } }
`


/** The two halves of the measured REAL -> INTEGER table. See `coerce` in `semantics/convert.ts`. `f64::round` is already
 *  half away from zero on both signs (-0.0 stays -0.0, NaN stays NaN), and a range's `contains` is false for a NaN, so a
 *  NaN takes the out-of-range answer without a test of its own (lean 9.1). */
export const IEC_R2I64 = `// the casts ARE the measured table: each is handed only a value the tests before it admit, and 2^63..2^64 wraps
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_possible_wrap)]
fn iec_r2i64(v: f64) -> i64 {
    let c = v.round();
    if !(-9_223_372_036_854_775_808.0..18_446_744_073_709_551_616.0).contains(&c) { return i64::MIN; }
    if c >= 9_223_372_036_854_775_808.0 { return (c as u64) as i64; }
    c as i64
}
`
export const IEC_R2I32 = `// the casts ARE the measured table: through the 64-bit register, then wrapped into 32 bits
#[allow(clippy::cast_possible_truncation)]
fn iec_r2i32(v: f64) -> i32 {
    let c = v.round();
    if c < -2_147_483_648.0 { return i32::MIN; }
    if c.is_nan() || c >= 9_223_372_036_854_775_808.0 { return 0; }
    (c as i64) as i32
}
`
/** TRUNC: toward zero into a DINT whose out-of-range (and NaN) answer is DINT's minimum — `semantics/builtins.ts`'s
 *  `trunc`, held together by `TRUNC_CASES` (lean 9.2: it was printed inline at every TRUNC). */
export const IEC_TRUNC_I32 = `// TRUNC(3.0E9) is -2147483648: neither a wrap nor Rust's saturating cast (trunc_out_of_range, trunc_beyond_dint)
#[allow(clippy::cast_possible_truncation)] // the range test keeps every value the cast is given
fn iec_trunc_i32(v: f64) -> i32 {
    let t = v.trunc();
    if (-2_147_483_648.0..=2_147_483_647.0).contains(&t) { t as i32 } else { i32::MIN }
}
`
/** MAX / MIN over a REAL: CODESYS's compare-select, the SECOND argument on a tie or a NaN (`semantics/builtins.ts` `select`). */
export const IEC_FMAX = `fn iec_fmax<T: PartialOrd>(a: T, b: T) -> T { if a > b { a } else { b } }
`
export const IEC_FMIN = `fn iec_fmin<T: PartialOrd>(a: T, b: T) -> T { if a < b { a } else { b } }
`
/** NEG and ABS of a REAL as CODESYS computes them (`semantics/nan.ts`, `nan.cases.ts`): a NaN QUIETED — NEG keeping its
 *  sign, ABS clearing it — where Rust's `-x` flips a NaN's sign and `abs` leaves a signalling one signalling. */
export const IEC_FNEG32 = `// -NaN is the NaN quieted, its sign kept (nan_payload_ops: -16#7FC12345 is 16#7FC12345)
fn iec_fneg32(x: f32) -> f32 { if x.is_nan() { f32::from_bits(x.to_bits() | 0x0040_0000) } else { -x } }
`
export const IEC_FNEG64 = `fn iec_fneg64(x: f64) -> f64 { if x.is_nan() { f64::from_bits(x.to_bits() | 0x0008_0000_0000_0000) } else { -x } }
`
export const IEC_FABS32 = `// ABS(NaN) is the NaN quieted, its sign cleared (nan_payload_ops: ABS(16#FF812345) is 16#7FC12345)
fn iec_fabs32(x: f32) -> f32 { if x.is_nan() { f32::from_bits((x.to_bits() & 0x7fff_ffff) | 0x0040_0000) } else { x.abs() } }
`
export const IEC_FABS64 = `fn iec_fabs64(x: f64) -> f64 { if x.is_nan() { f64::from_bits((x.to_bits() & 0x7fff_ffff_ffff_ffff) | 0x0008_0000_0000_0000) } else { x.abs() } }
`
export const IEC_LOG =`fn iec_log(x: f64) -> f64 { assert!(x != 0.0, ${rustFaultLiteral("logarithm-of-zero")}); x }
`
export const IEC_POW = `fn iec_pow(x: f64, y: f64) -> f64 { let stops = x == 0.0 && y < 0.0 && y.is_finite(); assert!(!stops, ${rustFaultLiteral("zero-to-negative-power")}); f64::nan_of(x.powf(y), x, y) }
`
/** The emitted twin of `arith`'s zero-divisor check. Gated on its OWN use, not on `iec_deref`'s — a program can divide by
 *  zero without ever dereferencing a pointer, and attaching it to the wrong condition left the helper undefined in every
 *  program that does. */
export const IEC_DIV = `fn iec_div<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T { assert!(b != T::default(), ${rustFaultLiteral("division-by-zero")}); a / b }
`

/**
 * A REAL OPERATION'S NaN, CHOSEN IN THE CODE (gate 8c) — the twin of `semantics/nan.ts` `realResult` and `atWidth`. Rust
 * (LLVM) leaves which NaN an operation answers unspecified, and the unoptimized build only happened to answer CODESYS's: an
 * optimized one commutes an add (sNaN + payNaN answered payNaN, where CODESYS answers the sNaN quieted) and folds a widened
 * NaN's payload away. So each REAL +, -, *, /, function, EXPT and REAL <-> LREAL conversion asks its NaN of `nan_of`: the
 * result when it is no NaN, else the first NaN operand quieted, else x86's default NaN (sign set) — exact bit operations an
 * optimizer must keep.
 */
export const IEC_REAL = `// the NaN a REAL operation answers: its result, or its first NaN operand quieted, or the default NaN (nan_payload_ops)
trait IecReal: Copy + std::ops::Add<Output = Self> + std::ops::Sub<Output = Self> + std::ops::Mul<Output = Self> + std::ops::Div<Output = Self> {
    fn nan_of(r: Self, a: Self, b: Self) -> Self;
}
impl IecReal for f32 {
    fn nan_of(r: f32, a: f32, b: f32) -> f32 {
        if !r.is_nan() { r } else if a.is_nan() { f32::from_bits(a.to_bits() | 0x0040_0000) } else if b.is_nan() { f32::from_bits(b.to_bits() | 0x0040_0000) } else { f32::from_bits(0xffc0_0000) }
    }
}
impl IecReal for f64 {
    fn nan_of(r: f64, a: f64, b: f64) -> f64 {
        if !r.is_nan() { r } else if a.is_nan() { f64::from_bits(a.to_bits() | 0x0008_0000_0000_0000) } else if b.is_nan() { f64::from_bits(b.to_bits() | 0x0008_0000_0000_0000) } else { f64::from_bits(0xfff8_0000_0000_0000) }
    }
}
`
export const IEC_FADD = `fn iec_fadd<T: IecReal>(a: T, b: T) -> T { T::nan_of(a + b, a, b) }
`
export const IEC_FSUB = `fn iec_fsub<T: IecReal>(a: T, b: T) -> T { T::nan_of(a - b, a, b) }
`
export const IEC_FMUL = `fn iec_fmul<T: IecReal>(a: T, b: T) -> T { T::nan_of(a * b, a, b) }
`
export const IEC_FDIV = `fn iec_fdiv<T: IecReal>(a: T, b: T) -> T { T::nan_of(a / b, a, b) }
`
/** A REAL division whose divisor no constant proved nonzero: a zero divisor stops the task (`arith`), then `iec_fdiv`. */
export const IEC_FDIVZ = `fn iec_fdivz<T: IecReal + PartialEq + Default>(a: T, b: T) -> T { assert!(b != T::default(), ${rustFaultLiteral("division-by-zero")}); iec_fdiv(a, b) }
`
/** A REAL function of one argument (SQRT, LN, LOG, EXP, the trigonometry): its NaN is the argument's, quieted. */
export const IEC_FN = `fn iec_fn<T: IecReal>(x: T, f: fn(T) -> T) -> T { T::nan_of(f(x), x, x) }
`
/** REAL -> LREAL and LREAL -> REAL: a NaN quieted, its 23 payload bits the top of the 52 (the low 29 cut going down). */
export const IEC_WIDEN = `// REAL_TO_LREAL of a NaN moves its payload up (nan_payload_ops_lreal: 16#7FC12345 is 16#7FF82468A0000000)
fn iec_widen(x: f32) -> f64 {
    if !x.is_nan() { return f64::from(x); }
    let b = u64::from(x.to_bits());
    f64::from_bits(((b & 0x8000_0000) << 32) | 0x7ff8_0000_0000_0000 | ((b & 0x007f_ffff) << 29))
}
`
export const IEC_NARROW = `// LREAL_TO_REAL of a NaN keeps the payload's top 23 bits (16#7FF8123400000000 is 16#7FC091A0)
#[allow(clippy::cast_possible_truncation)] // the NaN's bits are cut to 32 by hand; any other value rounds as the cast does
fn iec_narrow(x: f64) -> f32 {
    if !x.is_nan() { return x as f32; }
    let b = x.to_bits();
    f32::from_bits((((b >> 32) & 0x8000_0000) | 0x7fc0_0000 | ((b >> 29) & 0x007f_ffff)) as u32)
}
`
