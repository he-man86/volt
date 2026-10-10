/**
 * The STRING conversions' formatters — `iec_*_text`, one registry entry each (`index.ts`), line for line the interpreter's
 * (`semantics/text.ts`); the differential test and the twin harness check both against CODESYS. A comment above a group
 * rides with the group's first entry. Mind the escapes: a backslash or a backtick here is the template literal's.
 *
 * Each WRITES INTO THE STRING it answers (`IecString<N>`, lean 9.4) through `IEC_STR_WRITE`, cut at the capacity exactly as
 * `IecStr::lit` cut the `String` each used to build — so no formatter allocates, and the text a conversion stores is the
 * same bytes.
 */

/** A formatter writes into a STRING: `std::fmt::Write` for `IecStr<u8, N>`, appending and cutting at the capacity. */
export const IEC_STR_WRITE = `// a formatter writes into a STRING: its bytes appended, cut at the capacity as a literal is cut (IecStr::lit)
impl<const N: usize> std::fmt::Write for IecStr<u8, N> {
    fn write_str(&mut self, text: &str) -> std::fmt::Result {
        for &b in text.as_bytes() {
            if self.len == N { break; }
            self.units[self.len] = b;
            self.len += 1;
        }
        Ok(())
    }
}
`
export const IEC_LREAL_TEXT = `// LREAL_TO_STRING - fifteen significant digits, trailing zeros stripped but never the last decimal, FIXED while
// the decimal exponent is 0..13 and exponential otherwise, lowercase e with no sign and no padding. Mirrors
// lrealText in the interpreter; 26 cells measured, and REAL_TO_STRING is a DIFFERENT formatter that is still
// refused by lowering (see the note there).
fn iec_lreal_text<const N: usize>(v: f64) -> IecString<N> {
    use std::fmt::Write as _;
    // the fraction's trailing zeros stripped, but never its last digit
    fn fraction(digits: &str) -> &str { let kept = digits.trim_end_matches('0'); if kept.is_empty() { "0" } else { kept } }
    let mut out = IecString::<N>::new();
    if v.is_nan() || v.is_infinite() || v == 0.0 {
        let _ = out.write_str(if v.is_nan() { "#NaN" } else if v == 0.0 { "0.0" } else if v < 0.0 { "-#Inf" } else { "#Inf" });
        return out;
    }
    // Round to fifteen significant digits FIRST, so the exponent deciding the notation is the printed one — and HALF-UP
    // on the exact value, as CODESYS and toExponential do (tr_33_fmt_lreal_tie). format!'s own rounding is half-to-even,
    // and rounding to any shorter precision first can carry into the 16th digit, so this takes the EXACT expansion
    // (an f64 has at most 767 significant digits; "d." + 800 digits + "e-324" fits 820 bytes) and decides on its 16th
    // digit alone.
    let mut exact = IecString::<820>::new();
    let _ = write!(exact, "{:.800e}", v.abs());
    let text = exact.units();
    let e = text.iter().position(|&c| c == b'e').unwrap();
    let mut exponent: i32 = std::str::from_utf8(&text[e + 1..]).unwrap().parse().unwrap();
    // the first fifteen digits: the one before the point, then fourteen after it
    let mut kept = [0u8; 15];
    kept[0] = text[0];
    kept[1..].copy_from_slice(&text[2..16]);
    if text[16] >= b'5' {
        let mut i = 15;
        while i > 0 && kept[i - 1] == b'9' { kept[i - 1] = b'0'; i -= 1; }
        if i == 0 { kept[0] = b'1'; exponent += 1; } else { kept[i - 1] += 1; }
    }
    let digits = std::str::from_utf8(&kept).unwrap();
    if v < 0.0 { let _ = out.write_str("-"); }
    match usize::try_from(exponent) {
        // FIXED, the exponent 0..13: 1 to 14 digits before the point, the rest of the fifteen after it
        Ok(at) if at <= 13 => { let _ = write!(out, "{}.{}", &digits[..=at], fraction(&digits[at + 1..])); }
        _ => { let _ = write!(out, "{}.{}e{exponent}", &digits[..1], fraction(&digits[1..])); }
    }
    out
}
`
export const IEC_TIME_TEXT = `// TIME → STRING: T# and each non-zero component, largest first — 'T#1d2h', 'T#1s500ms', and 'T#0ms' for zero.
fn iec_time_text<const N: usize>(ms: i64) -> IecString<N> { use std::fmt::Write as _; let mut out = IecString::<N>::lit(b"T#"); let mut rest = ms; let mut none = true; for (unit, suffix) in [(86_400_000i64, "d"), (3_600_000, "h"), (60_000, "m"), (1000, "s"), (1, "ms")] { let n = rest / unit; rest %= unit; if n != 0 { let _ = write!(out, "{n}{suffix}"); none = false; } } if none { let _ = out.write_str("0ms"); } out }
`
export const IEC_LTIME_TEXT = `// LTIME as text: a TIME's shape with the LTIME# prefix and three units below a millisecond, and the zero case names
// the SMALLEST unit. Mirrors ltimeText in the interpreter; every component boundary measured.
fn iec_ltime_text<const N: usize>(ns: u64) -> IecString<N> { use std::fmt::Write as _; let mut out = IecString::<N>::lit(b"LTIME#"); let mut rest = ns; let mut none = true; for (unit, suffix) in [(86_400_000_000_000u64, "d"), (3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"), (1_000_000, "ms"), (1000, "us"), (1, "ns")] { let n = rest / unit; rest %= unit; if n != 0 { let _ = write!(out, "{n}{suffix}"); none = false; } } if none { let _ = out.write_str("0ns"); } out }
`
export const IEC_CIVIL = `// DATE, DT (seconds since 1970) and TOD (milliseconds) → STRING, as their literal zero-padded; a TOD's milliseconds only when
// non-zero — 'D#2026-05-09', 'DT#2026-05-29-12:30:45', 'TOD#07:05:03.250', 'TOD#23:59:59'. The civil date is Hinnant's
// days-from-civil inverse, mirrored line for line by the interpreter's civilDate.
fn iec_civil(days: i64) -> (i64, i64, i64) { let z = days + 719_468; let era = z.div_euclid(146_097); let doe = z - era * 146_097; let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let day = doy - (153 * mp + 2) / 5 + 1; let month = if mp < 10 { mp + 3 } else { mp - 9 }; (yoe + era * 400 + i64::from(month <= 2), month, day) }
`
export const IEC_DATE_TEXT = `fn iec_date_text<const N: usize>(secs: i64) -> IecString<N> { use std::fmt::Write as _; let (y, m, d) = iec_civil(secs.div_euclid(86_400)); let mut out = IecString::<N>::new(); let _ = write!(out, "D#{y:04}-{m:02}-{d:02}"); out }
`
export const IEC_DT_TEXT = `fn iec_dt_text<const N: usize>(secs: i64) -> IecString<N> { use std::fmt::Write as _; let (y, m, d) = iec_civil(secs.div_euclid(86_400)); let t = secs.rem_euclid(86_400); let mut out = IecString::<N>::new(); let _ = write!(out, "DT#{y:04}-{m:02}-{d:02}-{:02}:{:02}:{:02}", t / 3600, t / 60 % 60, t % 60); out }
`
export const IEC_TOD_TEXT = `fn iec_tod_text<const N: usize>(ms: i64) -> IecString<N> { use std::fmt::Write as _; let secs = ms / 1000; let frac = ms % 1000; let mut out = IecString::<N>::lit(b"TOD#"); let _ = write!(out, "{:02}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60); if frac != 0 { let _ = write!(out, ".{frac:03}"); } out }
`
export const IEC_LCLOCK = `// LDT, LDATE and LTOD (nanoseconds, taken as i64: CODESYS reads them signed, so 2300 wraps to 1715) → STRING —
// 'LDT#2024-02-29-13:05:09.000000001', 'LD#2024-02-29', 'LTOD#00:00:00'; a zero fraction omitted, any other nine
// digits; the LDT's date floors, the LDATE's day truncates toward zero. Mirrors longCalendarText in the interpreter.
fn iec_lclock(out: &mut impl std::fmt::Write, ns: i64) { let secs = ns / 1_000_000_000; let frac = ns % 1_000_000_000; let _ = write!(out, "{:02}:{:02}:{:02}", secs / 3600, secs / 60 % 60, secs % 60); if frac != 0 { let _ = write!(out, ".{frac:09}"); } }
`
export const IEC_LDT_TEXT = `fn iec_ldt_text<const N: usize>(ns: i64) -> IecString<N> { use std::fmt::Write as _; let (y, m, d) = iec_civil(ns.div_euclid(86_400_000_000_000)); let mut out = IecString::<N>::new(); let _ = write!(out, "LDT#{y:04}-{m:02}-{d:02}-"); iec_lclock(&mut out, ns.rem_euclid(86_400_000_000_000)); out }
`
export const IEC_LDATE_TEXT = `fn iec_ldate_text<const N: usize>(ns: i64) -> IecString<N> { use std::fmt::Write as _; let (y, m, d) = iec_civil(ns / 86_400_000_000_000); let mut out = IecString::<N>::new(); let _ = write!(out, "LD#{y:04}-{m:02}-{d:02}"); out }
`
export const IEC_LTOD_TEXT = `fn iec_ltod_text<const N: usize>(ns: i64) -> IecString<N> { let mut out = IecString::<N>::lit(b"LTOD#"); iec_lclock(&mut out, ns); out }
`
