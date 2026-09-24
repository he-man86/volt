# Tasks

## 0. The baseline, measured before anything changed

`clippy::all` over the emitted Rust of all 1,935 `confirmed` fixtures, on the four rustc exceptions the A↔C pass
already allows (`dead_code`, `unreachable_code`, `unused_comparisons`, plus the naming lints generated code cannot
satisfy). Tier is the band the fixture's OWN body reaches — not the synthesized `PLC_PRG` that instantiates it,
which files every FB fixture under `call` on a statement no fixture wrote.

| tier | fixtures | clean | the findings on the rest |
|---|---:|---:|---|
| `decl` | 329 | 251 (76%) | `possible_missing_else` 108 · `manual_range_contains` 36 · `unused_parens` 29 · `self_assignment` 27 |
| `arith` | 1324 | 43 (3%) | `unused_parens` 2096 · `possible_missing_else` 672 · `unnecessary_cast` 548 · `manual_range_contains` 318 · `double_parens` 220 |
| `control` | 54 | 15 (28%) | `unused_parens` 72 · `nonminimal_bool` 29 · `double_parens` 6 |
| `aggregate` | 24 | 13 (54%) | `unused_parens` 37 · `double_parens` 11 · `unnecessary_cast` 10 |
| `call` | 88 | 17 (19%) | `unused_parens` 172 · `double_parens` 34 · `explicit_auto_deref` 15 |
| `indirect` | 116 | 30 (26%) | `unused_parens` 316 · `double_parens` 81 · `redundant_closure_call` 29 |
| **total** | **1935** | **369 (19%)** | |

- [x] Measure it. `1935 lowered, 0 not, in 294s` — every confirmed fixture lowers, so the map has no holes.

## 1. The map itself

- [ ] `test/conformance/support/transpile-confidence.ts` — ONE implementation, as `evidence.ts` is one:
  - [ ] `tierOf(pou, ownPouName)` — the band from the IR node kinds the fixture's own body produces.
  - [ ] `ALLOWED` — the lint policy, one line of reason each. The gate fails on an entry with no reason.
  - [ ] `rateTranspile(t, all)` — `{ tier, correctness, lints }`.
- [ ] `test/conformance/types.ts` — `LanguageTest.transpile`, documented as generated like `evidence`.
- [ ] `test/conformance/fixtures/transpile.generated.ts` — written by `rate:fixtures`, merged in `fixtures/index.ts`.
- [ ] `scripts/rate-fixtures.ts` — writes both modules; `--check` reports what would change.
- [ ] `fixtures.test.ts` — the A↔C pass builds with `clippy-driver` instead of `rustc`, collects the JSON
      diagnostics it already has to read, and fails when a fixture reports a lint its stored row does not carry.
- [ ] CI: `rustup component add clippy` beside `VOLT_REQUIRE_RUSTC=1`.

## 2. The sweep — the printer first, then what is left per tier

Measured over the 2,295 fixtures that lower. Each row is one regeneration of `map.generated.ts`:

| pass | findings | clean |
|---|---:|---:|
| baseline | 4,879 | 5 |
| parens at statement positions · identity casts · `Default` · the prelude's `parse_real` and exponent guard | 1,358 | 1,270 |
| redundant helper casts · `mem::take` · `Default` for `IecStr` | 379 | 1,967 |
| `f64` math results · flipped loop tests · argument positions · the two range guards · the dispatch closure | **99** | **2,214** |

| tier | lowered | clean |
|---|---:|---:|
| `decl` | 424 | 423 |
| `arith` | 1570 | 1511 |
| `control` | 56 | 49 |
| `aggregate` | 27 | 26 |
| `call` | 96 | 90 |
| `indirect` | 122 | 115 |

### Printer-wide — every tier at once

These are not one tier's: the printer emits them wherever the construct appears, so one edit moves every tier.
Measuring per tier first and then finding a single shared cause is the more expensive order, so they went first.

- [x] **`unused_parens` 2,722 → 36** — the printer parenthesizes every binary, cast and unary, which is how a
      printer with no precedence table stays correct, and it means a complete expression arrives at a position that
      needs none already wrapped. `unparen()` drops one balanced outer pair at an assignment's RHS, an `if`
      condition, a `match` selector, a call argument, a builtin argument and a `let` binding. Never at a receiver —
      `literal()`'s own comment says what `(-1i32).max(x)` costs without its parens.
