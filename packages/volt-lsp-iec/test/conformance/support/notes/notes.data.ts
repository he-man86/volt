/**
 * ONE NOTE PER CONSTRUCT, keyed by its id; the comment above each is the construct as `normalizeRustLine` prints it.
 * A construct that several items named carries all of them (`merged`, one owner per item). Each item's owner was
 * tagged by transpile-restructure 0.6 (0b gave every merged item its own): the task that names the note, else the task
 * that names another note of the same review item, else the phase-7 task its text describes; an item that asks for no
 * change is `keep:<reason>`. The task that lands removes its items, and a note goes with its last item: an item whose
 * owner is ticked is refused (`noteTagProblems`, transpile-restructure 7.11.2).
 */
import type { ShapeNote } from "../../fixtures/map-row.js"
import { LEAN } from "./lean.data.js"
import { merged, note } from "./lean.js"

export const NOTES: Readonly<Record<string, ShapeNote>> = {
  // x: std::array::from_fn(|_| L),
  "00c356c11c": note("7.8.2", LEAN.shapes18_8),
  // pub fn x<const T: usize>(mut __grid_lower_N: i32, mut __grid_upper_N: i32, mut __grid_lower_N: i32, mut __grid_upp
  "00fc50d055": note("7.7.1", LEAN.shapes17_11),
  // self.v = (-Li64).wrapping_neg();
  // pub fn fb_init(&mut self, prg: &mut Programs, mut x: bool, …) -> bool {
  "0180f72495": note("7.7.1", LEAN.shapes9_9),
  // m(Li32, &mut (*x));
  "01e84968c3": note("7.8.6", LEAN.shapes12_5),
  // x = *x;
  "01ef1b756d": note("7.7.7", LEAN.shapes12_9),
  // pub fn m(mut x: u8, …) -> bool {
  "03846c1eae": note("7.7.3", LEAN.shapes14_14),
  // pub fn m(mut x: i32, x: &mut i16) -> i32 {
  "040107266f": note("7.7.9", LEAN.shapes19_2),
  // x: { let mut v = T::new(); v.f = { let mut v = T::new(); v.f = L; v }; v.f = L; v },
  "04beb1d55a": note("7.8.3", LEAN.shapes3_7),
  // pub fn m(mut x: i32, x: &mut T) -> i32 {
  "0855e1134c": note("7.7.1", LEAN.shapes18_9),
  // self.f = f64::m(self.f).exp() as f32;
  "84845bb684": note("keep:f32::exp differs from the f64 round trip on 23,280 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // return x;
  "0969e59592": note("7.7.3", LEAN.shapes12_10),
  // self.f = self.__numbers_lower_N;
  "09b1152bef": note("7.7.8", LEAN.shapes14_15),
  // self.f.widen();
  "09f527f35b": note("7.7.2", LEAN.shapes3_9),
  // { let x = true; let x = &mut self.f.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "0a1967fcea": note("7.8.5", LEAN.shapes20_13),
  // pub fn fb_init(&mut self, mut x: bool, …, mut x: i16) -> bool {
  "0ab2575555": note("7.7.1", LEAN.shapes12_8),
  // pub __numbers_lower_N: i32,
  "0ac4ab4a64": note("7.7.8", LEAN.shapes13_17),
  // self.m(&mut (*x));
  "0b51d542e8": note("7.8.6", LEAN.shapes2_5),
  // pub fn m(mut p: usize, x: &mut i16) -> i16 {
  "0ca9dad97d": merged(["7.7.2", LEAN.shapes15_7], ["7.7.7", LEAN.shapes15_8]),
  // (match self.f.f { L => self.f.m(&mut self.f), _ => panic!(S) });
  "0cbdff077d": note("7.8.7", LEAN.shapes19_6),
  // pub fn x<const T: usize>(str: &mut IecString<T>) -> u16 {
  "0d14fd327c": note("7.8.6", LEAN.shapes15_9),
  // self.f.f[L] = (u64::m(self.f.f) % Lu64) as u8;
  "a281b5efbd": note("7.8.4", LEAN.shapes3_1),
  // x: std::array::from_fn(|_| [L; L]),
  "2c3b8ad3cc": merged(["7.8.2", LEAN.shapes11_13], ["7.8.2", LEAN.shapes2_7]),
  // x: { let mut v = T::new(); v.f = L; v.f = L; v.f = IecString::<L>::lit(B); v },
  "2db7e8f332": note("7.8.3", LEAN.shapes3_7),
  // __numbers_lower_N: L,
  "38908b42b7": note("7.7.8", LEAN.shapes13_17),
  // while ((if self.f { -Li16 } else { Li16 }) >= Li16 && self.f <= self.f) || ((if self.f { -Li16 } else { Li16 }) < L
  "098f7b0911": note("keep:niche: accepted loss (2 occurrences in the corpora; the IR has no binding a pass could hold the step in short of a struct field, which is more Rust, not less — 7.5.9)", LEAN.shapes11_8),
  // v: L,
  "667cafe298": note("7.8.8", LEAN.shapes6_2),
  // x: { let mut v = T::new(); v.f = L; v.f = L; v },
  "705d69973b": note("7.8.3", LEAN.shapes2_8),
  // self.f = Li32.wrapping_neg() as i8;
  // x
  "11f6ad8ec5": note("7.7.3", LEAN.shapes1_9),
  // pub fn m(mut x: u16) -> bool {
  "14b2f39d44": note("7.7.3", LEAN.shapes14_14),
  // pub fn init(&mut self, g: &mut Globals) {
  "1524fb865f": note("7.7.5", LEAN.shapes15_6),
  // pub fn m(&mut self, mut p: usize) -> i16 {
  "178b1e9748": note("7.7.11", LEAN.shapes19_9),
  // len = m(&mut str) as i16;
  "185a887a57": note("7.4.6", LEAN.shapes13_15),
  // { let x = self.f; let x = &mut self.f; *x = if x { *x | (Lu32 << L) } else { *x & !(Lu32 << L) }; }
  "1985d03764": note("7.8.5", LEAN.shapes20_13),
  // x = m(__numbers_lower_N, __numbers_upper_N, &mut (*x)).wrapping_add(Li32);
  "1b12aad5a0": note("7.7.8", LEAN.shapes16_15),
  // x = IecString::<L>::lit(B);
  "1b6d6589aa": note("7.7.3", LEAN.shapes18_10),
  // pub fn m(mut x: i16) -> i16 {
  "1ca8b1b1fc": note("7.7.1", LEAN.shapes13_12),
  // pub fn m(mut x: i16) -> u32 {
  "1d10ec0f39": note("7.7.1", LEAN.shapes13_12),
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> u8 {
  "1dec9ffb7e": note("7.8.6", LEAN.shapes16_14),
  // self.f = len(self.f.to::<L>());
  "21ef64a1e0": note("7.4.6", LEAN.shapes14_18),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u16;
  "30c4deeec9": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f.__numbers_upper_N = Li32;
  "22f3bd9b6d": note("7.7.8", LEAN.shapes14_15),
  // self.f = f64::m(self.f).sin() as f32;
  "d47543941e": note("keep:f32::sin differs from the f64 round trip on 2,866,998 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // pub fn m(mut x: u32) -> bool {
  "241f597128": note("7.7.3", LEAN.shapes14_14),
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i16 {
  "26a81a085d": note("7.7.8", LEAN.shapes16_15),
  // self.f = match self.f { L => (*__lent_N).m(), _ => panic!(S) };
  "26bfea40dc": note("7.8.7", LEAN.shapes19_6),
  // x = len((*x).to::<L>());
  "28af8caf65": note("7.8.6", LEAN.shapes18_3),
  // self.f = m(f64::m(self.f)).ln() as f32;
  "7eff84bf36": note("keep:f32::ln differs from the f64 round trip on 210,637 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // x = m(__values_lower_N, __values_upper_N, &mut (*x)).wrapping_add(__values_upper_N);
  "29dc1a9c14": note("7.8.6", LEAN.shapes20_11),
  // pub fn call(&mut self, g: &mut Globals, prg: &mut Programs) {
  "30d5674ec4": note("7.7.5", LEAN.shapes19_8),
  // self.f = Li32.wrapping_neg().max(self.f as i32).min(self.f as i32) as i16;
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "3279d75111": note("7.8.5", LEAN.shapes20_13),
  // self.f.f[L] = (u64::m(self.f.f) / Lu64 % Lu64) as u8;
  "3f8601dd97": note("7.8.4", LEAN.shapes3_1),
  // x: std::array::from_fn(|_| std::array::from_fn(|_| std::array::from_fn(|_| [L; L]))),
  "8643f1db30": note("7.8.2", LEAN.shapes12_1),
  // x: std::array::from_fn(|_| std::array::from_fn(|_| [L; L])),
  "8feb3d596e": note("7.8.2", LEAN.shapes12_1),
  // self.f = self.f.wrapping_add(if self.f { -Li16 } else { Li16 });
  "90ad40cc20": note("keep:niche: accepted loss (2 occurrences in the corpora; the IR has no binding a pass could hold the step in short of a struct field, which is more Rust, not less — 7.5.9)", LEAN.shapes11_8),
  // x: [{ let mut v = T::new(); v.f = L; v }, { let mut v = T::new(); v.f = L; v.f = false; v }, T::new()],
  "9bacb0b14c": note("7.8.3", LEAN.shapes3_7),
  // x: { let mut v = T::new(); v.f = L; v },
  "ccb56fb7d9": merged(["7.8.3", LEAN.shapes7_11], ["7.8.3", LEAN.shapes2_8]),
  // self.f = self.__numbers_lower_N.wrapping_mul(Li32).wrapping_add(self.__numbers_upper_N);
  "33fc10bac3": note("7.7.8", LEAN.shapes16_15),
  // pub fn after_global_init(&mut self, g: &mut Globals) {
  "365326bb03": note("7.7.5", LEAN.shapes15_6),
  // map
  "37745ed7a0": note("7.7.5", LEAN.shapes17_5),
  // self.f = self.__numbers_upper_N.wrapping_sub(self.__numbers_lower_N).wrapping_add(Li32);
  "38cce5cb54": note("7.7.8", LEAN.shapes16_15),
  // self.f = self.f.clone();
  "39e68c53af": note("7.8.2", LEAN.shapes2_9),
  // (match self.f { L => self.f.m_set(Li16), _ => panic!(S) });
  "decdb7e4d6": note("7.8.7", LEAN.shapes20_14),
  // replace
  "3cacc7bfac": note("7.4.6", LEAN.shapes12_11),
  // pub fn m(mut x: IecString<L>, …) -> IecString<L> {
  "3cf4e6fa21": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // x = __grid_lower_N.wrapping_mul(Li32).wrapping_add(__grid_upper_N) as i16;
  "3d792fe7d9": note("7.7.8", LEAN.shapes16_15),
  // if m(x, …, false, &mut (*x), &mut (*x)) {
  "3d7b4a7836": note("7.8.6", LEAN.shapes15_9),
  // x = { m(x); x };
  "d33f37473e": note("7.7.7", LEAN.shapes12_9),
  // x = Li32.wrapping_neg() as i16;
  // self.f.__numbers_lower_N = self.__numbers_lower_N;
  "43449862b7": note("7.7.8", LEAN.shapes15_13),
  // pub fn x<const T: usize>(mut p: usize, x: &mut IecString<T>) -> u8 {
  "43aad8296c": note("7.8.6", LEAN.shapes16_14),
  // self.p = L;
  "45292dbd9c": note("7.8.8", LEAN.shapes1_8),
  // self.f = { let __arg_N = m(self.f.to::<L>(), IecString::<L>::lit(B)); len(__arg_N) };
  "47a7c12d8a": note("7.6.6", LEAN.shapes20_8),
  // pub fn fb_init(&mut self, mut x: bool, …) -> bool {
  "49346d6299": note("7.7.1", LEAN.shapes2_11),
  // g: false,
  "496b8acb56": note("7.6.6", LEAN.shapes8_11),
  // if len(self.f.f[self.f as usize].to::<L>()) > self.f {
  "8b4fc46c1e": note("7.4.6", LEAN.shapes16_11),
  // x = (*x).wrapping_mul(Li16);
  "b20c53fed8": note("7.8.6", LEAN.shapes15_9),
  // self.f = match self.f { L => (*__lent_N).take(Li16), _ => panic!(S) };
  "4b5007906a": note("7.8.7", LEAN.shapes20_14),
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> i32 {
  "4c796f6678": note("7.8.6", LEAN.shapes16_14),
  // __numbers_upper_N: L,
  "e1ed54aa44": note("7.7.8", LEAN.shapes13_17),
  // { let mut x = std::mem::take(&mut prg.f); x.m(prg); prg.f = x; };
  "4da7af6f6b": note("7.7.6", LEAN.shapes9_8),
  // let mut take: i16 = Li16;
  "51ea066d8e": note("7.7.3", LEAN.shapes18_10),
  // self.f = (*x).m();
  "52d85b7cdc": note("7.8.6", LEAN.shapes12_5),
  // x = Li16;
  "5370b79269": note("7.7.3", LEAN.shapes12_10),
  // pub fn m(mut __values_lower_N: i32, mut __values_upper_N: i32, x: &mut [u8]) -> i64 {
  "56c1a77525": note("7.7.8", LEAN.shapes16_15),
  // pub ops: [u64; L],
  "572db4e711": note("7.8.2", LEAN.shapes17_8),
  // self.f.call(prg);
  "58a7e6289b": note("7.7.6", LEAN.shapes17_5),
  // x = __numbers_lower_N;
  "58edc15c64": note("7.7.8", LEAN.shapes13_17),
  // self.f = match self.f { L => self.f.m(), _ => panic!(S) };
  "59c341cb0f": note("7.8.7", LEAN.shapes19_6),
  // let mut fb_init: i16 = Li16;
  "5e9caa6605": note("7.7.3", LEAN.shapes18_10),
  // (match self.f.f { L => self.f.m(&mut self.f), L => self.f.m(&mut self.f), _ => panic!(S) });
  "5ed54bb657": note("7.8.7", LEAN.shapes20_14),
  // { let __arg_N = true; let __arg_N = false; let __arg_N = prg.f.f; { let mut x = std::mem::take(&mut prg.f); let x 
  "60d6b79cca": merged(["7.6.6", LEAN.shapes20_8], ["7.8.10", LEAN.shapes20_9]),
  // x = __numbers_upper_N;
  "62caf55aa5": note("7.7.8", LEAN.shapes13_17),
  // pub fn m(mut x: f32) -> f32 {
  "63e6752512": note("7.7.1", LEAN.shapes13_12),
  // replace = { let __arg_N = m(x, …, p); let __arg_N = x; let __arg_N = i32::m(p).wrapping_sub(Li32).max(Li32) as i16;
  "7dc2652e1b": note("7.6.6", LEAN.shapes17_4),
  // pub fn m(&mut self, prg: &mut Programs, mut x: i16) -> i16 {
  "69b0552c65": note("7.7.5", LEAN.shapes19_8),
  // self.f = len(self.f.f[self.f as usize].to::<L>());
  "6f799d0ac4": note("7.7.2", LEAN.shapes15_14),
  // pub fn __init(&mut self, g: &mut Globals) {
  "6cec059f2e": note("7.7.5", LEAN.shapes15_6),
  // pub fn m(&mut self, mut x: i16) -> i16 {
  "6dd22a92d0": note("7.7.3", LEAN.shapes14_14),
  // pub fn m(mut x: u8) -> bool {
  "6e16e4ee84": note("7.7.1", LEAN.shapes13_12),
  // pub fn m(mut x: i32, x: &mut bool) -> i32 {
  "72543de594": note("7.7.9", LEAN.shapes19_2),
  // p: L,
  "75cc82a569": note("7.8.8", LEAN.shapes1_8),
  // x = m(x, &mut (*x)).wrapping_sub(Li32);
  "77378f7efe": note("7.8.6", LEAN.shapes14_9),
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i32 {
  "775c30eac7": note("7.7.8", LEAN.shapes16_15),
  // x = (*x).wrapping_add(*x);
  "a4fbe9aee7": note("7.8.6", LEAN.shapes15_9),
  // x = i32::m(m(&mut str));
  "50ff398988": note("7.4.6", LEAN.shapes13_15),
  // pub fn m(mut x: i16, x: &mut i16) -> i16 {
  "7ab9128afd": note("7.7.1", LEAN.shapes18_9),
  // pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {
  "7c7cff3d31": note("7.7.5", LEAN.shapes19_8),
  // self.f = Li32.wrapping_neg() as u8;
  // x = m(x, &mut (*x));
  "7e45a342fc": note("7.8.6", LEAN.shapes13_9),
  // self.f.call(&mut (*x));
  "8064ae1570": note("7.8.6", LEAN.shapes13_9),
  // x = Li32;
  "8088e0ab18": note("7.7.3", LEAN.shapes12_10),
  // pub fn x<const T: usize>(x: &IecString<T>) -> bool {
  "81253ce291": note("7.7.2", LEAN.shapes15_14),
  // pub fn call(&mut self, x: &mut [i16]) {
  "81ed699293": note("7.7.8", LEAN.shapes14_15),
  // self.f = match self.f { L => (*__lent_N).m(), L => (*__lent_N).m(), _ => panic!(S) };
  "82e802ebc9": note("7.8.7", LEAN.shapes20_14),
  // pub fn m(mut str: IecString<L>, mut x: i16) -> IecString<L> {
  "83ed1aab47": merged(["7.4.6", LEAN.shapes16_11], ["7.6.6", LEAN.shapes16_16]),
  // pub fn m(mut x: f64) -> f64 {
  "84ac703739": note("7.7.1", LEAN.shapes13_12),
  // prg.f.f.f = Li16;
  "85168be6a7": note("7.7.5", LEAN.shapes17_5),
  // self.f = m(f64::m(self.f)) as u32;
  "e0361c9257": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu8 << L) } else { *x & !(Lu8 << L) }; }
  "87cd3925f5": note("7.8.5", LEAN.shapes20_13),
  // self.f = len(self.narrow.to::<L>());
  "8986d5305c": note("7.4.6", LEAN.shapes14_18),
  // let mut fb_init: bool = false;
  "8a9bb48ddb": note("7.7.1", LEAN.shapes2_11),
  // self.f.narrow();
  "8cca954ad7": note("7.7.2", LEAN.shapes3_9),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i16;
  "756ba59393": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // pub fn sum(&mut self, mut x: [i16; L]) {
  "9034f2a4d6": note("7.7.1", LEAN.shapes18_9),
  // self.f = m(f64::m(self.f)) as u16;
  "9479f0e3c4": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // *x = Li16;
  "96a5b25b66": note("7.7.3", LEAN.shapes1_9),
  // self.f = match self.f { L => self.f.m(Li16), _ => panic!(S) };
  "96bf43c1e7": note("7.8.7", LEAN.shapes19_6),
  // pub fn m(mut x: i16) -> T {
  "96f5f06912": note("7.7.1", LEAN.shapes13_12),
  // (match self.f { L => self.f.m(), L => self.f.m(), _ => panic!(S) });
  "9831f2d691": note("7.8.7", LEAN.shapes20_14),
  // while (*str).char_at(i64::m(x)) != Lu8 {
  "e5f32531ef": note("7.8.6", LEAN.shapes15_9),
  // if m(x, …, true, &mut (*x), &mut (*x)) {
  "9a63db2a45": note("7.8.6", LEAN.shapes14_9),
  // pub fn m(mut str: IecString<L>, mut len: i16, mut x: i16) -> IecString<L> {
  "9c8d21e237": note("7.4.6", LEAN.shapes16_11),
  // (match self.f.f { L => self.f.m(&mut self.v), _ => panic!(S) });
  "9fbd098efb": note("7.8.7", LEAN.shapes3_12),
  // pub fn m(&mut self, mut x: i16) {
  "a01f00db76": note("7.7.1", LEAN.shapes18_9),
  // self.narrow.m(&self.f.narrow::<L>());
  "a1c2206655": note("7.4.6", LEAN.shapes16_11),
  // x.m(&{ let __arg_N = m(x.f.to::<L>(), IecString::<L>::lit(B)); let __arg_N = x.f.to::<L>(); m(__arg_N, …) });
  "a31de5f5e1": note("7.6.6", LEAN.shapes17_4),
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.map(prg); prg.f = x; x };
  "a3a49d3776": note("7.8.10", LEAN.shapes20_9),
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.m_get(prg); prg.f = x; x };
  "a41f58717b": note("7.8.10", LEAN.shapes20_9),
  // len
  "a573b540d2": merged(["7.7.3", LEAN.shapes12_10], ["7.4.6", LEAN.shapes12_11]),
  // pub fn m(mut x: i16, …) -> i16 {
  "a5c4faeebd": note("7.7.3", LEAN.shapes14_14),
  // ops: std::array::from_fn(|_| L),
  "a65506e4d8": note("7.8.2", LEAN.shapes18_8),
  // x: { let mut v = T::new(); v.f = IecString::<L>::lit(B); v.f = IecString::<L>::lit(B); v },
  "a7ca9e8349": note("7.8.3", LEAN.shapes16_13),
  // pub fn m(&mut self, prg: &mut Programs) {
  "ab696e2449": note("7.7.5", LEAN.shapes7_8),
  // pub fn m(mut x: u16) -> u16 {
  "abc8bc67de": note("7.7.1", LEAN.shapes13_12),
  // { let mut x = std::mem::take(&mut prg.f); x.call(prg); prg.f = x; }
  "abf2bb6e4e": note("7.7.6", LEAN.shapes3_6),
  // self.f.f = self.f.clone();
  "ac452bc801": note("7.8.1", LEAN.shapes13_11),
  // self.f = L;
  "ad25627749": note("7.8.8", LEAN.shapes1_8),
  // { let mut x = std::mem::take(&mut prg.f); x.call(g, prg); prg.f = x; }
  "ae38098da5": note("7.8.10", LEAN.shapes20_9),
  // self.f = m(self.f).log10() as f32;
  "b07338e4d9": note("keep:f32::log10 differs from the f64 round trip on 2,418,508 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // x = __grid_lower_N;
  "b3a0495ed2": note("7.7.8", LEAN.shapes13_17),
  // self.f = T::new();
  "b3e78a179a": note("7.6.4", LEAN.shapes11_12),
  // self.f = f64::m(self.f).cos() as f32;
  "1671a3249d": note("keep:f32::cos differs from the f64 round trip on 2,876,136 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // x = { let __arg_N = m(x); m(__arg_N) };
  "b58894b5df": note("7.6.6", LEAN.shapes14_12),
  // pub fn m(mut x: IecString<L>, …, mut x: i16) -> IecString<L> {
  "b592939dbf": note("7.4.6", LEAN.shapes16_11),
  // { let mut __copy_N = self.f.clone(); self.m(Li16, Li32, …, &mut __copy_N); self.f = __copy_N; };
  "b6565109d7": note("7.8.10", LEAN.shapes20_9),
  // self.f = m(x, &mut (*__lent_N));
  "b75c863ba4": note("7.8.6", LEAN.shapes18_3),
  // pub fn m(mut x: u8) -> u8 {
  "b7cc1b2b1d": note("7.7.1", LEAN.shapes13_12),
  // pub __numbers_upper_N: i32,
  "b894525f6e": note("7.7.8", LEAN.shapes13_17),
  // pub fn map(&mut self, prg: &mut Programs) -> i16 {
  "b959cb02cf": note("7.7.5", LEAN.shapes19_8),
  // pub fn call(&mut self, g: &mut Globals) {
  "b9787e0d18": note("7.7.5", LEAN.shapes15_6),
  // pub fn m(&mut self, mut x: i16, …, x: &mut i16, …) -> i16 {
  "bb4c155c09": note("7.7.2", LEAN.shapes15_7),
  // pub fn init(&mut self, prg: &mut Programs) {
  "bea3694884": note("7.7.5", LEAN.shapes7_8),
  // pub fn replace(mut x: IecString<L>, …, mut x: i16, mut p: i16) -> IecString<L> {
  "c001fbb3b1": note("7.4.6", LEAN.shapes16_11),
  // pub fn m(&mut self, mut p: usize, x: &mut i16) -> i16 {
  "c0092c8e9b": note("7.7.11", LEAN.shapes19_9),
  // x.f = x.f;
  "c5d30c56ec": note("7.8.4", LEAN.shapes17_10),
  // match x {
  "c6322760e4": note("7.8.4", LEAN.shapes17_10),
  // self.f = { let __arg_N = Li16; { let mut x = std::mem::take(&mut prg.f); let x = x.m(prg, __arg_N); prg.f = x; x }
  "c68f0b1ef6": merged(["7.6.6", LEAN.shapes20_8], ["7.8.10", LEAN.shapes20_9]),
  // self.f = [Li16; L];
  "c8927952f2": note("7.6.4", LEAN.shapes11_12),
  // pub fn m(&mut self, mut x: i16, …) -> i16 {
  "c8ca44a755": note("7.7.2", LEAN.shapes15_7),
  // x: std::array::from_fn(|_| T::new()),
  "c9c77500c6": merged(["7.8.2", LEAN.shapes2_7], ["7.8.2", LEAN.shapes2_9]),
  // self.f.call(&mut (*__lent_N));
  "ca81b2092d": note("7.8.6", LEAN.shapes18_3),
  // m(x.f);
  "ca823a2c56": note("7.8.4", LEAN.shapes17_10),
  // x = i32::m(m(&mut x));
  "fcd4689307": note("7.4.6", LEAN.shapes13_15),
  // pub fn m(mut x: i32, x: &mut T) -> bool {
  "cc3063b338": note("7.7.2", LEAN.shapes15_7),
  // x = __numbers_lower_N.wrapping_mul(Li32).wrapping_add(__numbers_upper_N);
  "cc9778f81f": note("7.7.8", LEAN.shapes16_15),
  // pub fn m_get(&mut self, prg: &mut Programs) -> i16 {
  "ceb0cb99a7": note("7.7.5", LEAN.shapes19_8),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u8;
  "62891f3570": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // pub fn m(&mut self, mut x: i16) -> bool {
  "d00d314ec2": note("7.7.1", LEAN.shapes18_9),
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T
  "d231c1a7e5": note("7.7.1", LEAN.shapes17_11),
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: usize, mut x: i16, …, x: &mut IecString<T>, …) {
  "db57faba5d": note("7.7.1", LEAN.shapes17_11),
  // pub fn len(mut str: IecString<L>) -> i16 {
  "dbcd1088a5": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // self.f = match self.f { L => self.f.m_get(), _ => panic!(S) };
  "dc1e3df820": note("7.8.7", LEAN.shapes19_6),
  // pub fn m(&mut self) -> IecString<L> {
  "dc8437c26a": note("7.7.3", LEAN.shapes18_10),
  // pub fn m(mut x: i32, x: &mut f64) -> i32 {
  "dd28a02e7e": note("7.7.9", LEAN.shapes19_2),
  // self.f = len(self.v.to::<L>());
  "dea089f2fd": note("7.4.6", LEAN.shapes14_18),
  // self.f.__numbers_upper_N = self.__numbers_upper_N;
  "debabdec0d": note("7.7.8", LEAN.shapes15_13),
  // pub fn m(&mut self, x: &mut i16) -> i16 {
  "dfc9d07c2c": note("7.7.2", LEAN.shapes15_7),
  // self.f.clamp();
  "e007ef42d8": note("7.7.2", LEAN.shapes3_9),
  // x = i64::m(__values_upper_N.wrapping_mul(Li32));
  "38ec88da3b": note("7.7.8", LEAN.shapes15_13),
  // self.f = m(f64::m(self.f)) as i16;
  "0a552281ae": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // { let mut x = std::mem::take(&mut prg.f); x.f.call(prg); prg.f = x; }
  "e436b886c1": note("7.8.10", LEAN.shapes20_9),
  // x = L;
  "e496034f7b": note("7.7.7", LEAN.shapes12_9),
  // { let x = false; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "e76a0c7276": note("7.8.5", LEAN.shapes20_13),
  // x = (*x).m().wrapping_add(x.f);
  "20ee5837a5": note("7.8.6", LEAN.shapes15_9),
  // self.units = len(self.narrow.to::<L>());
  "e8162bb9aa": note("7.4.6", LEAN.shapes14_18),
  // pub fn fb_init(&mut self, mut x: bool) -> bool {
  "e82fbd8112": note("7.7.1", LEAN.shapes2_11),
  // self.copied = self.copied;
  "ea53989ac8": note("keep:`x := x` stays ALLOWED self_assignment (7.8.9 moves this text into that reason); removed by 7.11.1", LEAN.shapes11_20),
  // *x = (i32::m(x) / i32::m(x)) as i16;
  "d96bb286f4": note("keep:the promoted division is the measured rule (MIN / -1 wraps in SINT/INT, computed in DINT); a narrow wrapping_div gives the same values but needs a narrow node that does not trap where the promoted one does not, and the interpreter has none (7.3.11)", LEAN.shapes14_5),
  // pub fn m_set(&mut self, prg: &mut Programs, mut x: i16) {
  "ed425c8710": note("7.7.5", LEAN.shapes19_8),
  // while x <= __grid_upper_N {
  "596535f8e7": note("7.7.8", LEAN.shapes14_15),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i8;
  "e19d1f70e4": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // m(L, &mut self.f);
  "ef4db7eb51": note("7.7.7", LEAN.shapes12_9),
  // (*x).call();
  "f0065dbd0b": note("7.8.6", LEAN.shapes12_5),
  // self.f.__numbers_lower_N = Li32;
  "f06209ef9e": note("7.7.8", LEAN.shapes14_15),
  // pub fn m(&mut self, mut x: i16, …) {
  "f327cfe40a": note("7.7.1", LEAN.shapes18_9),
  // pub x: [u64; L],
  "f4a4eb1ade": note("7.8.2", LEAN.shapes17_8),
  // pub fn m(mut x: IecString<L>, …) -> i16 {
  "f5ca982c14": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // pub fn m(&mut self, g: &mut Globals) -> i16 {
  "f62e4d99a5": note("7.7.5", LEAN.shapes15_6),
  // pub fn m(mut x: i8) -> bool {
  "f75c7acc4a": note("7.7.1", LEAN.shapes13_12),
  // pub fn m(x: &mut T, mut x: i32, mut x: i16, mut x: usize) -> bool {
  "f7ee3854dd": note("7.7.9", LEAN.shapes19_2),
  // self.f = m(-Li32, …, &mut self.f);
  "f7faf582da": note("7.7.8", LEAN.shapes14_15),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Li16 << L) } else { *x & !(Li16 << L) }; }
  "f85632e185": note("7.8.5", LEAN.shapes20_13),
  // pub fn init(&mut self) {
  "fa7d5f176f": note("7.7.2", LEAN.shapes2_12),
  // let mut map: i16 = Li16;
  "faf5605030": note("7.7.3", LEAN.shapes18_10),
  // self.m();
  "fb7e9e6ff4": note("keep:the call itself is correct and lean (its allow-attribute waste is 7.7.2's); removed by 7.7.10", LEAN.shapes8_10),
  // x: L,
  "fbde4d6e1e": merged(["7.8.8", LEAN.shapes1_8], ["7.8.11", LEAN.shapes6_4]),
  // while self.f <= self.__numbers_upper_N {
  "9928be1401": note("7.7.8", LEAN.shapes15_13),
  // pub fn m_set(&mut self, mut x: i16) {
  "fda03fa84f": note("7.7.3", LEAN.shapes14_14),
  // pub fn x<const T: usize>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T>) 
  "fdb004dd33": note("7.7.1", LEAN.shapes17_11),
  // self.f = m(Li32, …, &mut self.f);
  "fedbbc431c": note("7.7.8", LEAN.shapes14_15),
  // self.f = m(Li32.wrapping_neg() as i16);
}
