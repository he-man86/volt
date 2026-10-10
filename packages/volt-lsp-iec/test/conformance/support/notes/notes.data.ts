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
  // self.f = f64::m(self.f).exp() as f32;
  "84845bb684": note("keep:f32::exp differs from the f64 round trip on 23,280 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f.f[L] = (u64::m(self.f.f) % Lu64) as u8;
  "a281b5efbd": note("7.8.4", LEAN.shapes3_1),
  // while ((if self.f { -Li16 } else { Li16 }) >= Li16 && self.f <= self.f) || ((if self.f { -Li16 } else { Li16 }) < L
  "098f7b0911": note("keep:niche: accepted loss (2 occurrences in the corpora; the IR has no binding a pass could hold the step in short of a struct field, which is more Rust, not less — 7.5.9)", LEAN.shapes11_8),
  // v: L,
  "667cafe298": note("7.8.8", LEAN.shapes6_2),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u16;
  "30c4deeec9": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f = f64::m(self.f).sin() as f32;
  "d47543941e": note("keep:f32::sin differs from the f64 round trip on 2,866,998 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f = m(f64::m(self.f)).ln() as f32;
  "7eff84bf36": note("keep:f32::ln differs from the f64 round trip on 210,637 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f.f[L] = (u64::m(self.f.f) / Lu64 % Lu64) as u8;
  "3f8601dd97": note("7.8.4", LEAN.shapes3_1),
  // self.f = self.f.wrapping_add(if self.f { -Li16 } else { Li16 });
  "90ad40cc20": note("keep:niche: accepted loss (2 occurrences in the corpora; the IR has no binding a pass could hold the step in short of a struct field, which is more Rust, not less — 7.5.9)", LEAN.shapes11_8),
  // self.p = L;
  "45292dbd9c": note("7.8.8", LEAN.shapes1_8),
  // p: L,
  "75cc82a569": note("7.8.8", LEAN.shapes1_8),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i16;
  "756ba59393": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // self.f = L;
  "ad25627749": note("7.8.8", LEAN.shapes1_8),
  // self.f = m(self.f).log10() as f32;
  "b07338e4d9": note("keep:f32::log10 differs from the f64 round trip on 2,418,508 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // self.f = T::new();
  "b3e78a179a": note("7.6.4", LEAN.shapes11_12),
  // self.f = f64::m(self.f).cos() as f32;
  "1671a3249d": note("keep:f32::cos differs from the f64 round trip on 2,876,136 of the 2^32 REAL inputs (exhaustive, this platform's libm, 2026-10-10; 7.3.12)", LEAN.shapes6_10),
  // x.f = x.f;
  "c5d30c56ec": note("7.8.4", LEAN.shapes17_10),
  // self.f = [Li16; L];
  "c8927952f2": note("7.6.4", LEAN.shapes11_12),
  // m(x.f);
  "ca823a2c56": note("7.8.4", LEAN.shapes17_10),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as u8;
  "62891f3570": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // *x = (i32::m(x) / i32::m(x)) as i16;
  "d96bb286f4": note("keep:the promoted division is the measured rule (MIN / -1 wraps in SINT/INT, computed in DINT); a narrow wrapping_div gives the same values but needs a narrow node that does not trap where the promoted one does not, and the interpreter has none (7.3.11)", LEAN.shapes14_5),
  // self.f = { let x = i32::m(self.f); let x = i32::m(self.f); if x == L { L } else { x % x } } as i8;
  "e19d1f70e4": note("keep:a variable divisor stays promoted: SINT/INT MIN MOD -1 is 0, computed in DINT (6.A.3), where a narrow remainder stops the task; niche: accepted loss (11 MODs by a name in the corpora; 7.3.13)", LEAN.shapes10_3),
  // x: L,
  "fbde4d6e1e": note("7.8.8", LEAN.shapes1_8),
  // x = L;
  "e496034f7b": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // m(L, &mut self.f);
  "ef4db7eb51": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // *x
  "410eafc2ba": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
  // { m(x); x }
  "cc1c266f50": note("keep:shapes12_9's guard half - a pointer only ever stored one non-zero tag still needs a proof that a store runs before every read across scans (a persistent field starts at 0); not 7.7.7's dead parameter, which went", LEAN.shapes12_9),
}
