/**
 * The string types the emitted code holds (model 2): one `[T; N]` plus a length, a STRING's T a byte and a WSTRING's a UTF-16
 * unit. `Copy`; `lit`/`to` build a FRESH buffer of at most N units, and `store` writes into an existing one the way an ST
 * assignment does (min(M, N) source units and a 0, the units behind kept — the interpreter's `storeString`); equality
 * and ordering compare the used units, which is CODESYS's comparison ('abc' < 'b', 'A' < 'a' — conformance
 * `string_compare`, `wstring_basic`).
 *
 * `char_at` / `set_char` are `s[i]` (`with_char` the by-value `set_char` a store whose position or unit holds a call takes), line for line the interpreter's `charAt` / `setChar` (`semantics/string.ts`) — the one
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
    #[must_use]
    pub fn new() -> Self { Self { len: 0, units: [T::default(); N] } }
    #[must_use]
    pub fn lit(text: &[T]) -> Self { let mut s = Self::new(); let n = text.len().min(N); s.units[..n].copy_from_slice(&text[..n]); s.scan(); s }
    #[must_use]
    pub fn units(&self) -> &[T] { &self.units[..self.len] }
    // the units BOTH buffers hold, the bytes behind the terminator among them — the interpreter's fit slicing its buffer
    #[must_use]
    pub fn to<const M: usize>(&self) -> IecStr<T, M> { let mut s = IecStr::<T, M>::new(); let n = N.min(M); s.units[..n].copy_from_slice(&self.units[..n]); s.scan(); s }
    // a store into THIS buffer (model 2): min(M, N) units of the source's buffer, a 0 behind them, and the units behind
    // that left as they were — the interpreter's storeString (semantics/string.ts; string_assign_tail_wide)
    pub fn store<const M: usize>(&mut self, src: &IecStr<T, M>) { let k = M.min(N); self.units[..k].copy_from_slice(&src.units[..k]); if k < N { self.units[k] = T::default(); } self.scan(); }
    // the length is where the first 0 stands: the buffer behind it is kept
    fn scan(&mut self) { self.len = self.units.iter().position(|u| *u == T::default()).unwrap_or(N); }
}
// s[i] — 0-based over the N + 1 bytes of the variable, the bytes behind the terminator included: a read reads that byte,
// a store stores it and the length is re-scanned — a 0 cuts the string and keeps its tail, which a store over that 0
// brings back (tr_34_lib_prim_char_behind). Byte N is the terminator: it reads 0, and only a 0 fits. Outside 0..N is
// outside the variable: a panic, as the interpreter's RangeError (semantics/string.ts charAt / setChar).
impl<T: Copy + Default + PartialEq, const N: usize> IecStr<T, N> {
    /// # Panics
    /// Outside the variable's N + 1 units, as CODESYS stops the task.
    #[must_use]
    pub fn char_at(&self, i: i64) -> T {
        let Some(at) = usize::try_from(i).ok().filter(|&at| at <= N) else {
            panic!("character {i} of a string of capacity {N}")
        };
        if at == N { T::default() } else { self.units[at] }
    }
    /// # Panics
    /// Outside the variable's N + 1 units, or a unit other than 0 into the terminator, as CODESYS stops the task.
    pub fn set_char(&mut self, i: i64, c: T) {
        let Some(at) = usize::try_from(i).ok().filter(|&at| at < N || (at == N && c == T::default())) else {
            panic!("character {i} of a string of capacity {N}")
        };
        if at < N {
            self.units[at] = c;
        }
        self.scan();
    }
    /// # Panics
    /// As \`set_char\`.
    #[must_use]
    pub fn with_char(mut self, i: i64, c: T) -> Self {
        self.set_char(i, c);
        self
    }
}
// WSTRING <-> STRING: one code unit per code unit, truncated at the TARGET's capacity — measured both ways
// (conformance xo3_string_wide_conversions: a WSTRING(10) into a STRING(4) is 'abcd', a STRING(6) into a WSTRING(2)
// is "he"). Measured on ASCII only: a STRING holds a non-ASCII character as its UTF-8 bytes, and what the vendor makes
// of a byte past 0x7F crossing to a WSTRING is not recorded — this casts it as its value, as the interpreter does.
impl<const N: usize> IecStr<u16, N> {
    #[must_use]
    #[allow(clippy::cast_possible_truncation)] // a unit past 0xFF keeps its low byte: the cast IS the conversion (above)
    pub fn narrow<const M: usize>(&self) -> IecStr<u8, M> { let mut out = IecStr::<u8, M>::new(); for &u in self.units() { if out.len == M { break } out.units[out.len] = u as u8; out.len += 1; } out }
}
impl<const N: usize> IecStr<u8, N> {
    #[must_use]
    pub fn widen<const M: usize>(&self) -> IecStr<u16, M> { let mut out = IecStr::<u16, M>::new(); for &u in self.units() { if out.len == M { break } out.units[out.len] = u16::from(u); out.len += 1; } out }
}
impl<T: Copy + PartialEq, const N: usize, const M: usize> PartialEq<IecStr<T, M>> for IecStr<T, N> { fn eq(&self, other: &IecStr<T, M>) -> bool { self.units[..self.len] == other.units[..other.len] } }
impl<T: Copy + Eq, const N: usize> Eq for IecStr<T, N> {}
impl<T: Copy + PartialOrd, const N: usize, const M: usize> PartialOrd<IecStr<T, M>> for IecStr<T, N> { fn partial_cmp(&self, other: &IecStr<T, M>) -> Option<std::cmp::Ordering> { self.units[..self.len].partial_cmp(&other.units[..other.len]) } }
impl<T: Copy + Into<u32>, const N: usize> std::fmt::Debug for IecStr<T, N> { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { let text: String = self.units[..self.len].iter().map(|&u| char::from_u32(u.into()).unwrap_or('\\u{fffd}')).collect(); write!(f, "{text:?}") } }
`
/** A WHOLE STORE THROUGH A STRING VAR_IN_OUT BOUND WIDER THAN IT DECLARES (transpile-restructure 8.2, design.md §7.2 Decision
 *  (step 8e)): the store into the first D units of this, the caller's, buffer — min(M, D) source units and a 0 behind them,
 *  the caller's units behind that kept (`string_inout_wider_stores`) — the interpreter's `storeString` with the declared
 *  capacity as its m. Lowering hands it only an in-out whose declared D is below the caller's N (CODESYS refuses a narrower
 *  binding, `string_inout_narrower`), so the 0 lands inside the buffer. Printed on demand, apart from the string type. */
export const IEC_STR_STORE_WITHIN = `// a store through a STRING VAR_IN_OUT that declares D units, bound to this wider buffer (string_inout_wider_stores)
impl<T: Copy + Default + PartialEq, const N: usize> IecStr<T, N> {
    pub fn store_within<const D: usize, const M: usize>(&mut self, src: &IecStr<T, M>) { let k = M.min(D).min(N); self.units[..k].copy_from_slice(&src.units[..k]); if k < N { self.units[k] = T::default(); } self.scan(); }
}
`
/** `Standard.LEN_INTERNAL` (`IrBuiltinName` `length`): the units before the first 0, which `len` holds — `units().len()`,
 *  the interpreter's `lengthOf` (`semantics/string.ts`). Lowering refuses a string a UINT cannot count
 *  (`string-length-width`), so the cast never truncates. Printed on demand, apart from the string type. */
export const IEC_STR_LENGTH = `// LEN_INTERNAL: the units before the first 0 (a capacity past 65535 is refused in lowering: string-length-width)
impl<T: Copy, const N: usize> IecStr<T, N> {
    #[must_use]
    #[allow(clippy::cast_possible_truncation)] // N <= 65535, so the count fits (above)
    pub fn length(&self) -> u16 { self.len as u16 }
}
`
