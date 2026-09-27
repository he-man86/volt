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

- [x] `test/conformance/support/transpile-confidence.ts` — ONE implementation, as `evidence.ts` is one: `tierOf`,
      `correctnessOf`, `ALLOWED` with a reason per entry, `transpileHalf`, and the findings parser.
- [x] `test/conformance/types.ts` — `LanguageTest.transpile`, documented as generated like `evidence`.
- [x] `test/conformance/fixtures/map.generated.ts` — **one file, not two.** The plan said a
      `transpile.generated.ts` beside `evidence.generated.ts`; they answer the same question about the same
      fixture, so the evidence module was folded into this one and deleted. `fixtures/index.ts` merges it.
- [x] `scripts/rate-fixtures.ts` — the single producer. It compiles every fixture now (~50s, not instant), and it
      REFUSES rather than write a map it cannot stand behind: no clippy on PATH, an allow-list entry that excuses
      nothing, or a fixture inside the input contract whose Rust does not build.
- [x] `fixtures.test.ts` — the value pass builds with `clippy-driver`, and the rows are recomputed: `tier`, `rust`
      and `diverges` for every fixture (no compiler needed), `lints` from the compile that already runs.
- [x] **A second block for the 383 lowered fixtures the value pass does not reach.** It selects `confirmed`
      fixtures WITH recorded values, so 383 of the 2,295 that lower were compiled by nothing in the suite — and
      their rows claimed `rust: "compiles"` on the word of a generator that read the exit code and threw it away.
      Six of them do not compile. They are compiled here now, the claim is asserted against what the compiler
      actually did, and they are under the lint ratchet with the rest.
- [x] **`rejected` is a fourth value of `rust`** — the Rust was emitted and the compiler refused it. Expected
      outside the input contract (`evidence: refused` — `i : INT := 1.5` emits `1.5i16`, and CODESYS rejects the
      ST); a hard failure inside it, in both the generator and the suite.
- [x] CI: `rustup component add clippy` beside `VOLT_REQUIRE_RUSTC=1`.
## 2. The sweep — the printer first, then what is left per tier

Measured over the 2,295 fixtures that lower. Each row is one regeneration of `map.generated.ts`:

| pass | findings | clean |
|---|---:|---:|
| baseline | 4,879 | 5 |
| parens at statement positions · identity casts · `Default` · the prelude's `parse_real` and exponent guard | 1,358 | 1,270 |
| redundant helper casts · `mem::take` · `Default` for `IecStr` | 379 | 1,967 |
| `f64` math results · flipped loop tests · argument positions · the two range guards · the dispatch closure | 99 | 2,214 |
| auto-deref · `Copy` loads · the unit binding · union scales · `NOT NOT` · the to-string path · the eight allows | **0** | **2,295** |

Every tier is clean: `decl` 424 · `arith` 1570 · `control` 56 · `aggregate` 27 · `call` 96 · `indirect` 122.

### The printer — every one of these was a single shared cause

- [x] **`unused_parens` 2,722 → 0** — the printer parenthesizes every binary, cast and unary, which is how a
      printer with no precedence table stays correct, and it means a complete expression arrives at a position that
      needs none already wrapped. `unparen()` drops one balanced outer pair where the expression stands alone: an
      assignment's RHS *and its lvalue*, an `if` condition, a `match` selector and each `match` ARM, every call and
      builtin argument, a `let` binding, and a guarded block's tail. Never at a receiver — `literal()`'s own comment
      says what `(-1i32).max(x)` costs without its parens.
- [x] **`clippy::unnecessary_cast` 578 → 0** — a cast to the type the value already has. Six places: the identity
      rule in `convert`; `castTo()` for the casts a BUILTIN adds on top of an argument the IR already typed; the
      array index, which widened an `i64` to `i64`; `iec_r2i32`/`iec_r2i64` and `iec_parse_real`/`iec_parse_int`,
      which already RETURN the right type; and `fromF64`, since an `f64` math routine needs no narrowing to `f64`.
- [x] **`clippy::new_without_default` 2,289 → 0** — every emitted struct had a no-argument `new` and no `Default`.
      Not derived (Rust derives `Default` only for arrays up to 32 elements) and `::new()` stays the contract;
      `impl Default` defers to it. Four sites, `IecStr` in the prelude included.
- [x] **`clippy::possible_missing_else` 834 → 0** — all of them one line: `iec_parse_real` in the prelude, written
      as a single dense line where five `if`s with no `else` read as five missing ones. Written out.
- [x] **`clippy::manual_range_contains` 363 → 0** — three numeric guards.
- [x] **`clippy::nonminimal_bool` 46 → 0** — a loop test prints `if !<cond> { break; }`. Flipped on the IR node,
      not in printed text: a comparison inverts, `NOT NOT x` is `x` (a REPEAT arrives already negated — `UNTIL` is
      the exit condition), and a constant is the other constant.
