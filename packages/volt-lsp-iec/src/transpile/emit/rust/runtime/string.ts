/**
 * The string types the emitted code holds (model 2): one `[T; N]` plus a length, a STRING's T a byte and a WSTRING's a UTF-16
 * unit. `Copy`, so a store is a copy; `lit`/`to` keep at most N units, so every store truncates by construction; equality
 * and ordering compare the used units, which is CODESYS's comparison ('abc' < 'b', 'A' < 'a' — conformance
 * `string_compare`, `wstring_basic`).
 *
 * `char_at` / `with_char` are `s[i]`, line for line the interpreter's `charAt` / `setChar` (`semantics/string.ts`) — the one
 * primitive the Standard library's ST string functions are written in.
 *
 * A TypeScript string rather than a `.rs` file: the LSP ships through `tsc`, which would not carry a text import, and it
 * never reads a data file at run time. Mind the escapes — a backslash or a backtick here is the template literal's.
 */
export const IEC_STR = `#[derive(Clone, Copy)]
pub struct IecStr<T: Copy, const N: usize> { len: usize, units: [T; N] }
pub type IecString<const N: usize> = IecStr<u8, N>;
pub type IecWString<const N: usize> = IecStr<u16, N>;
impl<T: Copy + Default + PartialEq, const N: usize> Default for IecStr<T, N> {
    fn default() -> Self { Self::new() }
}
impl<T: Copy + Default + PartialEq, const N: usize> IecStr<T, N> {
    pub fn new() -> Self { Self { len: 0, units: [T::default(); N] } }
    pub fn lit(text: &[T]) -> Self { let mut s = Self::new(); let n = text.len().min(N); s.units[..n].copy_from_slice(&text[..n]); s.scan(); s }
    pub fn units(&self) -> &[T] { &self.units[..self.len] }
    // the units BOTH buffers hold, the bytes behind the terminator among them — the interpreter's fit slicing its buffer
    pub fn to<const M: usize>(&self) -> IecStr<T, M> { let mut s = IecStr::<T, M>::new(); let n = N.min(M); s.units[..n].copy_from_slice(&self.units[..n]); s.scan(); s }
    // the length is where the first 0 stands: the buffer behind it is kept
    fn scan(&mut self) { self.len = self.units.iter().position(|u| *u == T::default()).unwrap_or(N); }
}
// s[i] — 0-based over the N + 1 bytes of the variable, the bytes behind the terminator included: a read reads that byte,
// a store stores it and the length is re-scanned — a 0 cuts the string and keeps its tail, which a store over that 0
// brings back (tr_34_lib_prim_char_behind). Byte N is the terminator: it reads 0, and only a 0 fits. Outside 0..N is
// outside the variable: a panic, as the interpreter's RangeError (semantics/string.ts charAt / setChar).
// Written out, not on one line: "if .. { panic!() } if .." on one line reads to clippy as possible_missing_else.
impl<T: Copy + Default + PartialEq, const N: usize> IecStr<T, N> {
    pub fn char_at(&self, i: i64) -> T {
        if i < 0 || i as usize > N {
            panic!("character {} of a string of capacity {}", i, N)
        }
        if i as usize == N { T::default() } else { self.units[i as usize] }
    }
    pub fn with_char(mut self, i: i64, c: T) -> Self {
        if i < 0 || i as usize > N || (i as usize == N && c != T::default()) {
            panic!("character {} of a string of capacity {}", i, N)
        }
        let i = i as usize;
        if i < N {
            self.units[i] = c;
        }
        self.scan();
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
`
