/**
 * The Rust the emitter prepends to a POU that holds a string — kept out of `emit.ts` so the printer reads as a printer.
 *
 * The string types: one `[T; N]` plus a length, a STRING's T a byte and a WSTRING's a UTF-16 unit. `Copy`, so a store is
 * a copy; `lit`/`to` keep at most N units, so every store truncates by construction; equality and ordering compare the
 * used units, which is CODESYS's comparison ('abc' < 'b', 'A' < 'a' — conformance `string_compare`, `wstring_basic`).
 *
 * `char_at` / `with_char` are `s[i]`, line for line the interpreter's `charAt` / `setChar` (`ir/values.ts`) — the one
 * primitive the Standard library's ST string functions are written in. The `iec_*` functions are the STRING conversions,
 * line for line the interpreter's (`coerce`, `timeText`); the differential test checks both against CODESYS.
 *
 * A TypeScript string rather than a `.rs` file: the LSP ships through `tsc`, which would not carry a text import, and it
 * never reads a data file at run time. Mind the escapes — a backslash or a backtick here is the template literal's.
 */
export const STRING_PRELUDE = `#[derive(Clone, Copy)]
pub struct IecStr<T: Copy, const N: usize> { len: usize, units: [T; N] }
pub type IecString<const N: usize> = IecStr<u8, N>;
pub type IecWString<const N: usize> = IecStr<u16, N>;
impl<T: Copy + Default, const N: usize> Default for IecStr<T, N> {
    fn default() -> Self { Self::new() }
}
impl<T: Copy + Default, const N: usize> IecStr<T, N> {
    pub fn new() -> Self { Self { len: 0, units: [T::default(); N] } }
    pub fn lit(text: &[T]) -> Self { let mut s = Self::new(); let n = text.len().min(N); s.units[..n].copy_from_slice(&text[..n]); s.len = n; s }
    pub fn units(&self) -> &[T] { &self.units[..self.len] }
    pub fn to<const M: usize>(&self) -> IecStr<T, M> { IecStr::<T, M>::lit(self.units()) }
}
// s[i] — 0-based over the N + 1 bytes of the variable: a read at or past the length is 0, a store below it replaces (a 0
// cuts), a store AT it appends, a store past it lands behind the terminator and changes nothing. Outside 0..N is
// outside the variable: a panic, as the interpreter's RangeError (ir/values.ts charAt / setChar).
// Written out, not on one line: "if .. { panic!() } if .." on one line reads to clippy as possible_missing_else.
impl<T: Copy + Default + PartialEq, const N: usize> IecStr<T, N> {
    pub fn char_at(&self, i: i64) -> T {
        if i < 0 || i as usize > N {
            panic!("character {} of a string of capacity {}", i, N)
        }
        if i as usize >= self.len { T::default() } else { self.units[i as usize] }
    }
    pub fn with_char(mut self, i: i64, c: T) -> Self {
        if i < 0 || i as usize > N || (i as usize == N && c != T::default()) {
            panic!("character {} of a string of capacity {}", i, N)
        }
        let i = i as usize;
        if i > self.len {
            return self;
        }
        if c == T::default() {
            self.len = i;
        } else {
            self.units[i] = c;
            if i == self.len {
                self.len += 1;
            }
        }
        self
    }
}
// WSTRING <-> STRING: one code unit per code unit, truncated at the TARGET's capacity — measured both ways
// (conformance xo3_string_wide_conversions: a WSTRING(10) into a STRING(4) is 'abcd', a STRING(6) into a WSTRING(2)
// is "he"). Measured on ASCII only: a STRING holds a non-ASCII character as its UTF-8 bytes, and what the vendor makes
// of a byte past 0x7F crossing to a WSTRING is not recorded — this casts it as its value, as the interpreter does.
impl<const N: usize> IecStr<u16, N> {
    pub fn narrow<const M: usize>(&self) -> IecStr<u8, M> { let mut out = IecStr::<u8, M>::new(); for &u in self.units() { if out.len == M { break } out.units[out.len] = u as u8; out.len += 1; } out }
}
impl<const N: usize> IecStr<u8, N> {
    pub fn widen<const M: usize>(&self) -> IecStr<u16, M> { let mut out = IecStr::<u16, M>::new(); for &u in self.units() { if out.len == M { break } out.units[out.len] = u as u16; out.len += 1; } out }
}
impl<T: Copy + PartialEq, const N: usize, const M: usize> PartialEq<IecStr<T, M>> for IecStr<T, N> { fn eq(&self, other: &IecStr<T, M>) -> bool { self.units[..self.len] == other.units[..other.len] } }
impl<T: Copy + PartialOrd, const N: usize, const M: usize> PartialOrd<IecStr<T, M>> for IecStr<T, N> { fn partial_cmp(&self, other: &IecStr<T, M>) -> Option<std::cmp::Ordering> { self.units[..self.len].partial_cmp(&other.units[..other.len]) } }
impl<T: Copy + Into<u32>, const N: usize> std::fmt::Debug for IecStr<T, N> { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { let text: String = self.units[..self.len].iter().map(|&u| char::from_u32(u.into()).unwrap_or('\\u{fffd}')).collect(); write!(f, "{:?}", text) } }
// MAX / MIN OVER A STRING. Rust's .max() comes from Ord, and an IecStr has only the cross-length PartialOrd
// above, so these take its place — and they pick the same operand the interpreter does: the LATER one only when
// it is strictly greater, so two equal strings answer with the first. CODESYS compares byte by byte, UNSIGNED,
// a prefix losing to what it is a prefix of (conformance strord_prefix, strord_high_byte and their four
// neighbours), which is exactly what that PartialOrd does over a byte slice.
fn iec_max<T: PartialOrd>(a: T, b: T) -> T { if b > a { b } else { a } }
fn iec_min<T: PartialOrd>(a: T, b: T) -> T { if b < a { b } else { a } }
// LREAL_TO_STRING - fifteen significant digits, trailing zeros stripped but never the last decimal, FIXED while
// the decimal exponent is 0..13 and exponential otherwise, lowercase e with no sign and no padding. Mirrors
// lrealText in the interpreter; 26 cells measured, and REAL_TO_STRING is a DIFFERENT formatter that is still
// refused by lowering (see the note there).
fn iec_lreal_text(v: f64) -> String {
    if v.is_nan() { return String::from("#NaN"); }
    if v.is_infinite() { return String::from(if v < 0.0 { "-#Inf" } else { "#Inf" }); }
    if v == 0.0 { return String::from("0.0"); }
    let sign = if v < 0.0 { "-" } else { "" };
    // Round to fifteen significant digits FIRST, so the exponent deciding the notation is the printed one.
    let text = format!("{:.*e}", 14, v.abs());
    let (mantissa, exponent) = text.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap();
    let trim = |whole: &str, fraction: &str| -> String {
        let kept = fraction.trim_end_matches('0');
        format!("{}.{}", whole, if kept.is_empty() { "0" } else { kept })
    };
    if !(0..=13).contains(&exponent) {
        return format!("{}{}e{}", sign, trim(&digits[..1], &digits[1..]), exponent);
    }
    let point = (exponent + 1) as usize;
    let mut whole = digits[..point.min(digits.len())].to_string();
    while whole.len() < point { whole.push('0'); }
    format!("{}{}", sign, trim(&whole, if point < digits.len() { &digits[point..] } else { "" }))
}
// TIME → STRING: T# and each non-zero component, largest first — 'T#1d2h', 'T#1s500ms', and 'T#0ms' for zero.
fn iec_time_text(ms: i64) -> String { let mut rest = ms; let mut out = String::new(); for (unit, suffix) in [(86_400_000i64, "d"), (3_600_000, "h"), (60_000, "m"), (1000, "s"), (1, "ms")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ms"); } format!("T#{}", out) }
// LTIME as text: a TIME's shape with the LTIME# prefix and three units below a millisecond, and the zero case names
// the SMALLEST unit. Mirrors ltimeText in the interpreter; every component boundary measured.
fn iec_ltime_text(ns: i64) -> String { let mut rest = ns; let mut out = String::new(); for (unit, suffix) in [(86_400_000_000_000i64, "d"), (3_600_000_000_000, "h"), (60_000_000_000, "m"), (1_000_000_000, "s"), (1_000_000, "ms"), (1000, "us"), (1, "ns")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ns"); } format!("LTIME#{}", out) }
// DATE, DT (seconds since 1970) and TOD (milliseconds) → STRING, as their literal zero-padded; a TOD's milliseconds only when
// non-zero — 'D#2026-05-09', 'DT#2026-05-29-12:30:45', 'TOD#07:05:03.250', 'TOD#23:59:59'. The civil date is Hinnant's
// days-from-civil inverse, mirrored line for line by the interpreter's civilDate.
fn iec_civil(days: i64) -> (i64, i64, i64) { let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097; let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 }; (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d) }
fn iec_date_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); format!("D#{:04}-{:02}-{:02}", y, m, d) }
fn iec_dt_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); let t = s.rem_euclid(86400); format!("DT#{:04}-{:02}-{:02}-{:02}:{:02}:{:02}", y, m, d, t / 3600, t / 60 % 60, t % 60) }
fn iec_tod_text(ms: i64) -> String { let s = ms / 1000; let f = ms % 1000; if f == 0 { format!("TOD#{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("TOD#{:02}:{:02}:{:02}.{:03}", s / 3600, s / 60 % 60, s % 60, f) } }
// STRING → REAL: the same decimal prefix the interpreter's regex takes ('.5', '5.', '1.5E' is 1.5), else 0.
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
