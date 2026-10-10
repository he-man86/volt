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
  // self.f = Lu8;
  // self.sum = (self.sum as i32).wrapping_add(self.f as i32) as i16;
  "0153115496": note("7.3.1", LEAN.shapes11_15),
  // self.v = m(self.f * Lf64, …);
  "015dcb3b7f": note("7.2.6", LEAN.shapes5_4),
  // self.v = (-Li64).wrapping_neg();
  // pub fn fb_init(&mut self, prg: &mut Programs, mut x: bool, …) -> bool {
  "0180f72495": note("7.7.1", LEAN.shapes9_9),
  // m(Li32, &mut (*x));
  "01e84968c3": note("7.8.6", LEAN.shapes12_5),
  // x = *x;
  "01ef1b756d": note("7.9.3", LEAN.shapes12_9),
  // if x.is_nan() { return L; }
  "02a72c2e83": note("7.9.1", LEAN.shapes5_1),
  // pub fn m(mut x: u8, …) -> bool {
  "03846c1eae": note("7.7.3", LEAN.shapes14_14),
  // self.f.f[(Li8 as i64) as usize] = Lu8;
  "03b3e8b80c": note("7.2.3", LEAN.shapes11_7),
  // pub fn m(mut x: i32, x: &mut i16) -> i32 {
  "040107266f": note("7.7.9", LEAN.shapes19_2),
  // x: [Lu8; L],
  "054b93382f": note("7.2.6", LEAN.shapes1_7),
  // x: [{ let mut v = T::new(); v.f = Li16; v }, { let mut v = T::new(); v.f = Li16; v.f = false; v }, T::new()],
  "055df7e5f8": note("7.8.3", LEAN.shapes3_7),
  // x: [Lf32, …, (-Lf32)],
  "060ccf97cc": note("7.2.9", LEAN.shapes11_19),
  // self.f = (self.f as i32) <= (self.f as i32);
  "06135af232": note("7.3.3", LEAN.shapes7_2),
  // x: Li32,
  "06bb3a6005": merged(["7.2.8", LEAN.shapes4_1], ["7.2.11", LEAN.shapes4_2]),
  // self.f[((self.f as i64) - Li64) as usize].f = (self.f as i32).wrapping_mul(Li32) as i16;
  "07d4272a6e": note("7.2.14", LEAN.shapes16_7),
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as u16;
  "07ee06657f": note("7.3.1", LEAN.shapes9_3),
  // self.f = (self.f as i32).max(self.f as i32) as u8;
  "0817bbbc15": note("7.3.1", LEAN.shapes8_3),
  // pub fn m(mut x: i32, x: &mut T) -> i32 {
  "0855e1134c": note("7.7.1", LEAN.shapes18_9),
  // pub __inout_index_N: i16,
  "0878222ac3": note("7.6.3", LEAN.shapes18_1),
  // self.f = (self.f as f64).exp() as f32;
  "08964781e8": note("7.3.12", LEAN.shapes6_10),
  // self.f = { let x = self.v; let x = Lu64; if x == L { L } else { x % x } };
  "16bbccaf85": note("7.2.6", LEAN.shapes9_4),
  // self.v = Lu32;
  "093ad5cc7a": note("7.2.11", LEAN.shapes1_10),
  // return x;
  "0969e59592": note("7.7.3", LEAN.shapes12_10),
  // self.f = self.__numbers_lower_N;
  "09b1152bef": note("7.5.7", LEAN.shapes14_15),
  // self.f = self.f.rotate_right(Li8 as u32);
  "09eeda28bb": note("7.2.2", LEAN.shapes7_1),
  // self.f.widen();
  "09f527f35b": note("7.7.2", LEAN.shapes3_9),
  // { let x = true; let x = &mut self.f.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "0a1967fcea": note("7.8.5", LEAN.shapes20_13),
  // fn m(v: f64) -> i32 {
  "0ab1e9c511": note("7.9.1", LEAN.shapes4_4),
  // pub fn fb_init(&mut self, mut x: bool, …, mut x: i16) -> bool {
  "0ab2575555": note("7.7.1", LEAN.shapes12_8),
  // pub __numbers_lower_N: i32,
  "0ac4ab4a64": note("7.7.8", LEAN.shapes13_17),
  // __inout_index_N: Li16,
  "0b358286cb": note("7.6.3", LEAN.shapes18_1),
  // self.m(&mut (*x));
  "0b51d542e8": note("7.8.6", LEAN.shapes2_5),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_add(x) as i64), { m(x); *x }.c
  "0bb816a185": note("7.4.3", LEAN.shapes17_2),
  // pub fn m(mut p: usize, x: &mut i16) -> i16 {
  "0ca9dad97d": merged(["7.7.2", LEAN.shapes15_7], ["7.7.7", LEAN.shapes15_8]),
  // (match self.f.f { L => self.f.m(&mut self.f), _ => panic!(S) });
  "0cbdff077d": note("7.8.7", LEAN.shapes19_6),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), Lu8));
  "0cea56d7e0": merged(["7.4.4", LEAN.shapes16_2], ["7.4.3", LEAN.shapes16_3], ["7.2.4", LEAN.shapes16_10]),
  // pub fn x<const T: usize>(str: &mut IecString<T>) -> u16 {
  "0d14fd327c": note("7.8.6", LEAN.shapes15_9),
  // self.f = Li16;
  "0e0d715a81": note("7.5.11", LEAN.shapes1_11),
  // self.f = (self.f as i32).wrapping_sub(Li32) as u8;
  "0e5c6a2896": note("7.3.1", LEAN.shapes8_3),
  // self.f = Li64.wrapping_add(Li64);
  "0e60621ff1": note("7.2.2", LEAN.shapes6_6),
  // self.v = Li32.wrapping_neg() as i16;
  // self.f.f = ({ let x = self.f.f as u64; let x = Lu64; if x == L { L } else { x % x } }).wrapping_add(({ let x = self
  "8b00400a34": note("7.2.6", LEAN.shapes12_4),
  // self.f = Li32.wrapping_neg() as i8;
  // x
  "11f6ad8ec5": note("7.7.3", LEAN.shapes1_9),
  // self.f = ((self.f as i32) > Li32) & (((self.f as i32) < Li32) | self.f);
  "128ab89e82": note("7.5.6", LEAN.shapes9_12),
  // self.f = if self.g { self.f } else { self.f };
  "12a2ae661a": note("7.2.7", LEAN.shapes9_5),
  // x: (-Li64),
  "12e93440b3": note("7.2.9", LEAN.shapes1_1),
  // pub x: i16,
  "1307e33bbf": merged(["keep:the field line is already minimal and correct (probed edge inputs agree); removed by 7.2.13", LEAN.shapes11_5], ["7.3.5", LEAN.shapes11_6]),
  // pub __inout_guard_N: usize,
  "149af70520": note("7.6.3", LEAN.shapes18_1),
  // self.f[(Li8 as i64) as usize] = L;
  "14a38342eb": note("7.2.10", LEAN.shapes18_4),
  // pub fn m(mut x: u16) -> bool {
  "14b2f39d44": note("7.7.3", LEAN.shapes14_14),
  // self.f = (if self.f { g.f as i32 } else { g.f as i32 }) as i16;
  "14e2fedf17": note("7.3.1", LEAN.shapes20_3),
  // pub fn init(&mut self, g: &mut Globals) {
  "1524fb865f": note("7.7.5", LEAN.shapes15_6),
  // if ((self.f as i32) > Li32) & self.f {
  "1541330f1e": note("7.3.3", LEAN.shapes11_16),
  // x: (-Lf32),
  "159ca60812": note("7.2.9", LEAN.shapes1_1),
  // x = x.with_char(x.wrapping_sub(x) as i64, str.char_at(x as i64));
  "163ffc50fa": note("7.4.3", LEAN.shapes16_3),
  // __inout_guard_N: L,
  "16410bb3a0": note("7.6.3", LEAN.shapes18_1),
  // self.f = (self.f as f64).sqrt() as f32;
  "1671e97e30": note("7.3.5", LEAN.shapes7_4),
  // self.f = { self.__inout_index_N = self.f[(self.f as i64) as usize]; let __arg_N = self.m(); m(__arg_N, &mut self.f
  "16b713f0f3": note("7.6.1", LEAN.shapes20_10),
  // x: Lf64,
  "1707972c33": merged(["7.2.8", LEAN.shapes4_1], ["7.2.12", LEAN.shapes4_3]),
  // pub fn m(&mut self, mut p: usize) -> i16 {
  "178b1e9748": note("7.7.11", LEAN.shapes19_9),
  // self.f = (self.f as i32).wrapping_shl(Li8 as u32) as u16;
  "17bfcf56b6": note("7.2.5", LEAN.shapes8_5),
  // self.f = (self.f as f64).tan() as f32;
  "18157407c3": note("7.3.5", LEAN.shapes7_4),
  // self.f = self.f.rotate_left(self.f as u32);
  "181d22eae0": note("7.3.5", LEAN.shapes7_4),
  // len = m(&mut str) as i16;
  "185a887a57": note("7.4.6", LEAN.shapes13_15),
  // self.f = (self.f as i32).wrapping_add(Li32) as i8;
  "18e6b05962": note("7.3.1", LEAN.shapes8_3),
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = true;
  "191ba38aad": note("7.2.3", LEAN.shapes11_7),
  // { let x = self.f; let x = &mut self.f; *x = if x { *x | (Lu32 << L) } else { *x & !(Lu32 << L) }; }
  "1985d03764": note("7.8.5", LEAN.shapes20_13),
  // if !((x < Li32) & ((x.char_at(x as i64) as i32) != Li32)) { break; }
  "19dfd3f883": note("7.4.4", LEAN.shapes16_5),
  // break 'loop_N;
  "1ad1ab3163": note("7.5.2", LEAN.shapes11_9),
  // x = m(__numbers_lower_N, __numbers_upper_N, &mut (*x)).wrapping_add(Li32);
  "1b12aad5a0": note("7.7.8", LEAN.shapes16_15),
  // x = IecString::<L>::lit(B);
  "1b6d6589aa": note("7.7.3", LEAN.shapes18_10),
  // self.f = { let mut __copy_N = Li16; let mut __copy_N = Li16; let x = self.f.take(Li16, &mut __copy_N, …); self.f = __copy_N; self.f = __copy_N; x };
  // (re-keyed from `self.f = self.f.take(Li16, &mut self.f, …);` — a routine's outputs are copied out after the call, transpile-review 20)
  "1bb6d1cb14": note("7.2.6", LEAN.shapes19_11),
  // x[(self.__numbers_upper_N as i64).wrapping_sub(self.__numbers_lower_N as i64) as usize] = Li16;
  "1be212b44b": note("7.2.14", LEAN.shapes16_7),
  // pub fn m(mut x: i16) -> i16 {
  "1ca8b1b1fc": note("7.7.1", LEAN.shapes13_12),
  // pub fn m(mut x: i16) -> u32 {
  "1d10ec0f39": note("7.7.1", LEAN.shapes13_12),
  // if x > x.wrapping_sub(Li32) { break; }
  "1d1551a034": note("7.5.7", LEAN.shapes14_7),
  // pub x: u16,
  "1d7709a031": merged(["keep:the field declaration is already lean and correct (569 members, 0 disagreements); removed by 7.2.13", LEAN.shapes13_1], ["7.2.5", LEAN.shapes13_2], ["7.3.1", LEAN.shapes13_3]),
  // x: [IecString::<L>::lit(B); L],
  "1d9f55ded0": note("7.4.8", LEAN.shapes14_16),
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> u8 {
  "1dec9ffb7e": note("7.8.6", LEAN.shapes16_14),
  // x[(self.f as i64).wrapping_sub(self.__numbers_lower_N as i64) as usize] = self.f.wrapping_add(self.f.wrapping_mul(
  "1e5d67a16e": merged(["7.2.3", LEAN.shapes17_3], ["7.3.1", LEAN.shapes17_7]),
  // x = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "1ebe9a3a67": note("7.3.1", LEAN.shapes19_10),
  // x: std::array::from_fn(|_| std::array::from_fn(|_| std::array::from_fn(|_| [Li16; L]))),
  "1f2f8205f9": note("7.8.2", LEAN.shapes12_1),
  // x = Li32.wrapping_neg();
  // break 'body_N;
  "204a887600": note("7.5.2", LEAN.shapes11_9),
  // if (self.f as i32) > Li32 {
  "21575de23f": note("7.3.3", LEAN.shapes11_16),
  // self.f = Li64.max(-Li64).min(Li64) as i16;
  "21672c09ea": note("7.2.7", LEAN.shapes8_6),
  // self.f = len(self.f.to::<L>());
  "21ef64a1e0": note("7.4.6", LEAN.shapes14_18),
  // x = (self.f as i32).wrapping_mul(Li32) as i16;
  "228035615e": note("7.3.1", LEAN.shapes19_10),
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x % x } }) as u16;
  "432e930bcd": note("7.3.13", LEAN.shapes10_3),
  // self.f.__numbers_upper_N = Li32;
  "22f3bd9b6d": note("7.5.7", LEAN.shapes14_15),
  // if false { break; }
  "235daf8f29": note("7.5.8", LEAN.shapes11_10),
  // self.f = self.f.f == IecWString::<L>::lit(&[Lu16, …]);
  "23d12708e2": note("7.4.8", LEAN.shapes15_12),
  // self.f = (self.f as f64).sin() as f32;
  "23d755d76c": note("7.3.12", LEAN.shapes6_10),
  // pub fn m(mut x: u32) -> bool {
  "241f597128": note("7.7.3", LEAN.shapes14_14),
  // self.units = { let mut __copy_N = Li16; let mut __copy_N = Li16; let x = m(Li16, &mut __copy_N, …); self.f = __copy_N; self.f = __copy_N; x };
  // (re-keyed from `self.units = m(Li16, &mut self.f, …);` — a routine's outputs are copied out after the call, transpile-review 20)
  "2421f6476e": note("7.6.3", LEAN.shapes18_1),
  // self.f = Li64.wrapping_add(Li64) as i32;
  "24588decbd": note("7.2.2", LEAN.shapes7_1),
  // self.f.f[(Li8 as i64) as usize].m(&IecString::<L>::lit(B));
  "250357816b": note("7.2.14", LEAN.shapes16_7),
  // self.f = self.f.char_at(Li8 as i64);
  "2506fd8442": note("7.2.3", LEAN.shapes14_2),
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as u8;
  "253e416b11": note("7.2.5", LEAN.shapes8_5),
  // self.f = m(L, …, &mut self.f, …);
  "256218c83c": note("7.4.5", LEAN.shapes14_8),
  // self.f = (x as i32).wrapping_mul(x as i32) as i16;
  "260b606dc8": note("7.3.1", LEAN.shapes19_10),
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i16 {
  "26a81a085d": note("7.7.8", LEAN.shapes16_15),
  // self.f = ((self.f as f64).sqrt() as f32) == ((self.f as f64).sqrt() as f32);
  "26afed6c0b": note("7.3.6", LEAN.shapes9_11),
  // self.f = match self.f { L => (*__lent_N).m(), _ => panic!(S) };
  "26bfea40dc": note("7.8.7", LEAN.shapes19_6),
  // if (self.f as i32) == Li32 {
  "271163608b": note("7.3.3", LEAN.shapes5_6),
  // self.f = ((self.f as i32) & (self.f as i32)) as i16;
  "28a9242939": note("7.3.1", LEAN.shapes8_3),
  // x = len((*x).to::<L>());
  "28af8caf65": note("7.8.6", LEAN.shapes18_3),
  // self.f = m(self.f as f64).ln() as f32;
  "28c9b9742d": note("7.3.12", LEAN.shapes6_10),
  // self.f = (((self.f as i32) == Li32) | ((self.f as i32) == Li32)) | ((self.f as i32) == Li32);
  "28ee7b5d58": note("7.4.4", LEAN.shapes16_5),
  // self.f = m(((self.f as f64).sqrt() as f32) as f64);
  "2929468557": note("7.3.6", LEAN.shapes8_8),
  // self.f = (self.f as i32).wrapping_mul(Li32).wrapping_add(Li32) as i16;
  "293906cee0": note("7.3.1", LEAN.shapes20_1),
  // x = m(__values_lower_N, __values_upper_N, &mut (*x)).wrapping_add(__values_upper_N);
  "29dc1a9c14": note("7.8.6", LEAN.shapes20_11),
  // x = (x as i32).wrapping_sub(Li32) as u16;
  "2a09a0d33c": note("7.3.1", LEAN.shapes15_4),
  // self.f.m(&IecString::<L>::lit(iec_dt_text(self.f as i64).as_bytes()));
  "2a5436bd78": note("7.4.2", LEAN.shapes9_2),
  // pub fn x<const T: usize>(x: &IecString<T>) -> i16 {
  "2b67f9045b": note("7.6.5", LEAN.shapes19_7),
  // self.__property_N = self.f;
  "2b6ceac96d": merged(["7.6.3", LEAN.shapes18_1], ["7.6.2", LEAN.shapes18_2]),
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as u16;
  "2c27c13c32": note("7.2.5", LEAN.shapes8_5),
  // self.f = (self.f as i32) <= Li32;
  "2cfa532f63": note("7.3.3", LEAN.shapes6_7),
  // self.f = (if self.g { Li64 } else { Li64 }) as i16;
  "2db51dfb96": note("7.2.7", LEAN.shapes10_4),
  // x = (*x) == IecString::<L>::lit(B);
  "2e20d3f400": note("7.4.9", LEAN.shapes14_17),
  // x = x.with_char(x.wrapping_add(x) as i64, Lu8);
  "2e591ac56e": note("7.4.3", LEAN.shapes15_2),
  // x = (x as i32).wrapping_mul(Li32).wrapping_add(x as i32) as i16;
  "2ea589a8a1": note("7.3.1", LEAN.shapes16_6),
  // g.f = (self.f as i32).wrapping_mul(Li32) as i16;
  "2ed6ef380f": note("7.3.1", LEAN.shapes19_10),
  // self.lit = Li64.min(Li64) as i16;
  "2f368e2e5b": note("7.2.2", LEAN.shapes6_6),
  // x.f = (x as i32).wrapping_mul(Li32) as i16;
  "2fd81c587c": note("7.3.1", LEAN.shapes15_4),
  // pub fn call(&mut self, g: &mut Globals, prg: &mut Programs) {
  "30d5674ec4": note("7.7.5", LEAN.shapes19_8),
  // self.is_empty = m(L, &mut self.f);
  "311bf0f5b7": note("7.4.5", LEAN.shapes14_8),
  // self.f = (self.f as i32).wrapping_shl(Li8 as u32) as i8;
  "317cab8d16": note("7.2.5", LEAN.shapes8_5),
  // self.f = Li32.wrapping_neg().max(self.f as i32).min(self.f as i32) as i16;
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "3279d75111": note("7.8.5", LEAN.shapes20_13),
  // self.f = (self.f as u64).wrapping_sub({ let x = self.f as u64; let x = Lu64; if x == L { L } else { x % x } }) as u
  "9e961d2670": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // *x = ({ let x = x as i32; let x = x as i32; if x == L { L } else { x % x } }) as i16;
  "df9a7dcbc7": note("7.2.6", LEAN.shapes16_4),
  // x = Li32.wrapping_add(self.f as i32) as i16;
  "335f79d286": note("7.3.1", LEAN.shapes19_10),
  // self.f = self.__numbers_lower_N.wrapping_mul(Li32).wrapping_add(self.__numbers_upper_N);
  "33fc10bac3": note("7.7.8", LEAN.shapes16_15),
  // m(L, …u16, Li16, …, L, …u16, &mut self.f, …);
  "34556679d4": note("7.4.4", LEAN.shapes15_15),
  // self.f = self.f.wrapping_shr(Li16 as u32) as u8;
  "346e81a0f2": note("7.2.5", LEAN.shapes8_4),
  // if ((x == L) | (x == L)) | ((x as i32) < Li32) {
  "347b79cfd5": note("7.5.6", LEAN.shapes15_5),
  // x: { let mut v = T::new(); v.f = Li16; v.f = Lf32; v.f = IecString::<L>::lit(B); v },
  "3489b7781f": note("7.8.3", LEAN.shapes3_7),
  // self.f = (self.f as i32).wrapping_mul(Li32) as u8;
  "34c55ebfd9": note("7.3.1", LEAN.shapes8_3),
  // pub fn after_global_init(&mut self, g: &mut Globals) {
  "365326bb03": note("7.7.5", LEAN.shapes15_6),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), x));
  "36d2a5dd78": merged(["7.4.4", LEAN.shapes16_2], ["7.4.3", LEAN.shapes16_3], ["7.2.4", LEAN.shapes16_10]),
  // x: [(-Li32), Li32, …],
  "36d4b59ee2": note("7.2.9", LEAN.shapes11_19),
  // x.f = (x.f as i32).wrapping_add(Li32) as i16;
  "373f640901": note("7.3.1", LEAN.shapes15_4),
  // map
  "37745ed7a0": note("7.7.5", LEAN.shapes17_5),
  // pub __property_N: i16,
  "377c1dfc31": note("7.6.2", LEAN.shapes13_10),
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as i16;
  "37e2b15787": note("7.2.5", LEAN.shapes8_5),
  // self.sum = (self.f.f as i32).wrapping_add(self.f.f as i32) as i16;
  "37f5ec3b06": note("7.3.1", LEAN.shapes16_6),
  // x = (self.f as i32).wrapping_add(Li32) as i16;
  "37faa78985": note("7.3.1", LEAN.shapes19_10),
  // g.f = (g.f as i32).wrapping_add(Li32) as u16;
  "383107953f": note("7.3.1", LEAN.shapes19_10),
  // self.f = self.__numbers_upper_N.wrapping_sub(self.__numbers_lower_N).wrapping_add(Li32);
  "38cce5cb54": note("7.7.8", LEAN.shapes16_15),
  // self.f = Lu8 as u32;
  "395880371f": note("7.2.10", LEAN.shapes3_11),
  // self.f = (self.f as i32).wrapping_neg() as i16;
  "3968425889": note("7.3.1", LEAN.shapes7_3),
  // self.f = self.f.clone();
  "39e68c53af": note("7.8.2", LEAN.shapes2_9),
  // *x = ((x as i32) / Li32) as i16;
  "3a7612a7b4": note("7.3.11", LEAN.shapes18_7),
  // self.f = self.f.rotate_right(self.f as u32);
  "3aa4ff5b30": note("7.3.5", LEAN.shapes7_4),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_add(x) as i64), Lu8));
  "3b433bdec0": merged(["7.9.3", LEAN.shapes17_1], ["7.4.3", LEAN.shapes17_2]),
  // self.f = (match g.f { L => Li64, …, _ => Li64 }) as i16;
  "3b823fe0e7": note("7.2.7", LEAN.shapes19_5),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.max(Li32) as i64), Lu8));
  "3bbed3930d": merged(["7.4.4", LEAN.shapes16_2], ["7.4.3", LEAN.shapes16_3]),
  // self.f = ((*x) as i32).wrapping_mul(Li32) as i16;
  "3c5653e905": merged(["7.3.1", LEAN.shapes15_4], ["7.8.6", LEAN.shapes15_9]),
  // (match self.f { L => self.f.m_set(self.__property_N), _ => panic!(S) });
  "3c8fcdf5d6": merged(["7.6.1", LEAN.shapes20_10], ["7.8.7", LEAN.shapes20_14]),
  // replace
  "3cacc7bfac": note("7.4.6", LEAN.shapes12_11),
  // x = (m(x) as i32) == (m(x) as i32);
  "3cded85aba": note("7.3.3", LEAN.shapes14_6),
  // pub fn m(mut x: IecString<L>, …) -> IecString<L> {
  "3cf4e6fa21": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // if (self.f as i32) > Li32 { break; }
  "3d3b42b24d": note("7.3.3", LEAN.shapes11_16),
  // self.f.f.m(&IecString::<L>::lit(B));
  "3d5ad9c649": note("7.4.2", LEAN.shapes2_6),
  // self.f.m();
  "3d737b5821": note("7.2.3", LEAN.shapes1_6),
  // x = __grid_lower_N.wrapping_mul(Li32).wrapping_add(__grid_upper_N) as i16;
  "3d792fe7d9": note("7.7.8", LEAN.shapes16_15),
  // if m(x, …, false, &mut (*x), &mut (*x)) {
  "3d7b4a7836": note("7.8.6", LEAN.shapes15_9),
  // self.f = { let x = (-Lf64).trunc(); if (-L..=L).contains(&x) { x as i32 } else { i32::MIN } };
  "3e1e32f963": note("7.2.7", LEAN.shapes10_7),
  // x = (x as i32).wrapping_mul(x as i32) as i16;
  "3eced711ed": note("7.3.1", LEAN.shapes19_10),
  // self.f.f = (self.f as i32) >= Li32;
  "3ecf4f248b": note("7.3.3", LEAN.shapes14_6),
  // self.f = m(L, …i32, L, &mut self.f, …);
  "3eed014822": note("7.4.5", LEAN.shapes14_8),
  // x = { m(x); *x };
  "3fed555c25": note("7.9.3", LEAN.shapes12_9),
  // x: std::array::from_fn(|_| [Lf32; L]),
  "4026548939": note("7.8.2", LEAN.shapes11_13),
  // x = x.with_char(x as i64, x.char_at(x as i64));
  "405fc80910": note("7.4.3", LEAN.shapes15_2),
  // self.f = self.__chain_value_N;
  "40fd7317bb": note("7.6.1", LEAN.shapes5_7),
  // x = (x as i32).wrapping_add(x as i32) as i16;
  "41d2269c05": note("7.3.1", LEAN.shapes15_4),
  // self.f = (self.f as i32).wrapping_mul(Li32) as i8;
  "41f40f95f9": note("7.3.1", LEAN.shapes8_3),
  // self.v = ((Lf32 - self.f) as f64).sqrt() as f32;
  "428230e030": note("7.3.6", LEAN.shapes8_8),
  // pub __chain_value_N: bool,
  "42897347c4": note("7.6.1", LEAN.shapes11_11),
  // x = Li32.wrapping_neg() as i16;
  // self.f.__numbers_lower_N = self.__numbers_lower_N;
  "43449862b7": note("7.2.3", LEAN.shapes15_13),
  // x = (x as i32).wrapping_sub(Li32) as u8;
  "43aa1830f1": note("7.3.1", LEAN.shapes14_4),
  // pub fn x<const T: usize>(mut p: usize, x: &mut IecString<T>) -> u8 {
  "43aad8296c": note("7.8.6", LEAN.shapes16_14),
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = (self.f.f[((Li8 as i64) - Li64) as usize].f.f as i32).wrapping_mul(
  "44a9549a6b": note("7.2.3", LEAN.shapes12_2),
  // if ({ m(p); *x }.char_at((p as i64).wrapping_sub(Li64)) as i32) == Li32 { break; }
  "44d286d05b": merged(["7.4.4", LEAN.shapes16_2], ["7.4.4", LEAN.shapes16_5]),
  // self.p = L;
  "45292dbd9c": merged(["7.2.3", LEAN.shapes1_6], ["7.8.8", LEAN.shapes1_8]),
  // self.f = self.f.wrapping_add(Li16);
  "46c17ef7d3": note("7.3.2", LEAN.shapes2_1),
  // self.f = { let __arg_N = m(self.f.to::<L>(), IecString::<L>::lit(B)); len(__arg_N) };
  "47a7c12d8a": note("7.6.6", LEAN.shapes20_8),
  // self.f.m_set(self.__property_N);
  "48737e1389": note("7.6.2", LEAN.shapes18_2),
  // pub fn fb_init(&mut self, mut x: bool, …) -> bool {
  "49346d6299": note("7.7.1", LEAN.shapes2_11),
  // self.f = self.v.wrapping_sub({ let x = self.v; let x = Lu64; if x == L { L } else { x % x } });
  "93217c590a": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // g: false,
  "496b8acb56": merged(["keep:a BOOL initial value as a literal is correct for every input, nothing needs to change; removed by 7.2.13", LEAN.shapes8_9], ["7.6.6", LEAN.shapes8_11]),
  // self.f = (self.f as i32).wrapping_add(Li32) as i16;
  "4979768984": note("7.3.2", LEAN.shapes2_1),
  // self.f = (-Li64).wrapping_neg();
  // if (len(self.f.f[(self.f as i64) as usize].to::<L>()) as i32) > (self.f as i32) {
  "4a599db8d8": merged(["7.2.14", LEAN.shapes16_7], ["7.4.6", LEAN.shapes16_11]),
  // pub x: i64,
  "4a6baf16b3": merged(["keep:the field declaration is already lean and correct (569 members, 0 disagreements); removed by 7.2.13", LEAN.shapes13_1], ["7.2.2", LEAN.shapes13_4]),
  // x = ((*x) as i32).wrapping_mul(Li32) as i16;
  "4b22d23722": merged(["7.3.1", LEAN.shapes15_4], ["7.8.6", LEAN.shapes15_9]),
  // self.f = match self.f { L => (*__lent_N).take(Li16), _ => panic!(S) };
  "4b5007906a": note("7.8.7", LEAN.shapes20_14),
  // self.f = Lu64;
  "4bf3f61062": note("7.2.11", LEAN.shapes1_10),
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> i32 {
  "4c796f6678": note("7.8.6", LEAN.shapes16_14),
  // x = (x as i32).wrapping_add(Li32) as u16;
  "4c9f4e33f4": note("7.3.1", LEAN.shapes14_4),
  // if !((x < x) & ((x.char_at(x.wrapping_add(x) as i64) as i32) == (x.char_at(x as i64) as i32))) { break; }
  "4d5ea12dda": note("7.4.4", LEAN.shapes16_5),
  // self.f = (self.v as u64).wrapping_sub({ let x = self.v as u64; let x = Lu64; if x == L { L } else { x % x } }) as u
  "e565596543": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // { let __copy_N = IecString::<L>::lit(B); self.f.call(&self.f, &__copy_N); }
  "4d6e5e12b9": note("7.6.5", LEAN.shapes16_12),
  // self.__property_N = Li16;
  "4d8c0c87ee": note("7.6.2", LEAN.shapes13_10),
  // { let mut x = std::mem::take(&mut prg.f); x.m(prg); prg.f = x; };
  "4da7af6f6b": note("7.7.6", LEAN.shapes9_8),
  // self.f = self.f[((Li8 as i64) - Li64) as usize];
  "4e213fd264": note("7.2.3", LEAN.shapes15_3),
  // *v = ((*v) as i32).wrapping_add(Li32) as i16;
  "4ebfb530bd": note("7.3.1", LEAN.shapes19_10),
  // self.f = false;
  "4edbb4135a": note("7.6.1", LEAN.shapes3_13),
  // self.f = (self.f as i32).wrapping_add(Li32) as u16;
  "4fb4aff790": note("7.3.1", LEAN.shapes8_3),
  // if !((x < Li32) & (x < x)) { break; }
  "50226e2c19": note("7.5.7", LEAN.shapes14_7),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64
  "50421700bd": note("7.4.3", LEAN.shapes17_2),
  // *x = self.f;
  "50ba9519ad": note("7.6.3", LEAN.shapes17_9),
  // let mut take: i16 = Li16;
  "51ea066d8e": note("7.7.3", LEAN.shapes18_10),
  // loop {
  "521ba042ac": note("7.5.2", LEAN.shapes1_3),
  // self.f = self.f.wrapping_shr(Li16 as u32) as u16;
  "5228723708": note("7.2.5", LEAN.shapes8_4),
  // self.f = (*x).m();
  "52d85b7cdc": note("7.8.6", LEAN.shapes12_5),
  // x = x.wrapping_add(-Li32);
  "5351b3711d": note("7.5.10", LEAN.shapes13_6),
  // x = Li16;
  "5370b79269": note("7.7.3", LEAN.shapes12_10),
  // if x >= L { return (x as u64) as i64; }
  "5383e1c9ac": note("7.9.1", LEAN.shapes7_9),
  // take
  "53bd7d992e": note("7.6.3", LEAN.shapes17_9),
  // self.f = (self.f as i32) >= (self.f as i32);
  "54889e0f45": note("7.3.3", LEAN.shapes7_2),
  // x = (((x as i32).max(Li32) as u16) as i32).wrapping_sub(Li32);
  "5513d0e592": note("7.3.9", LEAN.shapes16_9),
  // self.f = IecString::<L>::lit(iec_date_text(self.v as i64).as_bytes());
  "5564cd017c": note("7.4.2", LEAN.shapes9_1),
  // self.f = m(self.f, … as f32);
  "55fe85cf23": note("7.2.6", LEAN.shapes5_4),
  // self.f = self.f.wrapping_sub(self.f).wrapping_add(self.f);
  "561f3f5e13": note("7.2.6", LEAN.shapes19_11),
  // x[(x as i64) as usize] = { m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64));
  "569d2b7a40": merged(["7.4.4", LEAN.shapes16_2], ["7.2.4", LEAN.shapes16_10]),
  // pub fn m(mut __values_lower_N: i32, mut __values_upper_N: i32, x: &mut [u8]) -> i64 {
  "56c1a77525": note("7.7.8", LEAN.shapes16_15),
  // self.f = (self.f as i32).wrapping_abs() as u8;
  "56c33c9bab": note("7.3.1", LEAN.shapes7_3),
  // pub ops: [u64; L],
  "572db4e711": note("7.8.2", LEAN.shapes17_8),
  // x = x.with_char(x.wrapping_sub(x) as i64, Lu8);
  "572efde5ab": note("7.4.3", LEAN.shapes15_2),
  // self.f = Li64.wrapping_sub(Li64);
  "57a8f5a4c8": note("7.2.2", LEAN.shapes5_3),
  // self.f = IecString::<L>::lit(iec_lreal_text(self.v).as_bytes());
  "57f6f7d814": note("7.4.2", LEAN.shapes9_1),
  // self.v = m(self.f, Lf64);
  "5886a0dc2b": note("7.2.6", LEAN.shapes4_8),
  // self.f = Li64.wrapping_sub(Li64) as i32;
  "58988cbee9": note("7.2.2", LEAN.shapes7_1),
  // self.f.call(prg);
  "58a7e6289b": note("7.7.6", LEAN.shapes17_5),
  // self.f = Li64.max(Li64).max(Li64) as i16;
  "58d4f235fd": note("7.2.2", LEAN.shapes7_1),
  // x = __numbers_lower_N;
  "58edc15c64": note("7.7.8", LEAN.shapes13_17),
  // if (x as i32) < Li32 {
  "58f3434567": note("7.3.3", LEAN.shapes18_6),
  // self.f = match self.f { L => self.f.m(), _ => panic!(S) };
  "59c341cb0f": note("7.8.7", LEAN.shapes19_6),
  // x = x.with_char(x as i64, str.char_at(x as i64));
  "5a131ce074": note("7.4.3", LEAN.shapes15_2),
  // self.f = (match self.f { L => self.f as i32, …, _ => self.f as i32 }) as i16;
  "5a9bc1030e": note("7.3.1", LEAN.shapes9_6),
  // __chain_value_N: Li16,
  "5b7909c564": note("7.6.1", LEAN.shapes4_6),
  // self.v = self.f * (-Lf64);
  "5c40a4e5a8": note("7.2.9", LEAN.shapes4_9),
  // m(x);
  "5c499dbdc8": note("7.4.4", LEAN.shapes12_6),
  // pub x: f32,
  "5c9bb13706": note("7.3.7", LEAN.shapes12_14),
  // self.f = IecString::<L>::lit(iec_dt_text(self.v as i64).as_bytes());
  "5cefb347f0": note("7.4.2", LEAN.shapes9_1),
  // x[(x as i64).wrapping_sub(__numbers_lower_N as i64) as usize] = x.wrapping_mul(Li32) as i16;
  "5d3437b284": note("7.2.14", LEAN.shapes16_7),
  // x: IecString::<L>::lit(B),
  "5d9850550d": note("7.4.2", LEAN.shapes2_6),
  // self.f = match self.ops[((self.f as i64) - Li64) as usize] { L => self.f.m(self.f), L => self.f.m(self.f), _ => pa
  "5dcbae07c6": note("7.2.3", LEAN.shapes20_12),
  // if ((x as i32) >= Li32) & ((len as i32) > Li32) {
  "5e5aa25221": note("7.5.6", LEAN.shapes15_5),
  // let mut fb_init: i16 = Li16;
  "5e9caa6605": note("7.7.3", LEAN.shapes18_10),
  // (match self.f.f { L => self.f.m(&mut self.f), L => self.f.m(&mut self.f), _ => panic!(S) });
  "5ed54bb657": note("7.8.7", LEAN.shapes20_14),
  // self.f = (self.f as i32).wrapping_neg();
  "605307fc4c": note("7.3.1", LEAN.shapes7_3),
  // { let __arg_N = true; let __arg_N = false; let __arg_N = prg.f.f; { let mut x = std::mem::take(&mut prg.f); let x 
  "60d6b79cca": merged(["7.6.6", LEAN.shapes20_8], ["7.8.10", LEAN.shapes20_9]),
  // self.f = self.f.wrapping_add((if self.f { -Li64 } else { Li64 }) as i16);
  "60fefc4d63": note("7.5.9", LEAN.shapes11_8),
  // self.f = m(self.f as f64, Lf64) as f32;
  "61a75e7b4b": note("7.2.6", LEAN.shapes7_10),
  // self.f = (self.f as i32).wrapping_add(self.f.f as i32) as i16;
  "623e0abb20": note("7.3.1", LEAN.shapes19_10),
  // self.f = ((self.f as i32) / (self.f as i32)) as f32;
  "6256abaa7b": note("7.2.6", LEAN.shapes8_7),
  // self.f[((Li8 as i64) - Li64) as usize] = (self.f[((Li8 as i64) - Li64) as usize] as i32).wrapping_add(Li32) as i16
  "628bc6e2ed": note("7.2.3", LEAN.shapes12_2),
  // if ({ m(x); *__str_pst_N }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 { break; 
  "62c7abffa7": note("7.9.3", LEAN.shapes17_1),
  // x = __numbers_upper_N;
  "62caf55aa5": note("7.7.8", LEAN.shapes13_17),
  // self.m_set(__property_N);
  "637fe937dc": note("7.6.2", LEAN.shapes18_2),
  // self.f = self.f.wrapping_shl(self.f as u32);
  "638ea949bb": note("7.3.5", LEAN.shapes7_4),
  // self.v = Li64.wrapping_sub(Li64) as i32;
  "63c4ea9498": note("7.2.2", LEAN.shapes7_1),
  // pub x: i32,
  "63d29bd1a0": merged(["7.2.2", LEAN.shapes12_12], ["7.3.1", LEAN.shapes12_13]),
  // self.f = Li64.wrapping_sub(Li64) as i16;
  "63dc3d3963": note("7.2.2", LEAN.shapes7_1),
  // pub fn m(mut x: f32) -> f32 {
  "63e6752512": note("7.7.1", LEAN.shapes13_12),
  // self.f = Li8 as i16;
  "63f801635e": note("7.2.10", LEAN.shapes3_11),
  // g.f = (g.f as i32).wrapping_mul(Li32).wrapping_add(Li32) as i16;
  "64b82e4bf9": note("7.3.1", LEAN.shapes16_6),
  // self.f = ((self.f as i32) ^ (self.f as i32)) as u8;
  "64c0a06174": note("7.3.1", LEAN.shapes8_3),
  // replace = { let __arg_N = m(x, …, p); let __arg_N = x; let __arg_N = (p as i32).wrapping_sub(Li32).max(Li32) as i16
  "650e10d85c": merged(["7.4.3", LEAN.shapes17_2], ["7.4.3", LEAN.shapes17_4]),
  // x: Lu16,
  "65df8e0418": note("7.2.9", LEAN.shapes5_17),
  // x: (f64::INFINITY),
  "66ef68b08a": note("7.2.9", LEAN.shapes2_13),
  // self.f = (self.f as i32).wrapping_add(x as i32) as i16;
  "6713eb5cc0": note("7.3.1", LEAN.shapes19_10),
  // self.f.f[Li64 as usize] = ({ let x = self.f.f as u64; let x = Lu64; if x == L { L } else { x % x } }) as u8;
  "9804d49d82": merged(["7.8.4", LEAN.shapes3_1], ["7.2.6", LEAN.shapes3_2], ["7.2.3", LEAN.shapes3_3]),
  // self.f[(Li8 as i64) as usize][(Li8 as i64) as usize] = Lf32;
  "67c71ff35c": note("7.2.3", LEAN.shapes11_7),
  // self.v = self.f * (-Lf32);
  "682fffc71e": note("7.2.9", LEAN.shapes4_9),
  // x: std::array::from_fn(|_| std::array::from_fn(|_| [Li16; L])),
  "683d4b1944": note("7.8.2", LEAN.shapes12_1),
  // self.f.f = ({ let x = self.f.f[Li64 as usize] as u64; let x = Lu64; if x == L { L } else { x % x } }).wrapping_add(
  "29a005f929": note("7.2.6", LEAN.shapes12_4),
  // x: false,
  "687428cc81": note("keep:a BOOL initial value as a literal is correct for every input, nothing needs to change; removed by 7.2.13", LEAN.shapes8_9),
  // __numbers_upper_N: Li32,
  "68cdda5f1a": note("7.7.8", LEAN.shapes13_17),
  // if x < -L { return i32::MIN; }
  "693c14b0bd": note("7.9.1", LEAN.shapes5_1),
  // pub fn m(&mut self, prg: &mut Programs, mut x: i16) -> i16 {
  "69b0552c65": note("7.7.5", LEAN.shapes19_8),
  // self.f = len(self.f.f[(self.f as i64) as usize].to::<L>());
  "6a2b5f2826": merged(["7.2.3", LEAN.shapes15_3], ["7.7.2", LEAN.shapes15_14]),
  // self.f = (self.f as i32).wrapping_abs() as i16;
  "6a41bda0a0": note("7.3.4", LEAN.shapes2_10),
  // pub x: f64,
  "6a98109119": note("keep:the field line is already minimal and correct (probed edge inputs agree); removed by 7.2.13", LEAN.shapes11_5),
  // x = (self.f as i32).wrapping_mul(self.f as i32) as i16;
  "6b14b17ba7": note("7.3.1", LEAN.shapes19_10),
  // self.f = ((self.v as u64) / Lu64) as u32;
  "6b4f1bb990": note("7.3.10", LEAN.shapes7_5),
  // self.f = self.f.wrapping_add(self.f);
  "6bf6856d37": note("7.5.1", LEAN.shapes6_13),
  // pub fn __init(&mut self, g: &mut Globals) {
  "6cec059f2e": note("7.7.5", LEAN.shapes15_6),
  // x[(x as i64).wrapping_sub(__line_lower_N as i64) as usize].f = (x[(x as i64).wrapping_sub(__line_lower_N as i64) a
  "6d48208e3e": note("7.2.3", LEAN.shapes20_12),
  // pub fn m(&mut self, mut x: i16) -> i16 {
  "6dd22a92d0": note("7.7.3", LEAN.shapes14_14),
  // m(L, …u16, L, …i16, Li16, …, &mut self.f, …);
  "6e06410746": note("7.4.4", LEAN.shapes15_15),
  // pub fn m(mut x: u8) -> bool {
  "6e16e4ee84": note("7.7.1", LEAN.shapes13_12),
  // self.f = (self.f as u64) as u32;
  "6e691851a6": merged(["7.2.6", LEAN.shapes5_5], ["7.3.9", LEAN.shapes5_9]),
  // self.f = Li64.wrapping_add(Li64) as i16;
  "6e95d900d2": note("7.2.2", LEAN.shapes7_1),
  // self.f = IecString::<L>::lit(iec_time_text(self.v as i64).as_bytes());
  "6f19035a22": note("7.4.2", LEAN.shapes9_1),
  // (x as i64) as i32
  "6f8ef8f0bd": note("7.9.1", LEAN.shapes3_8),
  // x: (-Li32),
  "6f9ae8fd3a": note("7.2.9", LEAN.shapes1_1),
  // self.f.m_set(prg, self.__property_N);
  "6ff1de2a48": note("7.6.2", LEAN.shapes18_2),
  // self.f = x;
  "707233d6d6": note("7.6.1", LEAN.shapes11_11),
  // self.f[(Li8 as i64) as usize].m();
  "7073e4cc28": note("7.2.3", LEAN.shapes6_9),
  // *x = ((*x) as i32).wrapping_add(x as i32) as i16;
  "707715f6ab": note("7.3.1", LEAN.shapes19_10),
  // self.f = { self.__inout_index_N = self.f; let __arg_N = self.m(); m(__arg_N, &mut self.f[(self.__inout_index_N as 
  "70b25e3c85": note("7.6.1", LEAN.shapes20_10),
  // pub fn m(mut x: i32, x: &mut bool) -> i32 {
  "72543de594": note("7.7.9", LEAN.shapes19_2),
  // self.f.f = (self.f as i32) <= Li32;
  "73351964cd": note("7.3.3", LEAN.shapes18_6),
  // self.f = true;
  "73505351ad": note("7.6.1", LEAN.shapes1_5),
  // self.f = Li64.max(Li64).min(Li64) as i16;
  "745a764511": note("7.2.2", LEAN.shapes7_1),
  // x: Lf32,
  "74845f98c6": merged(["7.2.12", LEAN.shapes4_3], ["7.2.12", LEAN.shapes5_15], ["7.2.8", LEAN.shapes5_16]),
  // self.f = ((self.f as i32) ^ (self.f as i32)) as i8;
  "7589f5a1ee": note("7.3.1", LEAN.shapes8_3),
  // p: L,
  "75cc82a569": merged(["7.2.3", LEAN.shapes1_6], ["7.8.8", LEAN.shapes1_8]),
  // x = ({ let x = x as i32; let x = Li32; if x == L { L } else { x % x } }) as i16;
  "b9dca54014": note("7.2.6", LEAN.shapes20_4),
  // if (x.f as i32) < Li32 {
  "770670a973": note("7.3.3", LEAN.shapes18_6),
  // x = m(x, &mut (*x)).wrapping_sub(Li32);
  "77378f7efe": note("7.8.6", LEAN.shapes14_9),
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i32 {
  "775c30eac7": note("7.7.8", LEAN.shapes16_15),
  // self.f = (self.v as u64).wrapping_mul(Lu64).wrapping_sub({ let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu64
  "987f059b0e": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // x: (f32::INFINITY),
  "78615154a3": note("7.2.9", LEAN.shapes2_13),
  // self.f = self.f[(Li8 as i64) as usize].f;
  "7886e7bd17": note("7.2.3", LEAN.shapes2_3),
  // self.f.count = (self.f.f[((Li8 as i64) - Li64) as usize].f.f as i32).wrapping_add(self.f.f[((Li8 as i64) - Li64) a
  "789e5223f1": note("7.2.3", LEAN.shapes12_2),
  // x = x.wrapping_add(x[(x as i64).wrapping_sub(__values_lower_N as i64) as usize] as i32);
  "7918d10820": note("7.2.3", LEAN.shapes20_12),
  // self.f = (self.f as u8) as f32;
  "798c276f84": note("7.3.5", LEAN.shapes5_10),
  // __numbers_lower_N: Li32,
  "79fd4d52a6": note("7.7.8", LEAN.shapes13_17),
  // let mut __property_N: i16 = Li16;
  "79ff186095": note("7.6.2", LEAN.shapes18_2),
  // x = ((*x) as i32).wrapping_add((*x) as i32) as i16;
  "7a6f282031": merged(["7.3.1", LEAN.shapes15_4], ["7.8.6", LEAN.shapes15_9]),
  // x = m(&mut str) as i32;
  "7a85af3c04": note("7.4.6", LEAN.shapes13_15),
  // __chain_value_N: false,
  "7a88c529f6": note("7.6.1", LEAN.shapes11_11),
  // self.f = (self.f as i32).wrapping_sub(Li32) as i8;
  "7aa0eab362": note("7.3.1", LEAN.shapes8_3),
  // pub fn m(mut x: i16, x: &mut i16) -> i16 {
  "7ab9128afd": note("7.7.1", LEAN.shapes18_9),
  // pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {
  "7c7cff3d31": note("7.7.5", LEAN.shapes19_8),
  // x = (x as i32).wrapping_mul(Li32) as i16;
  "7c881bc819": note("7.3.1", LEAN.shapes15_4),
  // self.f = (self.f as i32).wrapping_abs();
  "7cf7edd325": note("7.3.1", LEAN.shapes7_3),
  // x = { m(p); *x }.char_at((p as i64).wrapping_sub(Li64).wrapping_add(Li64));
  "7cfee53212": merged(["7.4.4", LEAN.shapes16_2], ["7.2.4", LEAN.shapes16_10]),
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as i16;
  "7d2d13ed81": note("7.3.1", LEAN.shapes9_3),
  // self.f = m(L, …u16, &mut self.f, …);
  "7db062ce2f": note("7.4.5", LEAN.shapes14_8),
  // self.f = { let __copy_N = IecString::<L>::lit(B); m(&__copy_N) };
  "7de11239a2": note("7.6.5", LEAN.shapes20_7),
  // self.f = Li32.wrapping_neg() as u8;
  // x = m(x, &mut (*x));
  "7e45a342fc": note("7.8.6", LEAN.shapes13_9),
  // x = (self.f as i32).wrapping_mul(Li32).wrapping_add((g.f as i32).wrapping_mul(Li32)).wrapping_add(x as i32) as i16
  "7ee47c4eab": note("7.3.1", LEAN.shapes17_7),
  // g.f = (g.f as i32).wrapping_add(Li32) as i16;
  "7ef1346b85": note("7.3.1", LEAN.shapes15_4),
  // self.f = ((self.f as i32) | (self.f as i32)) as u8;
  "7f28567c88": note("7.3.1", LEAN.shapes8_3),
  // if (self.f & (!self.f)) & ((self.f as i32) > Li32) {
  "7f4dd168c2": note("7.5.6", LEAN.shapes15_5),
  // self.v = (-Li32).wrapping_neg();
  // pub __chain_value_N: f64,
  "7fc67373d7": note("7.6.1", LEAN.shapes4_6),
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as i8;
  "8049b483ae": note("7.3.1", LEAN.shapes8_3),
  // self.f.call(&mut (*x));
  "8064ae1570": note("7.8.6", LEAN.shapes13_9),
  // x = Li32;
  "8088e0ab18": note("7.7.3", LEAN.shapes12_10),
  // self.f = (self.f as i32).max(self.f as i32) as i8;
  "80e291be91": note("7.3.1", LEAN.shapes8_3),
  // pub fn x<const T: usize>(x: &IecString<T>) -> bool {
  "81253ce291": note("7.7.2", LEAN.shapes15_14),
  // self.m_set(self.__property_N);
  "81d1867d27": note("7.6.2", LEAN.shapes18_2),
  // pub fn call(&mut self, x: &mut [i16]) {
  "81ed699293": note("7.5.7", LEAN.shapes14_15),
  // self.f = ((self.f as i32) | (self.f as i32)) as u16;
  "81f1075b92": note("7.3.1", LEAN.shapes8_3),
  // take = self.f;
  "821a3bb974": note("7.6.3", LEAN.shapes17_9),
  // x.m(&IecString::<L>::lit(B));
  "8232a1cf7c": note("7.7.3", LEAN.shapes18_10),
  // self.f = match self.f { L => (*__lent_N).m(), L => (*__lent_N).m(), _ => panic!(S) };
  "82e802ebc9": note("7.8.7", LEAN.shapes20_14),
  // x = (((x as i32) == Li32) | (((x as i32) >= Li32) & ((x as i32) <= Li32))) | ((x as i32) == Li32);
  "82fcd0be19": note("7.4.4", LEAN.shapes16_5),
  // self.f = Lu8 != L;
  "83389dfa8a": note("7.2.10", LEAN.shapes3_11),
  // *x = ((*x) as i32).wrapping_add(self.f as i32) as i16;
  "833efb5917": note("7.3.1", LEAN.shapes19_10),
  // self.f = ((self.v as u64) / Lu64).wrapping_sub({ let x = (self.v as u64) / Lu64; let x = Lu64; if x == L { L } else
  "2028cf631c": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // self.f = (g.f as i32).max(self.f as i32).min(g.f as i32) as i16;
  "83d24ce33a": note("7.3.1", LEAN.shapes20_3),
  // pub fn m(mut str: IecString<L>, mut x: i16) -> IecString<L> {
  "83ed1aab47": merged(["7.4.6", LEAN.shapes16_11], ["7.6.6", LEAN.shapes16_16]),
  // self.f[((self.f as i64) - Li64) as usize] = self.f.f;
  "848701ece2": note("7.2.3", LEAN.shapes19_3),
  // pub fn m(mut x: f64) -> f64 {
  "84ac703739": note("7.7.1", LEAN.shapes13_12),
  // prg.f.f.f = Li16;
  "85168be6a7": note("7.7.5", LEAN.shapes17_5),
  // self.f = m(self.f, &mut self.f);
  "8539587ea0": note("7.4.4", LEAN.shapes14_10),
  // self.f = IecString::<L>::lit(x!(S, self.v).as_bytes());
  "85e51471f9": note("7.4.2", LEAN.shapes9_1),
  // self.f = m(self.f as f64) as u32;
  "8653414194": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // x: Li64,
  "870b70e195": merged(["7.2.8", LEAN.shapes6_1], ["7.8.11", LEAN.shapes6_4]),
  // self.f = (self.v as u8) as f32;
  "873f201d21": note("7.3.5", LEAN.shapes5_10),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu8 << L) } else { *x & !(Lu8 << L) }; }
  "87cd3925f5": note("7.8.5", LEAN.shapes20_13),
  // self.f = len(self.narrow.to::<L>());
  "8986d5305c": note("7.4.6", LEAN.shapes14_18),
  // self.f = (self.f as i32).min(self.f as i32) as i8;
  "8a1bafcc9c": note("7.3.1", LEAN.shapes8_3),
  // let mut fb_init: bool = false;
  "8a9bb48ddb": note("7.7.1", LEAN.shapes2_11),
  // self.f = (if self.g { self.f as i32 } else { self.f as i32 }) as i16;
  "8b3a192776": note("7.2.7", LEAN.shapes10_4),
  // self.f = self.f.wrapping_shr(self.f as u32);
  "8b69355dc1": note("7.3.5", LEAN.shapes7_4),
  // self.f = IecString::<L>::lit(B);
  "8b6ecf477b": note("7.4.2", LEAN.shapes2_6),
  // x: { let mut v = T::new(); v.f = Li16; v },
  "8b9a7c5eea": note("7.8.3", LEAN.shapes7_11),
  // self.f.m(&IecString::<L>::lit(x!(S, self.f).as_bytes()));
  "8c1b866176": note("7.4.2", LEAN.shapes9_2),
  // self.f.m(Li32.wrapping_neg() as i16);
  // { m(self.f); self.f.m_set(self.__property_N) };
  "8c658bedd7": note("7.6.2", LEAN.shapes15_10),
  // self.f.narrow();
  "8cca954ad7": note("7.7.2", LEAN.shapes3_9),
  // x = (x as i32).wrapping_add(Li32) as i16;
  "8ccaa880cd": note("7.3.1", LEAN.shapes15_4),
  // self.f = Li64.min(Li64).min(Li64).min(Li64) as i16;
  "8cd84736a1": note("7.2.7", LEAN.shapes8_6),
  // x.f[((x.f as i64) - Li64) as usize].f = x;
  "8d7dcea3f3": note("7.2.3", LEAN.shapes19_3),
  // self.count = (self.count as i32).wrapping_add(Li32) as i16;
  "8d8ff2c804": note("7.3.1", LEAN.shapes8_3),
  // self.f.f = (((self.f as i32) == Li32) | ((self.f as i32) == Li32)) | ((self.f as i32) == Li32);
  "8e4b1ce4cc": note("7.3.3", LEAN.shapes20_2),
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x % x } }) as i16;
  "7f4574c83b": note("7.3.13", LEAN.shapes10_3),
  // self.f = ((self.f as f64).sqrt() as f32) > Lf32;
  "8efdf97fb5": note("7.3.6", LEAN.shapes8_8),
  // self.f = (self.f as i32).min(self.f as i32) as u16;
  "8f1829f5b3": note("7.3.1", LEAN.shapes8_3),
  // if (g.f as i32) <= Li32 {
  "8f2ea71862": note("7.3.3", LEAN.shapes18_6),
  // self.f.f = IecWString::<L>::lit(&[Lu16, …]);
  "8f5f221644": note("7.4.8", LEAN.shapes15_12),
  // self.f = (x as i32).wrapping_mul(Li32) as i16;
  "8ffd5ed266": note("7.3.1", LEAN.shapes19_10),
  // pub fn sum(&mut self, mut x: [i16; L]) {
  "9034f2a4d6": note("7.7.1", LEAN.shapes18_9),
  // m(L, …u16, Li16, …, L, …u16, &mut self.f);
  "9055680d64": note("7.4.4", LEAN.shapes15_15),
  // self.f = Li64 == Li64;
  "907aa92bfc": note("7.3.3", LEAN.shapes4_7),
  // self.f = (self.f.f as i32).wrapping_mul(self.f.f as i32) as i16;
  "90ba7cf588": note("7.3.1", LEAN.shapes16_6),
  // x: Lu64,
  "90c445f7cb": note("7.2.8", LEAN.shapes5_16),
  // self.f = (self.__chain_value_N as f32) as f64;
  "915417cef0": note("7.6.1", LEAN.shapes7_6),
  // self.f = ({ let x = (self.f as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x % x } }) as u32;
  "c186d0a477": note("7.2.6", LEAN.shapes10_1),
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = Li16;
  "91f6be3675": note("7.2.3", LEAN.shapes11_7),
  // self.f = m(self.f as f64) as u16;
  "923862ec54": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // self.f = self.f.wrapping_shr(Li8 as u32);
  "924a0fdb2f": note("7.2.2", LEAN.shapes7_1),
  // let mut replace: IecString<L> = IecString::<L>::lit(B);
  "92f7142ab2": note("7.4.7", LEAN.shapes15_11),
  // if !(((((if self.f { -Li64 } else { Li64 }) as i16) >= Li16) & (self.f <= self.f)) | ((((if self.f { -Li64 } else { Li64 }) as i16) < Li16) & (self.f >= self.f))) { break; }
  "9358115574": note("7.5.9", LEAN.shapes11_8),
  // self.f.m(&m(self.f.to::<L>(), self.f.f[(self.f as i64) as usize].to::<L>()));
  "939dcea16f": note("7.2.14", LEAN.shapes16_7),
  // 'loop_N: loop {
  "93a17fab28": note("7.5.2", LEAN.shapes11_9),
  // self.f.m(&IecString::<L>::lit(B));
  "94c11e8f56": note("7.4.2", LEAN.shapes2_6),
  // 'body_N: {
  "95094bd48a": note("7.5.3", LEAN.shapes10_6),
  // self.f = (x as i32).wrapping_add(Li32) as i16;
  "9610f67747": note("7.3.1", LEAN.shapes19_10),
  // self.sum = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "964296462a": note("7.3.1", LEAN.shapes9_3),
  // x: { let mut v = T::new(); v.f = Li16; v.f = Lf32; v },
  "9689b156ea": note("7.8.3", LEAN.shapes2_8),
  // *x = Li16;
  "96a5b25b66": note("7.7.3", LEAN.shapes1_9),
  // self.f = (match self.f { L => Li64, …, _ => Li64 }) as i16;
  "96b55e688b": note("7.2.7", LEAN.shapes8_6),
  // self.f = match self.f { L => self.f.m(Li16), _ => panic!(S) };
  "96bf43c1e7": note("7.8.7", LEAN.shapes19_6),
  // pub fn m(mut x: i16) -> T {
  "96f5f06912": note("7.7.1", LEAN.shapes13_12),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64
  "974fbd1aae": note("7.4.3", LEAN.shapes17_2),
  // self.f = ((self.f as i32) ^ (self.f as i32)) as i16;
  "97c6103a21": note("7.3.1", LEAN.shapes8_3),
  // (match self.f { L => self.f.m(), L => self.f.m(), _ => panic!(S) });
  "9831f2d691": note("7.8.7", LEAN.shapes20_14),
  // self.f.f = ((self.f as i32) >= Li32) & ((self.f as i32) <= Li32);
  "98716b4ff8": note("7.3.3", LEAN.shapes20_2),
  // if ((*str).char_at(x as i64) as i32) == Li32 { break; }
  "98ba0d2e70": note("7.8.6", LEAN.shapes15_9),
  // self.f = (self.f as i32).wrapping_sub(Li32) as i16;
  "9999dc327a": note("7.3.1", LEAN.shapes8_3),
  // self.f = self.f.rotate_left(Li8 as u32);
  "9a4cb2346e": note("7.2.2", LEAN.shapes7_1),
  // if m(x, …, true, &mut (*x), &mut (*x)) {
  "9a63db2a45": note("7.8.6", LEAN.shapes14_9),
  // self.f = self.f[((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((
  "9b12fdbfc8": note("7.2.3", LEAN.shapes12_2),
  // self.v = Li64.wrapping_sub(Li64) as i16;
  "9b7b8014c4": note("7.2.2", LEAN.shapes7_1),
  // self.f = { let __copy_N = self.f; self.m(&__copy_N) };
  "9bb47dec44": note("7.6.5", LEAN.shapes19_7),
  // let mut x: u8 = Lu8;
  "9c1d0c1a6e": note("7.4.5", LEAN.shapes13_16),
  // self.f = ({ let x = self.v / Lu64; let x = Lu64; if x == L { L } else { x % x } }) as u32;
  "f380707227": note("7.2.6", LEAN.shapes10_1),
  // pub fn call<const T: usize>(&mut self, x: &i16, x: &IecString<T>) {
  "9c8bf093b2": note("7.6.5", LEAN.shapes16_12),
  // pub fn m(mut str: IecString<L>, mut len: i16, mut x: i16) -> IecString<L> {
  "9c8d21e237": note("7.4.6", LEAN.shapes16_11),
  // self.ops[((Li8 as i64) - Li64) as usize] = L;
  "9ca82cec1d": note("7.2.3", LEAN.shapes19_3),
  // self.f = Li32.max(self.f as i32).min(Li32) as i16;
  "9d3d81580d": note("7.2.7", LEAN.shapes8_6),
  // self.f = IecWString::<L>::lit(&[Lu16, …]);
  "9d62c9b3e2": note("7.4.8", LEAN.shapes2_6),
  // self.f = self.f.wrapping_shl(Li8 as u32);
  "9d8cd15435": note("7.2.10", LEAN.shapes18_4),
  // self.f = { let x = self.f; let x = Lu32; if x == L { L } else { x % x } };
  "1eeff30bd4": note("7.2.6", LEAN.shapes20_4),
  // pub __chain_value_N: i16,
  "9e66c9a561": note("7.6.1", LEAN.shapes4_6),
  // x[(__numbers_upper_N as i64).wrapping_sub(__numbers_lower_N as i64) as usize] = Li16;
  "9edcbf6da4": note("7.2.14", LEAN.shapes16_7),
  // self.f[((self.f as i64) - Li64) as usize] = Li16;
  "9f8b867884": note("7.2.3", LEAN.shapes19_3),
  // if (self.f as i32) < Li32 {
  "9f93398f3e": note("7.3.3", LEAN.shapes11_16),
  // self.f = (self.f as i32) != (self.f as i32);
  "9fb281f7a2": note("7.3.3", LEAN.shapes7_2),
  // self.f = Lu32 as u64;
  "9fb47c3123": note("7.2.10", LEAN.shapes18_4),
  // (match self.f.f { L => self.f.m(&mut self.v), _ => panic!(S) });
  "9fbd098efb": note("7.8.7", LEAN.shapes3_12),
  // pub fn m(&mut self, mut x: i16) {
  "a01f00db76": note("7.7.1", LEAN.shapes18_9),
  // if ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 {
  "a021273b0d": merged(["7.4.4", LEAN.shapes16_2], ["7.4.4", LEAN.shapes16_5], ["7.2.4", LEAN.shapes16_10]),
  // self.f = IecString::<L>::lit(iec_ltime_text(self.v).as_bytes());
  "a0672773fa": note("7.4.2", LEAN.shapes9_1),
  // self.f = (self.f as i32) as i16;
  "a078903418": note("7.3.9", LEAN.shapes5_9),
  // self.f = self.f == IecString::<L>::lit(B);
  "a095c1d0aa": note("7.4.9", LEAN.shapes7_7),
  // self.f[(Li8 as i64) as usize].f = (self.f[(Li8 as i64) as usize].f as i32).wrapping_add(Li32) as i16;
  "a0d3389a70": note("7.2.3", LEAN.shapes3_3),
  // self.f = (self.f as f64).sqrt();
  "a1adee154e": note("7.3.6", LEAN.shapes5_11),
  // self.narrow.m(&self.f.narrow::<L>());
  "a1c2206655": note("7.4.6", LEAN.shapes16_11),
  // v: Li16,
  "a29db6178b": merged(["7.2.8", LEAN.shapes6_1], ["7.8.8", LEAN.shapes6_2], ["7.9.3", LEAN.shapes6_3]),
  // x.m(&{ let __arg_N = m(x.f.to::<L>(), IecString::<L>::lit(B)); let __arg_N = x.f.to::<L>(); m(__arg_N, …) });
  "a31de5f5e1": note("7.4.3", LEAN.shapes17_4),
  // x = ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64)) as i32) == Li32;
  "a328a51dbd": note("7.4.4", LEAN.shapes16_2),
  // self.f = (self.f as i32) == (self.f as i32);
  "a363bc4ca3": note("7.3.3", LEAN.shapes7_2),
  // self.f = m(Lu8, L, …i32, &mut self.f, …);
  "a39c1efab6": note("7.4.4", LEAN.shapes15_15),
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.map(prg); prg.f = x; x };
  "a3a49d3776": note("7.8.10", LEAN.shapes20_9),
  // if (x as i32) > Li32 {
  "a3ca286f93": note("7.3.3", LEAN.shapes18_6),
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.m_get(prg); prg.f = x; x };
  "a41f58717b": note("7.8.10", LEAN.shapes20_9),
  // pub x: u64,
  "a497507b30": merged(["keep:the field declaration is already lean and correct (569 members, 0 disagreements); removed by 7.2.13", LEAN.shapes13_1], ["7.2.5", LEAN.shapes13_2]),
  // g.f[((g.f as i64) - Li64) as usize].f.m(&IecString::<L>::lit(B));
  "a4ff08580b": note("7.2.3", LEAN.shapes20_12),
  // if ((x as i32) >= Li32) & ((x as i32) <= Li32) {
  "a54ead1fbe": note("7.5.6", LEAN.shapes15_5),
  // self.f = { let __copy_N = IecString::<L>::lit(B); self.m(&__copy_N) };
  "a558076adc": note("7.6.5", LEAN.shapes20_7),
  // len
  "a573b540d2": merged(["7.7.3", LEAN.shapes12_10], ["7.4.6", LEAN.shapes12_11]),
  // pub fn m(mut x: i16, …) -> i16 {
  "a5c4faeebd": note("7.7.3", LEAN.shapes14_14),
  // ops: std::array::from_fn(|_| L),
  "a65506e4d8": note("7.8.2", LEAN.shapes18_8),
  // self.v = Li32.wrapping_neg() as i8;
  // self.f = ((self.f as i32) & (self.f as i32)) as u16;
  "a7ca0579a1": note("7.3.1", LEAN.shapes8_3),
  // x: { let mut v = T::new(); v.f = IecString::<L>::lit(B); v.f = IecString::<L>::lit(B); v },
  "a7ca9e8349": note("7.8.3", LEAN.shapes16_13),
  // self.f = (self.f as i32).wrapping_sub(Li32) as u16;
  "a851cc298d": note("7.3.1", LEAN.shapes8_3),
  // self.f = (-Li32).wrapping_neg();
  // self.f = (self.f as i32).wrapping_neg() as u8;
  "a9c2598276": note("7.3.1", LEAN.shapes7_3),
  // self.f = (*x) == IecString::<L>::lit(B);
  "ab6512a512": note("7.4.9", LEAN.shapes14_17),
  // pub fn m(&mut self, prg: &mut Programs) {
  "ab696e2449": note("7.7.5", LEAN.shapes7_8),
  // x: (-f32::INFINITY),
  "aba7baaaaa": note("7.2.9", LEAN.shapes2_13),
  // pub fn m(mut x: u16) -> u16 {
  "abc8bc67de": note("7.7.1", LEAN.shapes13_12),
  // self.f = self.f[(Li8 as i64) as usize];
  "abe3ae1f0b": note("7.2.3", LEAN.shapes11_7),
  // { let mut x = std::mem::take(&mut prg.f); x.call(prg); prg.f = x; }
  "abf2bb6e4e": note("7.7.6", LEAN.shapes3_6),
  // self.f.f = self.f.clone();
  "ac452bc801": note("7.8.1", LEAN.shapes13_11),
  // g.f[((g.f as i64) - Li64) as usize].f = self.f;
  "acb72c4272": note("7.2.3", LEAN.shapes19_3),
  // self.f = L;
  "ad25627749": note("7.8.8", LEAN.shapes1_8),
  // self.f.f = ((self.f as i32) == Li32) | ((self.f as i32) == Li32);
  "adb6559f1f": note("7.4.4", LEAN.shapes16_5),
  // self.f = self.f[((Li8 as i64) - Li64) as usize][(Li8 as i64) as usize][((Li8 as i64) - Li64) as usize];
  "ae08e85841": note("7.2.3", LEAN.shapes12_2),
  // self.f = (self.f as i32).max(self.f as i32) as u16;
  "ae0e0c28ea": note("7.3.1", LEAN.shapes8_3),
  // { let mut x = std::mem::take(&mut prg.f); x.call(g, prg); prg.f = x; }
  "ae38098da5": note("7.8.10", LEAN.shapes20_9),
  // self.f = IecString::<L>::lit(iec_tod_text(self.v as i64).as_bytes());
  "aeb527c9e6": note("7.4.2", LEAN.shapes9_1),
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as i8;
  "af004404ec": note("7.2.5", LEAN.shapes8_5),
  // v: Lu32,
  "afa5d14dd9": note("7.2.8", LEAN.shapes6_1),
  // pub fn x<const T: usize>(&mut self, x: &IecString<T>) -> bool {
  "b03c447093": note("7.6.5", LEAN.shapes19_7),
  // self.f = m(self.f).log10() as f32;
  "b07338e4d9": note("7.3.12", LEAN.shapes6_10),
  // if ((self.f as i32) == Li32) & ((self.f as i32) == Li32) {
  "b0965eecf6": merged(["7.3.3", LEAN.shapes11_16], ["7.5.6", LEAN.shapes11_17]),
  // self.f.f[Li64 as usize] = ({ let x = (self.f.f as u64) / Lu64; let x = Lu64; if x == L { L } else { x % x } }) as u
  "e91195fc19": merged(["7.8.4", LEAN.shapes3_1], ["7.2.6", LEAN.shapes3_2], ["7.2.3", LEAN.shapes3_3]),
  // self.f.f = ({ let x = self.f as i32; let x = Li32; if x == L { L } else { x % x } }) == Li32;
  "bad36de1e1": note("7.2.6", LEAN.shapes16_4),
  // if ((x as i32) < Li32) | ((x as i32) > x) {
  "b2d33739c5": note("7.5.6", LEAN.shapes15_5),
  // x = __grid_lower_N;
  "b3a0495ed2": note("7.7.8", LEAN.shapes13_17),
  // self.f = T::new();
  "b3e78a179a": note("7.6.4", LEAN.shapes11_12),
  // self.f = self.f.f[(Li8 as i64) as usize];
  "b4183b4f7f": note("7.2.3", LEAN.shapes11_7),
  // self.f = (self.f as f64).cos() as f32;
  "b48af08c44": note("7.3.12", LEAN.shapes6_10),
  // x: (-Li8),
  "b501abe431": note("7.2.9", LEAN.shapes1_1),
  // self.f = { let x = ((self.narrow * Lf32) as f64).trunc(); if (-L..=L).contains(&x) { x as i32 } else { i32::MIN } 
  "b532048eaa": note("7.9.2", LEAN.shapes17_6),
  // x = { let __arg_N = m(x); m(__arg_N) };
  "b58894b5df": note("7.6.6", LEAN.shapes14_12),
  // pub fn m(mut x: IecString<L>, …, mut x: i16) -> IecString<L> {
  "b592939dbf": note("7.4.6", LEAN.shapes16_11),
  // self.f = IecString::<L>::lit((if self.f { S } else { S }).as_bytes());
  "b5a9bef60f": note("7.4.2", LEAN.shapes9_1),
  // { let mut __copy_N = self.f.clone(); self.m(Li16, Li32, …, &mut __copy_N); self.f = __copy_N; };
  "b6565109d7": note("7.8.10", LEAN.shapes20_9),
  // self.f = Li32 as i8;
  "b6a5a933fb": note("7.2.10", LEAN.shapes3_11),
  // if x >= L { return L; }
  "b7286c7932": note("7.9.1", LEAN.shapes4_5),
  // x.f = (x as i32) > Li32;
  "b733155a29": note("7.3.3", LEAN.shapes13_14),
  // if self.f > self.f.m_get() { break; }
  "b736e18f55": note("7.5.7", LEAN.shapes14_7),
  // self.f = m(x, &mut (*__lent_N));
  "b75c863ba4": note("7.8.6", LEAN.shapes18_3),
  // self.f = { let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x % x } };
  "343fedd53f": note("7.2.6", LEAN.shapes10_1),
  // self.f = (self.f ^ self.f) ^ self.f;
  "b7bf67b59d": note("7.3.8", LEAN.shapes6_12),
  // pub fn m(mut x: u8) -> u8 {
  "b7cc1b2b1d": merged(["7.7.1", LEAN.shapes13_12], ["7.4.5", LEAN.shapes13_16]),
  // pub __numbers_upper_N: i32,
  "b894525f6e": note("7.7.8", LEAN.shapes13_17),
  // pub fn map(&mut self, prg: &mut Programs) -> i16 {
  "b959cb02cf": note("7.7.5", LEAN.shapes19_8),
  // pub fn call(&mut self, g: &mut Globals) {
  "b9787e0d18": note("7.7.5", LEAN.shapes15_6),
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as u8;
  "b991267156": note("7.3.1", LEAN.shapes8_3),
  // self.f = ((self.f as i32) & (self.f as i32)) as u8;
  "ba37642ce3": note("7.3.1", LEAN.shapes8_3),
  // self.f = (if self.f { Li64 } else { Li64 }) as i16;
  "ba75ffae84": note("7.2.7", LEAN.shapes10_4),
  // self.f = ((self.f as i32) | (self.f as i32)) as i16;
  "ba90e3c4fe": note("7.3.1", LEAN.shapes8_3),
  // pub fn m(&mut self, mut x: i16, …, x: &mut i16, …) -> i16 {
  "bb4c155c09": note("7.7.2", LEAN.shapes15_7),
  // self.f = (self.f as i32).min(self.f as i32) as u8;
  "bcb0fc562e": note("7.3.1", LEAN.shapes8_3),
  // pub fn init(&mut self, prg: &mut Programs) {
  "bea3694884": note("7.7.5", LEAN.shapes7_8),
  // self.f = (self.f as i32) < (self.f as i32);
  "beb0779c8f": note("7.3.3", LEAN.shapes7_2),
  // self.f = (self.f as i32) > (self.f as i32);
  "bf88572dda": note("7.3.3", LEAN.shapes7_2),
  // self.sum = (self.sum as i32).wrapping_add(self.f[((self.f as i64) - Li64) as usize].f as i32) as i16;
  "bff12f96c5": merged(["7.3.1", LEAN.shapes16_6], ["7.2.14", LEAN.shapes16_7]),
  // pub fn replace(mut x: IecString<L>, …, mut x: i16, mut p: i16) -> IecString<L> {
  "c001fbb3b1": note("7.4.6", LEAN.shapes16_11),
  // pub fn m(&mut self, mut p: usize, x: &mut i16) -> i16 {
  "c0092c8e9b": note("7.7.11", LEAN.shapes19_9),
  // self.f = (self.f.f as i32).wrapping_mul(Li32) as i16;
  "c069593bcd": note("7.3.1", LEAN.shapes15_4),
  // self.f[(Li8 as i64) as usize] = Lf32;
  "c0e245211c": note("7.2.3", LEAN.shapes11_7),
  // x = (g.f as i32).wrapping_add(Li32) as i16;
  "c1a4f50099": note("7.3.1", LEAN.shapes15_4),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64
  "c1db7399d8": note("7.4.3", LEAN.shapes17_2),
  // x[(x as i64) as usize] = Lu8;
  "c2409a5969": note("7.2.14", LEAN.shapes13_7),
  // self.f = (self.v as u64).wrapping_mul(Lu64);
  "c2729b1a2a": note("7.3.10", LEAN.shapes7_5),
  // self.f = (self.f as i32).min(g.f as i32) as i16;
  "c2a92e6f4e": note("7.3.1", LEAN.shapes19_4),
  // self.f = (Lf64 - self.f).sqrt();
  "c2d750a62a": note("7.3.6", LEAN.shapes5_11),
  // self.f.f = if self.f { self.f } else { self.f };
  "c2ecf76c31": note("7.3.1", LEAN.shapes20_3),
  // x: (-Lf64),
  "c35f240db9": note("7.2.9", LEAN.shapes1_1),
  // x = x.with_char(x.wrapping_add(x) as i64, x.char_at(x as i64));
  "c45bfa2727": note("7.4.3", LEAN.shapes16_3),
  // self.f[((Li8 as i64) - Li64) as usize] = Li16;
  "c52c7994ca": note("7.2.3", LEAN.shapes11_7),
  // if x.is_nan() || !(-L..L).contains(&x) { return i64::MIN; }
  "c5844eabe9": note("7.9.1", LEAN.shapes8_2),
  // x.f = x.f;
  "c5d30c56ec": note("7.8.4", LEAN.shapes17_10),
  // match x {
  "c6322760e4": note("7.8.4", LEAN.shapes17_10),
  // self.f = { let __arg_N = Li16; { let mut x = std::mem::take(&mut prg.f); let x = x.m(prg, __arg_N); prg.f = x; x }
  "c68f0b1ef6": merged(["7.6.6", LEAN.shapes20_8], ["7.8.10", LEAN.shapes20_9]),
  // { let x = { m(x.f); i64::m(x.m(x.f)) }.wrapping_add(x as i64); let x = x.f; x.m(x, ….m()); }
  "c6dbfd854f": note("7.9.3", LEAN.shapes19_1),
  // if (self.f as i32) >= Li32 { break; }
  "c7ac9a5e64": note("7.3.3", LEAN.shapes11_16),
  // if self.__chain_value_N {
  "c7af448b33": note("7.6.1", LEAN.shapes11_11),
  // if ({ let x = self.f as i32; let x = Li32; if x == L { L } else { x % x } }) != Li32 {
  "ac94889613": note("7.2.6", LEAN.shapes11_14),
  // self.f = ((self.f as f64).sqrt() as f32) + Lf32;
  "c83ad009ae": note("7.3.6", LEAN.shapes8_8),
  // self.f = IecString::<L>::lit(x!(S, self.f).as_bytes());
  "c867edb1d3": note("7.4.2", LEAN.shapes9_1),
  // self.f = [Li16; L];
  "c8927952f2": note("7.6.4", LEAN.shapes11_12),
  // self.f = (!self.f) | self.f;
  "c8ac3c10c1": note("7.3.8", LEAN.shapes5_12),
  // pub fn m(&mut self, mut x: i16, …) -> i16 {
  "c8ca44a755": note("7.7.2", LEAN.shapes15_7),
  // x: std::array::from_fn(|_| T::new()),
  "c9c77500c6": merged(["7.8.2", LEAN.shapes2_7], ["7.8.2", LEAN.shapes2_9]),
  // self.f = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "c9cd63632c": merged(["7.3.1", LEAN.shapes9_3], ["7.3.5", LEAN.shapes9_13]),
  // self.f.call(&mut (*__lent_N));
  "ca81b2092d": note("7.8.6", LEAN.shapes18_3),
  // m(x.f);
  "ca823a2c56": merged(["7.9.3", LEAN.shapes17_1], ["7.8.4", LEAN.shapes17_10]),
  // self.f = m(L, …i16, &mut self.f, …);
  "ca94bceedc": note("7.4.5", LEAN.shapes14_8),
  // self.f = (self.f as i32).wrapping_mul(Li32).wrapping_add(self.f as i32) as i16;
  "cbab9cd013": note("7.3.1", LEAN.shapes9_3),
  // x = m(&mut x) as i32;
  "cbcde0e5de": note("7.4.6", LEAN.shapes13_15),
  // pub fn m(mut x: i32, x: &mut T) -> bool {
  "cc3063b338": note("7.7.2", LEAN.shapes15_7),
  // x = __numbers_lower_N.wrapping_mul(Li32).wrapping_add(__numbers_upper_N);
  "cc9778f81f": note("7.7.8", LEAN.shapes16_15),
  // if (self.f.f.f as i32) > Li32 {
  "cd54e9d497": note("7.3.3", LEAN.shapes14_6),
  // { let x = { m(x.f); i32::m(x.m(x.f)) }.wrapping_add(x as i32); let x = x.f; x.m(x, ….m()); }
  "ce1d8df0a5": note("7.9.3", LEAN.shapes19_1),
  // pub fn m_get(&mut self, prg: &mut Programs) -> i16 {
  "ceb0cb99a7": note("7.7.5", LEAN.shapes19_8),
  // self.f = ((self.f as i32) & (self.f as i32)) as i8;
  "ceb22698cf": note("7.3.1", LEAN.shapes8_3),
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x % x } }) as u8;
  "c98db0eb83": note("7.3.13", LEAN.shapes10_3),
  // pub fn m(&mut self, mut x: i16) -> bool {
  "d00d314ec2": note("7.7.1", LEAN.shapes18_9),
  // self.f[((self.f as i64) - Li64) as usize] = (g.f / Lu64) as u32;
  "d04295d4c8": note("7.2.3", LEAN.shapes19_3),
  // if (self.f & (!self.f)) & ((self.f as i32) < Li32) {
  "d0865e3847": note("7.5.6", LEAN.shapes15_5),
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T
  "d231c1a7e5": note("7.7.1", LEAN.shapes17_11),
  // self.f.f = (((self.f as i32) >= Li32) & ((self.f as i32) <= Li32)) | ((self.f as i32) == Li32);
  "d263b8545d": note("7.3.3", LEAN.shapes20_2),
  // x: (-f64::INFINITY),
  "d2d239250b": note("7.2.9", LEAN.shapes2_13),
  // self.f = (Li64 / Li64) as f32;
  "d365a76953": note("7.2.2", LEAN.shapes5_14),
  // self.f = (self.f as i32).wrapping_neg() as u16;
  "d379abfe6a": note("7.3.1", LEAN.shapes7_3),
  // self.f = Li64.wrapping_sub(Li64) as i8;
  "d46e26c2aa": note("7.2.2", LEAN.shapes7_1),
  // x: { let mut v = T::new(); v.f = { let mut v = T::new(); v.f = Li16; v }; v.f = Li16; v },
  "d5d625ee73": note("7.8.3", LEAN.shapes3_7),
  // self.f = (self.f as i32).wrapping_add(Li32) as u8;
  "d67dd34190": note("7.3.1", LEAN.shapes8_3),
  // x[(x as i64).wrapping_sub(__line_lower_N as i64) as usize].f = x as i16;
  "d8a5dd49a9": note("7.2.3", LEAN.shapes20_12),
  // if !((x.wrapping_add(x) < Li32) & ((x.char_at(x as i64) as i32) != Li32)) { break; }
  "d8b7f34852": note("7.4.4", LEAN.shapes16_5),
  // self.f = (self.f as i32) == Li32;
  "d99adbcc4b": note("7.3.3", LEAN.shapes14_6),
  // self.f = (self.f as i32).wrapping_neg() as i8;
  "d9d76a4055": note("7.3.1", LEAN.shapes7_3),
  // self.f = self.f.with_char(Li8 as i64, Lu8);
  "da046bfcbb": merged(["7.4.3", LEAN.shapes15_2], ["7.2.3", LEAN.shapes15_3]),
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: usize, mut x: i16, …, x: &mut IecString<T>, …) {
  "db57faba5d": note("7.7.1", LEAN.shapes17_11),
  // self.f = (self.char as i32).wrapping_add(self.f as i32) as i16;
  "dbc172da6a": note("7.3.1", LEAN.shapes9_3),
  // pub fn len(mut str: IecString<L>) -> i16 {
  "dbcd1088a5": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // x = x;
  "dbdc75774e": note("7.4.4", LEAN.shapes12_6),
  // self.f = match self.f { L => self.f.m_get(), _ => panic!(S) };
  "dc1e3df820": note("7.8.7", LEAN.shapes19_6),
  // self.f.f = IecString::<L>::lit(B);
  "dc277bd73f": note("7.4.2", LEAN.shapes2_6),
  // pub fn m(&mut self) -> IecString<L> {
  "dc8437c26a": note("7.7.3", LEAN.shapes18_10),
  // self.f.m(&IecWString::<L>::lit(&[Lu16, …]));
  "dc950bfb03": note("7.4.8", LEAN.shapes2_6),
  // pub fn m(mut x: i32, x: &mut f64) -> i32 {
  "dd28a02e7e": note("7.7.9", LEAN.shapes19_2),
  // fn m(x: usize) { if x == L { panic!(S); } }
  "dd94ff18a2": note("7.9.3", LEAN.shapes2_14),
  // pub x: bool,
  "de132e5019": note("7.6.1", LEAN.shapes1_5),
  // let x = if v < L { -((-v).round()) } else { v.round() };
  "de283d0ef6": note("7.9.1", LEAN.shapes8_1),
  // if !((x < x) & (x < x)) { break; }
  "de2f16610e": note("7.5.7", LEAN.shapes14_7),
  // self.f = self.f.wrapping_shr(Li16 as u32) as u32;
  "de956f2a12": note("7.2.5", LEAN.shapes8_4),
  // self.f = len(self.v.to::<L>());
  "dea089f2fd": note("7.4.6", LEAN.shapes14_18),
  // self.f = (self.f as i32).max(Li32).min(self.f as i32) as i16;
  "deaa2bbf15": note("7.2.7", LEAN.shapes8_6),
  // self.f.__numbers_upper_N = self.__numbers_upper_N;
  "debabdec0d": note("7.2.3", LEAN.shapes15_13),
  // pub fn m(&mut self, x: &mut i16) -> i16 {
  "dfc9d07c2c": note("7.7.2", LEAN.shapes15_7),
  // { let x = ({ m(x.f); i16::m(x.m(x.f)) } as i32).wrapping_add(x as i32) as i16; let x = x.f; x.m(x, ….m()); }
  "dfe7ec241e": note("7.9.3", LEAN.shapes19_1),
  // self.f.clamp();
  "e007ef42d8": merged(["7.7.2", LEAN.shapes3_9], ["7.3.1", LEAN.shapes3_10]),
  // self.f[(Li8 as i64) as usize] = Li16;
  "e02b80c3c1": note("7.2.3", LEAN.shapes11_7),
  // self.f = ((self.f as i32) | (self.f as i32)) as i8;
  "e1456a0eae": note("7.3.1", LEAN.shapes8_3),
  // self.f.f.m(&IecWString::<L>::lit(&[Lu16, …]));
  "e19e17485d": note("7.4.8", LEAN.shapes15_12),
  // if (self.f as i32) <= Li32 { break; }
  "e2e0d67858": note("7.3.3", LEAN.shapes11_16),
  // x = __values_upper_N.wrapping_mul(Li32) as i64;
  "e37b53617c": note("7.2.3", LEAN.shapes15_13),
  // self.f = m(self.f as f64) as i16;
  "e3e3555f9c": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // { let mut x = std::mem::take(&mut prg.f); x.f.call(prg); prg.f = x; }
  "e436b886c1": note("7.8.10", LEAN.shapes20_9),
  // x = L;
  "e496034f7b": note("7.9.3", LEAN.shapes12_9),
  // x: { let mut v = T::new(); v.f = Lf32; v },
  "e4b6325c44": note("7.8.3", LEAN.shapes2_8),
  // if ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 { break; }
  "e6075a580f": merged(["7.4.4", LEAN.shapes16_2], ["7.4.4", LEAN.shapes16_5], ["7.2.4", LEAN.shapes16_10]),
  // let mut x: IecString<L> = IecString::<L>::lit(B);
  "e6646a0bd0": note("7.4.7", LEAN.shapes15_11),
  // x = x.wrapping_add(Li32) as i16;
  "e6ef5a4585": note("7.3.1", LEAN.shapes14_4),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), x[(x as i64) as usize]));
  "e6fd2dc9fd": note("7.4.3", LEAN.shapes17_2),
  // self.f = (self.f as i32).max(g.f as i32) as i16;
  "e708298af7": note("7.3.1", LEAN.shapes19_4),
  // self.f = IecString::<L>::lit((if self.v { S } else { S }).as_bytes());
  "e763b5dd7a": note("7.4.2", LEAN.shapes9_1),
  // { let x = false; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "e76a0c7276": note("7.8.5", LEAN.shapes20_13),
  // if x > x.wrapping_sub(x) { break; }
  "e798927653": note("7.5.7", LEAN.shapes14_7),
  // self.f = (self.f as i32).wrapping_mul(Li32) as i16;
  "e7b84e4a19": note("7.3.1", LEAN.shapes8_3),
  // x = ((*x).m() as i32).wrapping_add(x.f as i32) as i16;
  "e7c2f94b63": merged(["7.3.1", LEAN.shapes15_4], ["7.8.6", LEAN.shapes15_9]),
  // self.f = ({ let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x % x } }) as u32;
  "620a4b6145": note("7.2.6", LEAN.shapes10_1),
  // self.f.f = (self.f as i32) == Li32;
  "e7e1a63970": note("7.3.3", LEAN.shapes14_6),
  // self.__chain_value_N = self.f;
  "e7e871371f": note("7.6.1", LEAN.shapes5_7),
  // self.units = len(self.narrow.to::<L>());
  "e8162bb9aa": note("7.4.6", LEAN.shapes14_18),
  // pub fn fb_init(&mut self, mut x: bool) -> bool {
  "e82fbd8112": note("7.7.1", LEAN.shapes2_11),
  // x: Lu32,
  "e8954e2b0d": merged(["7.2.8", LEAN.shapes4_1], ["7.2.11", LEAN.shapes4_2], ["7.2.11", LEAN.shapes1_10]),
  // if self.f > self.f.m() { break; }
  "e8a1222ae6": note("7.5.7", LEAN.shapes14_7),
  // if ({ m(x); *__str_pst_N }.char_at(((x as i64).wrapping_sub(Li64) / Li64).wrapping_add(x as i64)) as i32) == Li32 
  "e9a5cabd36": note("7.3.9", LEAN.shapes17_12),
  // self.copied = self.copied;
  "ea53989ac8": note("keep:`x := x` stays ALLOWED self_assignment (7.8.9 moves this text into that reason); removed by 7.11.1", LEAN.shapes11_20),
  // if ((x == L) | (x == L)) | ((x as i32) == Li32) {
  "ea6f85988f": note("7.5.6", LEAN.shapes15_5),
  // x = x[((Li8 as i64) - Li64) as usize];
  "eb533b340b": note("7.2.3", LEAN.shapes14_2),
  // self.f = self.f.f[((Li8 as i64) - Li64) as usize].f.f;
  "ebc60e2668": note("7.2.3", LEAN.shapes11_7),
  // if (x == L) | (x == L) {
  "ec21aafede": note("7.5.6", LEAN.shapes13_13),
  // x: (-Li16),
  "ec9a760059": note("7.2.9", LEAN.shapes1_1),
  // *x = ((x as i32) / (x as i32)) as i16;
  "ed3ad19a47": note("7.3.11", LEAN.shapes14_5),
  // pub fn m_set(&mut self, prg: &mut Programs, mut x: i16) {
  "ed425c8710": note("7.7.5", LEAN.shapes19_8),
  // self.f = (self.f as i32).wrapping_mul(Li32) as u16;
  "ed846b075d": note("7.3.1", LEAN.shapes8_3),
  // if x > __grid_upper_N { break; }
  "ed880b92a8": merged(["7.5.7", LEAN.shapes14_7], ["7.5.7", LEAN.shapes14_15]),
  // self.f = self.__chain_value_N as f32;
  "ee5f8f4ae1": note("7.6.1", LEAN.shapes6_8),
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x % x } }) as i8;
  "3dc2dda225": note("7.3.13", LEAN.shapes10_3),
  // self.f = m((self.narrow * Lf32) as f64);
  "eeb4929f34": note("7.9.1", LEAN.shapes14_13),
  // self.f = (self.v as u64) as u32;
  "eeb7e2463d": note("7.3.9", LEAN.shapes5_9),
  // m(L, &mut self.f);
  "ef4db7eb51": merged(["7.4.4", LEAN.shapes12_6], ["7.9.3", LEAN.shapes12_9]),
  // g.f.count = (g.f.count as i32).wrapping_add(g.f as i32) as i16;
  "eff90824ac": note("7.3.1", LEAN.shapes19_10),
  // (*x).call();
  "f0065dbd0b": note("7.8.6", LEAN.shapes12_5),
  // self.f.__numbers_lower_N = Li32;
  "f06209ef9e": note("7.5.7", LEAN.shapes14_15),
  // x[(x as i64).wrapping_sub(__grid_lower_N as i64) as usize][(x as i64).wrapping_sub(__grid_lower_N as i64) as usize
  "f07cf2da87": note("7.2.3", LEAN.shapes17_3),
  // x[(x.wrapping_add(x) as i64) as usize] = x[(x.wrapping_add(x) as i64) as usize];
  "f10c6b31a0": note("7.2.14", LEAN.shapes16_7),
  // self.f = (self.f & (self.f | (self.f & (!self.f)))) | (self.f ^ self.f);
  "f22b4df758": note("7.5.6", LEAN.shapes9_12),
  // self.f = true as u8;
  "f2987aca6a": note("7.2.10", LEAN.shapes3_11),
  // pub fn m(&mut self, mut x: i16, …) {
  "f327cfe40a": note("7.7.1", LEAN.shapes18_9),
  // self.f = ((self.f as i32) ^ (self.f as i32)) as u16;
  "f35183a6a9": note("7.3.1", LEAN.shapes8_3),
  // if (len as i32) > Li32 {
  "f39a4e5fb5": note("7.3.3", LEAN.shapes13_14),
  // x as i64
  "f44fb59407": note("7.9.1", LEAN.shapes3_8),
  // self.f = self.f & (!self.f);
  "f474d0ca12": note("7.3.8", LEAN.shapes5_12),
  // pub x: [u64; L],
  "f4a4eb1ade": note("7.8.2", LEAN.shapes17_8),
  // self.f[((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i6
  "f59561bd3c": note("7.2.3", LEAN.shapes12_2),
  // self.f = (Li64 / Li64) as f64;
  "f5a6eb5ecf": note("7.2.2", LEAN.shapes5_14),
  // pub fn m(mut x: IecString<L>, …) -> i16 {
  "f5ca982c14": merged(["7.7.2", LEAN.shapes15_7], ["7.7.2", LEAN.shapes15_14]),
  // pub fn m(&mut self, g: &mut Globals) -> i16 {
  "f62e4d99a5": note("7.7.5", LEAN.shapes15_6),
  // (*x).m(&{ m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_sub(x).wrapping_add(Li32).max(
  "f6f7b781df": note("7.4.3", LEAN.shapes17_2),
  // pub fn m(mut x: i8) -> bool {
  "f75c7acc4a": note("7.7.1", LEAN.shapes13_12),
  // { let x = ({ m(x.f); i8::m(x.m(x.f)) } as i32).wrapping_add((x as i8) as i32) as i8; let x = x.f; x.m(x, ….m()); }
  "f7cd52625c": note("7.9.3", LEAN.shapes20_15),
  // m(self.p);
  "f7ea0fc7a1": merged(["7.2.4", LEAN.shapes11_1], ["7.2.4", LEAN.shapes11_2], ["7.9.3", LEAN.shapes11_3], ["7.9.3", LEAN.shapes11_4]),
  // pub fn m(x: &mut T, mut x: i32, mut x: i16, mut x: usize) -> bool {
  "f7ee3854dd": note("7.7.9", LEAN.shapes19_2),
  // self.f = m(-Li32, …, &mut self.f);
  "f7faf582da": note("7.5.7", LEAN.shapes14_15),
  // self.f = (self.v / Lu64).wrapping_sub({ let x = self.v / Lu64; let x = Lu64; if x == L { L } else { x % x } }) as u
  "36ff4319d8": merged(["7.2.6", LEAN.shapes10_1], ["7.2.6", LEAN.shapes10_2]),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Li16 << L) } else { *x & !(Li16 << L) }; }
  "f85632e185": note("7.8.5", LEAN.shapes20_13),
  // self.f = m(self.f, Lf32);
  "f8b810062b": note("7.2.6", LEAN.shapes4_8),
  // x: std::array::from_fn(|_| [Li16; L]),
  "f9bdd4950a": note("7.8.2", LEAN.shapes2_7),
  // pub fn init(&mut self) {
  "fa7d5f176f": note("7.7.2", LEAN.shapes2_12),
  // self.f = (if false { Li64 } else { Li64 }) as i16;
  "faa5102f23": note("7.2.7", LEAN.shapes10_4),
  // let mut map: i16 = Li16;
  "faf5605030": note("7.7.3", LEAN.shapes18_10),
  // self.m();
  "fb7e9e6ff4": note("keep:the call itself is correct and lean (its allow-attribute waste is 7.7.2's); removed by 7.7.10", LEAN.shapes8_10),
  // __chain_value_N: Lf64,
  "fbbfa869cf": note("7.6.1", LEAN.shapes4_6),
  // x: L,
  "fbde4d6e1e": note("7.8.8", LEAN.shapes1_8),
  // self.f = (self.f.f as i32).wrapping_add(self.f.f as i32) as i16;
  "fbfd8ba027": note("7.3.1", LEAN.shapes16_6),
  // self.f[(Li8 as i64) as usize] = (self.f[(Li8 as i64) as usize] as i32).wrapping_add(Li32) as i16;
  "fcc10694ff": note("7.2.3", LEAN.shapes12_2),
  // if self.f > self.__numbers_upper_N { break; }
  "fd16368fa8": note("7.2.3", LEAN.shapes15_13),
  // pub fn m_set(&mut self, mut x: i16) {
  "fda03fa84f": note("7.7.3", LEAN.shapes14_14),
  // pub fn x<const T: usize>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T>) 
  "fdb004dd33": note("7.7.1", LEAN.shapes17_11),
  // self.f = self.f.sqrt() as f32;
  "fdc2e175fa": note("7.3.6", LEAN.shapes5_11),
  // self.f = (self.f.wrapping_shr(Li16 as u32) & Lu32) != Lu32;
  "fdfbae2680": note("7.2.5", LEAN.shapes8_4),
  // fn m(v: f64) -> i64 {
  "fe6af35845": note("7.9.1", LEAN.shapes4_4),
  // self.f = m(Li32, …, &mut self.f);
  "fedbbc431c": note("7.5.7", LEAN.shapes14_15),
  // self.f = m(Li32.wrapping_neg() as i16);
}
