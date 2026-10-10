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
  // m(Li32, &mut (*x));
  "01e84968c3": note("7.8.6", LEAN.shapes12_5),
  // x: { let mut v = T::new(); v.f = { let mut v = T::new(); v.f = L; v }; v.f = L; v },
  "04beb1d55a": note("7.8.3", LEAN.shapes3_7),
  // self.f = f64::m(self.f).exp() as f32;
  "84845bb684": note("keep:f32::exp differs from the f64 round trip on 23,280 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // { let x = true; let x = &mut self.f.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "0a1967fcea": note("7.8.5", LEAN.shapes20_13),
  // self.m(&mut (*x));
  "0b51d542e8": note("7.8.6", LEAN.shapes2_5),
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
  // while ((if self.f { -Li16 } else { Li16 }) >= Li16 && self.f <= self.f) || ((if self.f { -Li16 } else { Li16 }) < L
  "098f7b0911": note("keep:niche: accepted loss (2 occurrences in the corpora; the IR has no binding a pass could hold the step in short of a struct field, which is more Rust, not less — 7.5.9)", LEAN.shapes11_8),
  // v: L,
  "667cafe298": note("7.8.8", LEAN.shapes6_2),
  // x: { let mut v = T::new(); v.f = L; v.f = L; v },
  "705d69973b": note("7.8.3", LEAN.shapes2_8),
  // { let x = self.f; let x = &mut self.f; *x = if x { *x | (Lu32 << L) } else { *x & !(Lu32 << L) }; }
  "1985d03764": note("7.8.5", LEAN.shapes20_13),
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> u8 {
  "1dec9ffb7e": note("7.8.6", LEAN.shapes16_14),
  // self.f = len(self.f.to::<L>());
  "21ef64a1e0": note("7.4.6", LEAN.shapes14_18),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u16;
  "30c4deeec9": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f = f64::m(self.f).sin() as f32;
  "d47543941e": note("keep:f32::sin differs from the f64 round trip on 2,866,998 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f = match self.f { L => (*__lent_N).m(), _ => panic!(S) };
  "26bfea40dc": note("7.8.7", LEAN.shapes19_6),
  // self.f = m(f64::m(self.f)).ln() as f32;
  "7eff84bf36": note("keep:f32::ln differs from the f64 round trip on 210,637 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
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
  // self.f = self.f.clone();
  "39e68c53af": note("7.8.2", LEAN.shapes2_9),
  // (match self.f { L => self.f.m_set(Li16), _ => panic!(S) });
  "decdb7e4d6": note("7.8.7", LEAN.shapes20_14),
  // if m(x, …, false, &mut (*x), &mut (*x)) {
  "3d7b4a7836": note("7.8.6", LEAN.shapes15_9),
  // self.p = L;
  "45292dbd9c": note("7.8.8", LEAN.shapes1_8),
  // if len(self.f.f[self.f as usize].to::<L>()) > self.f {
  "8b4fc46c1e": note("7.4.6", LEAN.shapes16_11),
  // self.f = match self.f { L => (*__lent_N).take(Li16), _ => panic!(S) };
  "4b5007906a": note("7.8.7", LEAN.shapes20_14),
  // self.f = (*x).m();
  "52d85b7cdc": note("7.8.6", LEAN.shapes12_5),
  // pub ops: [u64; L],
  "572db4e711": note("7.8.2", LEAN.shapes17_8),
  // self.f = match self.f { L => self.f.m(), _ => panic!(S) };
  "59c341cb0f": note("7.8.7", LEAN.shapes19_6),
  // (match self.f.f { L => self.f.m(&mut self.f), L => self.f.m(&mut self.f), _ => panic!(S) });
  "5ed54bb657": note("7.8.7", LEAN.shapes20_14),
  // p: L,
  "75cc82a569": note("7.8.8", LEAN.shapes1_8),
  // x = i32::m(m(&mut str));
  "50ff398988": note("7.4.6", LEAN.shapes13_15),
  // self.f.call(&mut (*x));
  "8064ae1570": note("7.8.6", LEAN.shapes13_9),
  // self.f = match self.f { L => (*__lent_N).m(), L => (*__lent_N).m(), _ => panic!(S) };
  "82e802ebc9": note("7.8.7", LEAN.shapes20_14),
  // self.f = m(f64::m(self.f)) as u32;
  "e0361c9257": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu8 << L) } else { *x & !(Lu8 << L) }; }
  "87cd3925f5": note("7.8.5", LEAN.shapes20_13),
  // self.f = len(self.narrow.to::<L>());
  "8986d5305c": note("7.4.6", LEAN.shapes14_18),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i16;
  "756ba59393": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f = m(f64::m(self.f)) as u16;
  "9479f0e3c4": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // self.f = match self.f { L => self.f.m(Li16), _ => panic!(S) };
  "96bf43c1e7": note("7.8.7", LEAN.shapes19_6),
  // (match self.f { L => self.f.m(), L => self.f.m(), _ => panic!(S) });
  "9831f2d691": note("7.8.7", LEAN.shapes20_14),
  // while (*str).char_at(i64::m(x)) != Lu8 {
  "e5f32531ef": note("7.8.6", LEAN.shapes15_9),
  // if m(x, …, true, &mut (*x), &mut (*x)) {
  "9a63db2a45": note("7.8.6", LEAN.shapes14_9),
  // (match self.f.f { L => self.f.m(&mut self.v), _ => panic!(S) });
  "9fbd098efb": note("7.8.7", LEAN.shapes3_12),
  // self.narrow.m(&self.f.narrow::<L>());
  "a1c2206655": note("7.4.6", LEAN.shapes16_11),
  // ops: std::array::from_fn(|_| L),
  "a65506e4d8": note("7.8.2", LEAN.shapes18_8),
  // x: { let mut v = T::new(); v.f = IecString::<L>::lit(B); v.f = IecString::<L>::lit(B); v },
  "a7ca9e8349": note("7.8.3", LEAN.shapes16_13),
  // self.f.f = self.f.clone();
  "ac452bc801": note("7.8.1", LEAN.shapes13_11),
  // self.f = L;
  "ad25627749": note("7.8.8", LEAN.shapes1_8),
  // self.f = m(self.f).log10() as f32;
  "b07338e4d9": note("keep:f32::log10 differs from the f64 round trip on 2,418,508 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f = T::new();
  "b3e78a179a": note("7.6.4", LEAN.shapes11_12),
  // self.f = f64::m(self.f).cos() as f32;
  "1671a3249d": note("keep:f32::cos differs from the f64 round trip on 2,876,136 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // { let mut __copy_N = self.f.clone(); self.m(Li16, Li32, &mut __copy_N); self.f = __copy_N; };
  "78bb74e841": note("7.8.10", LEAN.shapes20_9),
  // self.f = m(x, &mut (*__lent_N));
  "b75c863ba4": note("7.8.6", LEAN.shapes18_3),
  // x.f = x.f;
  "c5d30c56ec": note("7.8.4", LEAN.shapes17_10),
  // self.f = [Li16; L];
  "c8927952f2": note("7.6.4", LEAN.shapes11_12),
  // x: std::array::from_fn(|_| T::new()),
  "c9c77500c6": merged(["7.8.2", LEAN.shapes2_7], ["7.8.2", LEAN.shapes2_9]),
  // self.f.call(&mut (*__lent_N));
  "ca81b2092d": note("7.8.6", LEAN.shapes18_3),
  // m(x.f);
  "ca823a2c56": note("7.8.4", LEAN.shapes17_10),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u8;
  "62891f3570": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f = match self.f { L => self.f.m_get(), _ => panic!(S) };
  "dc1e3df820": note("7.8.7", LEAN.shapes19_6),
  // self.f = len(self.v.to::<L>());
  "dea089f2fd": note("7.4.6", LEAN.shapes14_18),
  // self.f = m(f64::m(self.f)) as i16;
  "0a552281ae": note("keep:iec_r2i32 then a narrowing cast is correct against all 192 measured REAL→int cells", LEAN.shapes6_11),
  // { let x = false; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "e76a0c7276": note("7.8.5", LEAN.shapes20_13),
  // self.units = len(self.narrow.to::<L>());
  "e8162bb9aa": note("7.4.6", LEAN.shapes14_18),
  // self.copied = self.copied;
  "ea53989ac8": note("keep:`x := x` stays ALLOWED self_assignment (7.8.9 moves this text into that reason); removed by 7.11.1", LEAN.shapes11_20),
  // *x = (i32::m(x) / i32::m(x)) as i16;
  "d96bb286f4": note("keep:the promoted division is the measured rule (MIN / -1 wraps in SINT/INT, computed in DINT); a narrow wrapping_div gives the same values but needs a narrow node that does not trap where the promoted one does not, and the interpreter has none (7.3.11)", LEAN.shapes14_5),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i8;
  "e19d1f70e4": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // (*x).call();
  "f0065dbd0b": note("7.8.6", LEAN.shapes12_5),
  // pub x: [u64; L],
  "f4a4eb1ade": note("7.8.2", LEAN.shapes17_8),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Li16 << L) } else { *x & !(Li16 << L) }; }
  "f85632e185": note("7.8.5", LEAN.shapes20_13),
  // x: L,
  "fbde4d6e1e": merged(["7.8.8", LEAN.shapes1_8], ["7.8.11", LEAN.shapes6_4]),
  // m(&mut str) as i16
  "07f99bf907": merged(["7.4.6", LEAN.shapes13_15], ["7.4.6", LEAN.shapes12_11]),
  // len((*x).to::<L>())
  "6baa8553b3": note("7.8.6", LEAN.shapes18_3),
  // m(__values_lower_N, &mut (*x)).wrapping_add(__values_lower_N.wrapping_add(x.len() as i32).wrapping_sub(Li32))
  "539fa9c4b6": note("7.8.6", LEAN.shapes20_11),
  // m(m(x, …, p), x, i32::m(p).wrapping_sub(Li32).max(Li32) as i16)
  "1c82d4c275": note("7.4.6", LEAN.shapes12_11),
  // pub fn x<const T: usize>(p: usize, x: &mut IecString<T>) -> u8 {
  "902af64a6e": note("7.8.6", LEAN.shapes16_14),
  // (*x).wrapping_mul(Li16)
  "dab457c859": note("7.8.6", LEAN.shapes15_9),
  // pub fn x<const T: usize>(x: usize, x: &mut IecString<T>) -> i32 {
  "6fa8630036": note("7.8.6", LEAN.shapes16_14),
  // let mut x: i32 = m(x, &mut (*x)).wrapping_sub(Li32);
  "1290a83593": note("7.8.6", LEAN.shapes14_9),
  // (*x).wrapping_add(*x)
  "984b4e6862": note("7.8.6", LEAN.shapes15_9),
  // let x: i32 = m(x, &mut (*x));
  "3a4f1a7d74": note("7.8.6", LEAN.shapes13_9),
  // pub fn m(mut str: IecString<L>, x: i16) -> IecString<L> {
  "aba7498096": note("7.4.6", LEAN.shapes16_11),
  // pub fn m(mut str: IecString<L>, len: i16, x: i16) -> IecString<L> {
  "4567b70381": note("7.4.6", LEAN.shapes16_11),
  // pub fn m(mut x: IecString<L>, …, x: i16) -> IecString<L> {
  "3eb9cb867d": note("7.4.6", LEAN.shapes16_11),
  // pub fn replace(x: IecString<L>, …, x: i16, p: i16) -> IecString<L> {
  "30fdd454d9": note("7.4.6", LEAN.shapes16_11),
  // pub fn m(&mut self, x: &mut i16) -> i16 {
  "dfc9d07c2c": note("7.7.11", LEAN.shapes19_9),
  // let x: i32 = i32::m(m(&mut x));
  "b0547ad22e": note("7.4.6", LEAN.shapes13_15),
  // (*x).m().wrapping_add(x.f)
  "4b2bb56a21": note("7.8.6", LEAN.shapes15_9),
  // x = L;
  "e496034f7b": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // m(L, &mut self.f);
  "ef4db7eb51": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // *x
  "410eafc2ba": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // { m(x); x }
  "cc1c266f50": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
}
