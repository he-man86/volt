> **Status: UNVERIFIED candidates. Do NOT apply before `transpile-review-2026-09-29`'s fixes land.** Each group
> below changes the emitted Rust of many fixtures (hundreds, for groups 1-4). Applied first, it would reshuffle every
> shape the review's red tests pin, and it would mix "same value, shorter code" diffs into correctness diffs.
> Nothing here fixes a wrong value; nothing here was reproduced beyond the probe that noticed it. Each group must
> prove "byte-identical program output on the whole corpus" (fixtures.test.ts + the review's differential harness)
> before and after.

## Why

The overnight review (2026-09-29) measured the emitted Rust against what a good Rust engineer would write:

- **Lints** (`-W clippy::all`): 45,655 findings across 41 lints; only 5 of 2333 files are clean. Roughly 20k of them
  come from the prelude, which 521 fixtures carry whole.
- **Size:** median 3.14 and mean 3.45 Rust lines per ST line.
  - The string fixtures are worst, at 20-38x.
  - Every FOR header costs 10 lines.
  - `state_any_int_pointer_increment` costs 20 lines for one ST line.
- **LEAN items:** 340 were reported. They deduplicate into the 10 groups below.

The same ST construct is often emitted two ways. Two examples:

- `x := x + 1` is `x.wrapping_add(1i16)` as a FOR step but `(x as i32).wrapping_add(1i32) as i16` in a body.
- A negative literal is `(-1i8)` in an initializer but `1i32.wrapping_neg() as u8` in a statement.

## What Changes

The groups are ranked by payoff against risk. Payoff is Rust shrink, lints removed and transpiler LOC saved.

| # | Group | Evidence (lint / size) | Risk |
|---|---|---|---|
| 1 | Prelude on demand | dead_code 5627 (5594 unused prelude helpers); uninlined_format_args 4168, format_push_string 1042, many_single_char_names / return_self_not_must_use / bool_to_int_with_if ~521 each, and 1563 must_use_candidate: all prelude; ~60-110 dead lines per string POU | low |
| 2 | Fold constants in lowering | unreadable_literal 3547 (in part); ~67 `N.wrapping_neg()` literals, ~62 cast-chain constant indices, constant ADR tags, `1i8 as u32` shift counts, guarded MOD/`iec_div` by nonzero literals, `9i64.min(2i64) as i16`, constant TRUNC/SEL/MUX | low |
| 3 | Narrow arithmetic and comparisons | cast_possible_truncation 5621, cast_sign_loss 4315, cast_lossless 4179 (the `(x as i32).wrapping_add(L) as i16` shape, 340 statements, the most common line in the corpus) | medium |
| 4 | String copies | ~472 `lit(..).to()` + 101 `.to::<N>().to()` double copies; `with_char(..).to()` = 2-3 whole-string copies per character store; a cursor read copies the whole IecStr per character (O(n·N) loops); duplicate library variants per string capacity; size tops are all string fixtures (38.0, 35.7, 29.2 …) | low-medium |
| 5 | Loop shape | manual_assert 1474 and part of unreadable_literal (loop cap `if __iter > 1000000 { panic! }`); 10 lines per FOR header; collapsible_else_if 19 (+ ~783 nested ELSIF blocks); needless_bitwise_bool 161; bare body block per loop | medium (depends on review task 27) |
| 6 | Temporaries as locals | pub_underscore_fields 58 (`__chain_value_N`, `__property_N`, `__output_N`, `__inout_index_N` as persistent pub struct fields); VAR_TEMP as fields reset per call | low-medium |
| 7 | Routine signatures | must_use_candidate 6492 (4704 on `pub fn new()`), missing_const_for_fn 3924 (`new`/`call`), missing_panics_doc 1358; blanket `#[allow(unused_mut, unused_variables, unused_assignments)]` on 438 files; `mut` on every input; dead pointer params; ARRAY[*] upper bounds passed; `prg` threaded and `std::mem::take` of whole programs per call; ANY diSize passed at run time | medium |
| 8 | Derives and aggregate syntax | derive_partial_eq_without_eq 1473; struct `.clone()` where Copy works; `{ let mut v = T::new(); v.f = …; v }` → struct-update; `std::array::from_fn` for Copy elements; unions via `to_le_bytes`/`from_le_bytes`; bit stores as `|=`/`&= !`; `(*x)`/`&mut (*x)` deref noise; `(match …);` (unnecessary_semicolon 9) | low |
| 9 | Prelude helpers | `iec_r2i64/32`'s sign branch = `v.round()`; TRUNC inlined 38× → one helper; `iec_deref` as `assert_ne!`; `iec_*_text` allocate a String then copy | low |
| 10 | Transpiler source cleanup | 5 EXTENDS-chain walks → 1 (~20 LOC), `holdsFbInit`/`reaches` → 1 walk (~10), const-eval foldBigInt/foldNumber → 1 typed fold (~20), orphan docs and empty banners (~25), duplicated convert rule interp/evaluate | low |

Estimated effect if all land:

- The prelude-driven ~20k lint findings disappear (group 1).
- The cast lints drop by most of their ~14k (group 3).
- Median Rust/ST falls well below 3 (groups 2-5).
- String-fixture ratios roughly halve (group 4).
- The transpiler loses ~100 LOC (group 10).

## Order and coupling

- Group 2 overlaps review tasks 5/6/7 (literal typing). Do it after them, on the corrected IR.
- Group 3 must keep DIV, MOD, comparisons with mixed sign, shifts and any wider store promoted. The review's task 1
  changes which meet type is "narrow".
- Group 4 must follow review task 34 (the n+1 byte string model). Otherwise it optimizes a model that is about to change.
- Group 5 follows review task 27 (loop cap). If the cap leaves the emitted semantics, most of group 5 comes for free.
- Groups 1, 8, 9 and 10 are independent and can go in any order after the review.

## Impact

- Emitted Rust of nearly every fixture changes. `map.generated.ts` shapes regenerate, and lint and size baselines move.
- The ALLOWED lint list in `support/transpile-confidence.ts` can shrink (dead_code, unused_mut, unused_variables,
  unused_assignments) once groups 1 and 7 land.
- No IR semantics change is intended. Group 2 moves folding into lowering, which the interpreter shares.

## Close-out (2026-10-02, archived unapplied)

**Superseded by `transpile-restructure`: every lean group is a task there; nothing implemented here.** No task in
`tasks.md` was started. The spec delta was removed before archiving: its requirement ("one ST construct has one
shortest emitted form") describes an emitter that was never built, and archiving it would file a false requirement.
The groups, their evidence and their ordering constraints live on as `transpile-restructure` tasks.
