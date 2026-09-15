/**
 * The Rust the emitter prepends to a POU that holds a string — kept out of `emit.ts` so the printer reads as a printer.
 *
 * The string types: one `[T; N]` plus a length, a STRING's T a byte and a WSTRING's a UTF-16 unit. `Copy`, so a store is
 * a copy; `lit`/`to` keep at most N units, so every store truncates by construction; equality and ordering compare the
 * used units, which is CODESYS's comparison ('abc' < 'b', 'A' < 'a' — conformance `string_compare`, `wstring_basic`).
 *
 * The `iec_*` functions are the Standard string functions and the STRING conversions, line for line the interpreter's
 * (`interp.ts` STRING_FUNCTIONS, `coerce`, `timeText`); the differential test checks both against CODESYS.
 *
 * A TypeScript string rather than a `.rs` file: the LSP ships through `tsc`, which would not carry a text import, and it
 * never reads a data file at run time. Mind the escapes — a backslash or a backtick here is the template literal's.
 */
export const STRING_PRELUDE = `#[derive(Clone, Copy)]
pub struct IecStr<T: Copy, const N: usize> { len: usize, units: [T; N] }
pub type IecString<const N: usize> = IecStr<u8, N>;
pub type IecWString<const N: usize> = IecStr<u16, N>;
impl<T: Copy + Default, const N: usize> IecStr<T, N> {
    pub fn new() -> Self { Self { len: 0, units: [T::default(); N] } }
    pub fn lit(text: &[T]) -> Self { let mut s = Self::new(); let n = text.len().min(N); s.units[..n].copy_from_slice(&text[..n]); s.len = n; s }
    pub fn units(&self) -> &[T] { &self.units[..self.len] }
    pub fn to<const M: usize>(&self) -> IecStr<T, M> { IecStr::<T, M>::lit(self.units()) }
}
impl<T: Copy + Default, const N: usize> Default for IecStr<T, N> { fn default() -> Self { Self::new() } }
impl<T: Copy + PartialEq, const N: usize, const M: usize> PartialEq<IecStr<T, M>> for IecStr<T, N> { fn eq(&self, other: &IecStr<T, M>) -> bool { self.units[..self.len] == other.units[..other.len] } }
impl<T: Copy + PartialOrd, const N: usize, const M: usize> PartialOrd<IecStr<T, M>> for IecStr<T, N> { fn partial_cmp(&self, other: &IecStr<T, M>) -> Option<std::cmp::Ordering> { self.units[..self.len].partial_cmp(&other.units[..other.len]) } }
impl<T: Copy + Into<u32>, const N: usize> std::fmt::Debug for IecStr<T, N> { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { let text: String = self.units[..self.len].iter().map(|&u| char::from_u32(u.into()).unwrap_or('\\u{fffd}')).collect(); write!(f, "{:?}", text) } }
// The Standard string functions — line for line the interpreter's STRING_FUNCTIONS: 1-based, clamped positions.
fn iec_count(n: i64, s: &[u8]) -> usize { (n.max(0) as usize).min(s.len()) }
fn iec_span(s: &[u8], start: usize, length: usize) -> &[u8] { let start = start.min(s.len()); &s[start..(start + length).min(s.len())] }
fn iec_len(s: &[u8]) -> i64 { s.len() as i64 }
fn iec_left(s: &[u8], n: i64) -> Vec<u8> { s[..iec_count(n, s)].to_vec() }
fn iec_right(s: &[u8], n: i64) -> Vec<u8> { s[s.len() - iec_count(n, s)..].to_vec() }
fn iec_mid(s: &[u8], l: i64, p: i64) -> Vec<u8> { if p < 1 || l <= 0 { return Vec::new(); } iec_span(s, (p - 1) as usize, l as usize).to_vec() }
fn iec_concat(a: &[u8], b: &[u8]) -> Vec<u8> { [a, b].concat() }
fn iec_insert(a: &[u8], b: &[u8], p: i64) -> Vec<u8> { if p < 0 || p as usize > a.len() { return a.to_vec(); } let p = p as usize; [&a[..p], b, &a[p..]].concat() }
fn iec_delete(s: &[u8], l: i64, p: i64) -> Vec<u8> { if p < 1 || l <= 0 { return s.to_vec(); } let start = ((p - 1) as usize).min(s.len()); let end = start + iec_span(s, start, l as usize).len(); [&s[..start], &s[end..]].concat() }
fn iec_replace(a: &[u8], b: &[u8], l: i64, p: i64) -> Vec<u8> { iec_insert(&iec_delete(a, l, p), b, (p - 1).max(0)) }
fn iec_find(a: &[u8], b: &[u8]) -> i64 { if b.is_empty() { return 0; } a.windows(b.len()).position(|w| w == b).map_or(0, |i| i as i64 + 1) }
// TIME → STRING: T# and each non-zero component, largest first — 'T#1d2h', 'T#1s500ms', and 'T#0ms' for zero.
fn iec_time_text(ms: i64) -> String { let mut rest = ms; let mut out = String::new(); for (unit, suffix) in [(86_400_000i64, "d"), (3_600_000, "h"), (60_000, "m"), (1000, "s"), (1, "ms")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ms"); } format!("T#{}", out) }
// DATE, DT (seconds since 1970) and TOD (milliseconds) → STRING, as their literal zero-padded; a TOD's milliseconds only when
// non-zero — 'D#2026-05-09', 'DT#2026-05-29-12:30:45', 'TOD#07:05:03.250', 'TOD#23:59:59'. The civil date is Hinnant's
// days-from-civil inverse, mirrored line for line by the interpreter's civilDate.
fn iec_civil(days: i64) -> (i64, i64, i64) { let z = days + 719468; let era = z.div_euclid(146097); let doe = z - era * 146097; let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); let mp = (5 * doy + 2) / 153; let d = doy - (153 * mp + 2) / 5 + 1; let m = if mp < 10 { mp + 3 } else { mp - 9 }; (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d) }
fn iec_date_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); format!("D#{:04}-{:02}-{:02}", y, m, d) }
fn iec_dt_text(s: i64) -> String { let (y, m, d) = iec_civil(s.div_euclid(86400)); let t = s.rem_euclid(86400); format!("DT#{:04}-{:02}-{:02}-{:02}:{:02}:{:02}", y, m, d, t / 3600, t / 60 % 60, t % 60) }
fn iec_tod_text(ms: i64) -> String { let s = ms / 1000; let f = ms % 1000; if f == 0 { format!("TOD#{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("TOD#{:02}:{:02}:{:02}.{:03}", s / 3600, s / 60 % 60, s % 60, f) } }
// STRING → REAL: the same decimal prefix the interpreter's regex takes ('.5', '5.', '1.5E' is 1.5), else 0.
fn iec_parse_real(s: &[u8]) -> f64 { let mut i = 0; while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; } let start = i; if i < s.len() && (s[i] == b'+' || s[i] == b'-') { i += 1; } let int_start = i; while i < s.len() && s[i].is_ascii_digit() { i += 1; } let mut digits = i - int_start; if i < s.len() && s[i] == b'.' { i += 1; let frac = i; while i < s.len() && s[i].is_ascii_digit() { i += 1; } digits += i - frac; } if digits == 0 { return 0.0; } if i < s.len() && (s[i] == b'e' || s[i] == b'E') { let mut j = i + 1; if j < s.len() && (s[j] == b'+' || s[j] == b'-') { j += 1; } if j < s.len() && s[j].is_ascii_digit() { while j < s.len() && s[j].is_ascii_digit() { j += 1; } i = j; } } std::str::from_utf8(&s[start..i]).unwrap().parse().unwrap_or(0.0) }
// STRING → integer: leading spaces and tabs, an optional sign, then the digits, stopping at anything else (' 12abc' is 12).
fn iec_parse_int(s: &[u8]) -> i64 { let mut i = 0; while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; } let neg = i < s.len() && s[i] == b'-'; if i < s.len() && (s[i] == b'-' || s[i] == b'+') { i += 1; } let mut v: i64 = 0; for &b in &s[i..] { if !b.is_ascii_digit() { break; } v = v.wrapping_mul(10).wrapping_add((b - b'0') as i64); } if neg { v.wrapping_neg() } else { v } }
`
