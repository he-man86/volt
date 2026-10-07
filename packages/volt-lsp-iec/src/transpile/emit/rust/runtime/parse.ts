/**
 * STRING → number — `iec_parse_real`, `iec_parse_int`, line for line the interpreter's (`semantics/parse.ts`). Mind the
 * escapes: a backslash or a backtick here is the template literal's.
 */
export const PARSE = `// STRING → REAL: the same decimal prefix the interpreter's regex takes ('.5', '5.', '1.5E' is 1.5), else 0.
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
// STRING → integer: leading spaces and tabs, an optional sign, then the digits, stopping at anything else (' 12abc' is 12).
fn iec_parse_int(s: &[u8]) -> i64 {
    let mut i = 0;
    while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; }
    let neg = i < s.len() && s[i] == b'-';
    if i < s.len() && (s[i] == b'-' || s[i] == b'+') { i += 1; }
    let mut v: i64 = 0;
    for &b in &s[i..] {
        if !b.is_ascii_digit() { break; }
        v = v.wrapping_mul(10).wrapping_add((b - b'0') as i64);
    }
    if neg { v.wrapping_neg() } else { v }
}
`
