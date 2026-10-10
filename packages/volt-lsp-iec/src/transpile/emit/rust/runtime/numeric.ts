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


/** The two halves of the measured REAL -> INTEGER table. See `coerce` in `semantics/convert.ts`. */
export const IEC_R2I64 = `fn iec_r2i64(v: f64) -> i64 {
    let c = if v < 0.0 { -((-v).round()) } else { v.round() };
    if c.is_nan() || !(-9223372036854775808.0..18446744073709551616.0).contains(&c) { return i64::MIN; }
    if c >= 9223372036854775808.0 { return (c as u64) as i64; }
    c as i64
}
`
export const IEC_R2I32 = `fn iec_r2i32(v: f64) -> i32 {
    let c = if v < 0.0 { -((-v).round()) } else { v.round() };
    if c.is_nan() { return 0; }
    if c < -2147483648.0 { return i32::MIN; }
    if c >= 9223372036854775808.0 { return 0; }
    (c as i64) as i32
}
`
/** MAX / MIN over a REAL: CODESYS's compare-select, the SECOND argument on a tie or a NaN (`semantics/builtins.ts` `select`). */
export const IEC_FMAX = `fn iec_fmax<T: PartialOrd>(a: T, b: T) -> T { if a > b { a } else { b } }
`
export const IEC_FMIN = `fn iec_fmin<T: PartialOrd>(a: T, b: T) -> T { if a < b { a } else { b } }
`
export const IEC_LOG = `fn iec_log(x: f64) -> f64 { if x == 0.0 { panic!(${rustFaultLiteral("logarithm-of-zero")}); } x }
`
export const IEC_POW = `fn iec_pow(x: f64, y: f64) -> f64 { if x == 0.0 && y < 0.0 && y.is_finite() { panic!(${rustFaultLiteral("zero-to-negative-power")}); } x.powf(y) }
`
/** The emitted twin of `arith`'s zero-divisor check. Gated on its OWN use, not on `iec_deref`'s — a program can divide by
 *  zero without ever dereferencing a pointer, and attaching it to the wrong condition left the helper undefined in every
 *  program that does. */
export const IEC_DIV = `fn iec_div<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T { if b == T::default() { panic!(${rustFaultLiteral("division-by-zero")}); } a / b }
`