- [x] **`clippy::unnecessary_cast` 578 → 1** — a cast to the type the value already has. Five places: the identity
      rule in `convert`; `castTo()` for the casts a BUILTIN adds on top of an argument the IR already typed; the
      array index, which widened an `i64` to `i64`; `iec_r2i32`/`iec_r2i64`, which already RETURN the register
      width; and `fromF64`, since an `f64` math routine's result needs no narrowing to `f64`.
- [x] **`clippy::new_without_default` 2,289 → 0** — every emitted struct had a no-argument `new` and no `Default`.
      Not derived (Rust derives `Default` only for arrays up to 32 elements) and `::new()` stays the contract;
      `impl Default` defers to it so the crate composes the way a Rust programmer expects. Four sites:
      `Globals`/`Programs`, each DUT and FB layout, the POU struct, and `IecStr` in the prelude.
- [x] **`clippy::possible_missing_else` 834 → 0** — all of them one line: `iec_parse_real` in the prelude, written
      as a single dense line where five `if`s with no `else` read as five missing ones. Written out.
- [x] **`clippy::manual_range_contains` 363 → 0** — three guards: the prelude's exponent, `TRUNC`'s i32 range, and
      `iec_r2i64`'s.
- [x] **`clippy::mem_replace_with_default` 0 → 12 → 0** — INTRODUCED by the `Default` impls, and caught by the
      ratchet on the next regeneration, which is the ratchet working: `std::mem::replace(&mut p, T::new())` is
      `std::mem::take(&mut p)` once `T: Default`.
- [x] **`clippy::nonminimal_bool` 46 → 4** — a loop test prints `if !<cond> { break; }` and a loop condition is
      almost always a comparison. Flipped on the IR node (`INVERSE`), not by rewriting printed text.
- [x] **`clippy::redundant_closure_call` 28 → 0** — `dispatch`'s null arm wrapped its `panic!` in a closure to give
      it the match's type. `panic!` is `!` and coerces on its own; the closure is needed only when there is NO
      other arm, which is the case the comment there was written for.
- [x] **`clippy::self_assignment` 33 → allowed** — the ST says `n := n`. `cc3_empty_and_noop` asks what a no-op
      assignment does and every `cfold_*` fixture uses one to give the recorder a statement to read. Verified
      against the three fixture sources before the entry was written.

### What is left — 99 findings

- [ ] **`unused_parens` (36) · `double_parens` (17)** — the last argument and binding positions the sweep has not
      reached. Locate with `scripts/` the same way the others were found, then one edit each.
- [ ] **`eq_op` (12) · `approx_constant` (6) · `unnecessary_min_or_max` (3) · `manual_clamp` (2) · `min_max` (1) ·
      `absurd_extreme_comparisons` (1) · `never_loop` (1) · `manual_range_patterns` (1)** — each is a candidate for
      *the fixture asks exactly this*: `MIN(x, x)`, a literal 3.14159, a `FOR` that cannot run, and the
      `MIN(MAX(…))` that `limit` emits ON PURPOSE because Rust's `clamp` panics where CODESYS answers
      (`limit_inverted_bounds`). Confirm each against its fixture source — as `self_assignment` was — and either
      allow it with the fixture named or fix the printer. An allow entry that names no fixture is not allowed.
- [ ] **`explicit_auto_deref` (6)** — a VAR_IN_OUT passed as `&mut *x` where `x` already derefs. Printer.
- [ ] **`identity_op` (4)** — an array index lowered as `+ 0` for a zero lower bound, or a union byte `* 1`. Fold it.
- [ ] **`clone_on_copy` (2)** — the `load` case clones any non-elementary; a `Copy` DUT does not need it.
- [ ] **`let_unit_value` (2) · `nonminimal_bool` (4) · `unnecessary_cast` (1)** — read the emission.
- [ ] Re-measure and update both tables here.

## 3. Close-out

- [x] The generated map is committed and the ratchet is green: `VOLT_REQUIRE_RUSTC=1 bun test test/conformance` —
      4,160 pass, 0 fail, with the emitted Rust compiled by `clippy-driver` and every value still matched against
      the CODESYS recordings.
- [x] `emit/rust/index.ts`'s surface block says the emitted Rust is LINTED and where the policy lives.
- [x] CI installs clippy beside the toolchain (`--component clippy`), so the lint half cannot silently skip.
- [x] `bun test src/transpile` — 236 pass. Nine text assertions moved with the printer; every SEMANTIC token in
      them (`&` not `&&`, `wrapping_neg`, `iec_r2i32`, the MOD guard, the argument-before-move order) was kept.
- [x] `VOLT_REQUIRE_RUSTC=1 bun test test/conformance` — the values still come back out of the emitted Rust.
