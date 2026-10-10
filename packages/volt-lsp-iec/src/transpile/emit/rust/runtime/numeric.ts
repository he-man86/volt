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
export const IEC_LOG = `fn iec_log(x: f64) -> f64 { assert!(x != 0.0, ${rustFaultLiteral("logarithm-of-zero")}); x }
`
export const IEC_POW = `fn iec_pow(x: f64, y: f64) -> f64 { let stops = x == 0.0 && y < 0.0 && y.is_finite(); assert!(!stops, ${rustFaultLiteral("zero-to-negative-power")}); x.powf(y) }
`
/** The emitted twin of `arith`'s zero-divisor check. Gated on its OWN use, not on `iec_deref`'s — a program can divide by
 *  zero without ever dereferencing a pointer, and attaching it to the wrong condition left the helper undefined in every
 *  program that does. */
export const IEC_DIV = `fn iec_div<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T { assert!(b != T::default(), ${rustFaultLiteral("division-by-zero")}); a / b }
`