- [x] **`clippy::redundant_closure_call` 28 → 0** — `dispatch`'s null arm wrapped its `panic!` in a closure to give
      it the match's type. `panic!` is `!` and coerces on its own; the closure is needed only with NO other arm.
- [x] **`clippy::mem_replace_with_default` 0 → 12 → 0** — INTRODUCED by the `Default` impls and caught by the
      ratchet on the next regeneration, which is the ratchet working.
- [x] **`clippy::explicit_auto_deref` 16 → 0** — a VAR_IN_OUT printed `(*path).used`. Rust auto-derefs through
      `.x` and `[i]`, so the `*` is only needed when the place is the whole value or a BIT step follows.
- [x] **`clippy::identity_op` 4 → 0** — the union byte pipeline emitted `/ 1u64` and `* 1u64` for the lowest byte,
      and bit 0 emitted `>> 0`. The scales are folded in `lower/unions.ts` — the root, and the interpreter runs the
      same nodes — the shift in the printer, which is where it is introduced.
- [x] **`clippy::clone_on_copy` 2 → 0** — the `load` case cloned any non-elementary. Only a DUT struct and an FB
      instance need it; `IecStr`, pointers, interface tags and arrays of those are all `Copy` (`isCopy`).
- [x] **`clippy::let_unit_value` 2 → 0** — a routine with no result yields `()`, and the binding that carried the
      value across the copy-back has nothing to carry.

### The allows — eight more, each naming the fixture whose ST produced it

- [x] `self_assignment` (33) · `eq_op` (12) · `approx_constant` (6) · `unnecessary_min_or_max` (5) ·
      `manual_clamp` (2) · `manual_range_patterns` (1) · `never_loop` (1) · `min_max` (1) ·
      `absurd_extreme_comparisons` (1). Each was read against its fixture's ST first: `zero := num - num` for a zero
      the folder cannot see, a declared `3.14159265358979`, `LIMIT` with inverted bounds, a FOR whose body is a bare
      EXIT, a bound at the type's maximum. `manual_clamp` is the one with a measurement behind it — Rust's `clamp`
      PANICS where CODESYS answers MX.
- [x] **Two entries deleted for excusing nothing.** `non_camel_case_types` and `non_snake_case` were written from
      reasoning and produced by none of the 2,295 fixtures. They were invisible because the allow-list was `-A`
      FLAGS: a lint the compiler is told to allow never reaches the output, so an entry doing nothing looks exactly
      like one doing its job. The allow moved into the PARSER, the generator counts what each entry excuses, the
      count is in the generated header, and it REFUSES to write while any entry is at zero.

## 3. Close-out

- [x] Every tier clean and the ratchet green: `VOLT_REQUIRE_RUSTC=1 bun test` — the emitted Rust is compiled by
      `clippy-driver` and every value still matched against the CODESYS recordings.
- [x] `emit/rust/index.ts`'s surface block says the emitted Rust is LINTED and where the policy lives.
- [x] CI installs clippy beside the toolchain (`--component clippy`), so the lint half cannot silently skip.
- [x] Twelve emitter assertions moved with the printer. Every SEMANTIC token in them (`&` not `&&`,
      `wrapping_neg`, `iec_r2i32`, the MOD guard, the argument-before-move order, the in-out write) was kept.

## 4. What the review of this change itself found

The sweep was declared finished at 0 findings. Reviewing the MAP rather than the emitter turned up three defects in
this change's own work — worth recording, because two of them were the map claiming evidence nobody had:

- [x] **`rust: "compiles"` was assumed, not measured.** The generator ran the compiler and discarded the exit code,
      so every fixture that lowered was written `compiles`. Six were wrong: their emitted Rust does not build
      (`i : INT := 1.5` emits `1.5i16`). All six are `evidence: refused` — CODESYS rejects the ST — so the EMISSION
      is defensible and only the claim was false. `rejected` is a fourth value now, taken from the exit status, and
      an in-contract program that fails to build fails the generator AND the suite.
- [x] **383 lowered fixtures were compiled by nothing in the suite.** The value pass selects `confirmed` fixtures
      WITH recorded values (1,912 of 2,295), so the rest had neither their compile claim nor their lint row checked
      on any push — which is where the six hid. They have their own compile-only block now.
- [x] **The cheap recompute test claimed more than it could know.** It recomputed `rust` with no compiler, so it
      asserted `compiles` for rows that are honestly `rejected`. It checks what is checkable without one — a row
      exists exactly when the fixture lowers, and `vendor` is claimed only where a recording holds values — and the
      two compile blocks own the rest.
- [x] **Section 1 of this file described a `transpile.generated.ts` that was never built** (the two generated
      modules became one) and had every box unticked while the work was done. Rewritten to what exists.
