/**
 * STRING → number — `iec_parse_real`, `iec_parse_int` and the WSTRING one `iec_parse_int_wide` over the scan they share
 * (`iec_scan_int`), line for line the interpreter's (`semantics/parse.ts`). Mind the
 * escapes: a backslash or a backtick here is the template literal's.
 */
export const IEC_PARSE_REAL = `// STRING → REAL: the same decimal prefix the interpreter's regex takes ('.5', '5.', '1.5E' is 1.5), else 0.
// WRITTEN OUT, not on one line like its neighbours. Each step is a separate optional piece of the grammar, so an
// else would be wrong — but on ONE line that reads to clippy as five possible_missing_else, which was 507 of the
// fixture map's findings from this single function.
fn iec_parse_real(s: &[u8]) -> f64 {
    let mut i = 0;
    while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; }
    let start = i;
    if i < s.len() && (s[i] == b'+' || s[i] == b'-') { i += 1; }
    let int_start = i;
    while i < s.len() && s[i].is_ascii_digit() { i += 1; }
    let mut digits = i - int_start;
    if i < s.len() && s[i] == b'.' {
        i += 1;
        let frac = i;
        while i < s.len() && s[i].is_ascii_digit() { i += 1; }
        digits += i - frac;
    }
    if digits == 0 { return 0.0; }
    if i < s.len() && (s[i] == b'e' || s[i] == b'E') {
        let mut j = i + 1;
        if j < s.len() && (s[j] == b'+' || s[j] == b'-') { j += 1; }
        if j < s.len() && s[j].is_ascii_digit() {
            while j < s.len() && s[j].is_ascii_digit() { j += 1; }
            i = j;
        }
    }
    std::str::from_utf8(&s[start..i]).unwrap().parse().unwrap_or(0.0)
}
`
export const IEC_SCAN_INT = `// The integer scan: leading spaces and tabs; with no sign a 2#, 8# or 16# base ('16#FF' is 255), else an optional sign and
// decimal digits; an underscore among the digits skipped, anything else ending them (' 12abc' is 12, '-16#F' is -16);
// wrapping at 64 bits (the interpreter's scanInteger, 6.A.10). The value, where the scan stopped, and whether a minus
// sign stood before the digits.
#[allow(clippy::cast_possible_wrap)] // wrapping at 64 bits IS the parse (6.A.10)
fn iec_scan_int(s: &[u8]) -> (i64, usize, bool) {
    let mut i = 0;
    while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; }
    let neg = i < s.len() && s[i] == b'-';
    let signed = i < s.len() && (s[i] == b'-' || s[i] == b'+');
    if signed { i += 1; }
    let mut radix: u32 = 10;
    if !signed {
        for (prefix, base) in [(&b"16#"[..], 16), (&b"8#"[..], 8), (&b"2#"[..], 2)] {
            if s[i..].starts_with(prefix) { radix = base; i += prefix.len(); break; }
        }
    }
    let mut v: u64 = 0;
    while i < s.len() {
        if s[i] != b'_' {
            let Some(d) = char::from(s[i]).to_digit(radix) else { break };
            v = v.wrapping_mul(u64::from(radix)).wrapping_add(u64::from(d));
        }
        i += 1;
    }
    let v = v as i64;
    (if neg { v.wrapping_neg() } else { v }, i, neg)
}
`
export const IEC_PARSE_INT = `// STRING → integer: what the scan reads, wherever it stopped — a negative text into an unsigned type 0
// (wstring_parse_widths: '-5' into UINT is 0, into INT -5) — the interpreter's parseInteger.
fn iec_parse_int(s: &[u8], unsigned: bool) -> i64 { let (v, _, neg) = iec_scan_int(s); if unsigned && neg { 0 } else { v } }
`
export const IEC_PARSE_INT_WIDE = `// WSTRING → integer: the same scan over the units, answered only when it read them all ("12abc" and "5 " are 0, " 5" is
// 5) — the interpreter's parseIntegerWide (transpile-restructure 8.2, wstring_parse_grammar). A unit past 255 is no
// character of a number: it ends the scan, as the 0 it narrows to here does.
fn iec_parse_int_wide(s: &[u16], unsigned: bool) -> i64 {
    let narrow: Vec<u8> = s.iter().map(|&u| u8::try_from(u).unwrap_or(0)).collect();
    let (v, end, neg) = iec_scan_int(&narrow);
    if end == narrow.len() && !(unsigned && neg) { v } else { 0 }
}
`
