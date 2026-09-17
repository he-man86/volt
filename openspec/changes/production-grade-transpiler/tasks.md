# Tasks

Every defect gets a **failing test first**, then the fix. Where a task rests on a claim about CODESYS, it is
measured live against SP21 and the fixture records the measurement.

`findings.md` has the full table with file:line. `T01`–`T43` below refer to it.

---

## Phase 0 — make the gates real · BLOCKS EVERYTHING ELSE

Nothing below Phase 0 is verifiable by anyone but the engineer who writes it until Phase 0 lands.

- [ ] **0.1 rustc in CI.** Add a Rust toolchain to the `test` job. Measured today: 3,627 assertions with
      `rustc` on PATH vs 2,423 without — ~1,200 emitter assertions never run in CI.
- [ ] **0.2 Fail loudly when rustc is missing.** `describe.skipIf(rustc === null)` silently drops the
      emitter half. Keep the skip for local convenience, but make the suite PRINT what it skipped and make
      CI set `VOLT_REQUIRE_RUSTC=1`, under which a missing toolchain is an error rather than a skip.
- [ ] **0.3 The B↔C gate (design D1).** Every corpus POU that lowers runs in `interp/` and as emitted Rust
      with the same inputs; every reachable place must agree. No CODESYS required.
- [ ] **0.4 The totality gate (design D2).** Lower every corpus file and every conformance fixture; assert
      nothing throws. Diagnostics may say anything.
- [ ] **0.5 The "it compiles" gate.** `rustc --emit=metadata -D warnings` over every lowered corpus POU, not
      only the recorded ones. T34 (the FOR-limit defect) is reachable from ordinary ST and no recorded case
      catches it.
- [ ] **0.6 Coverage measurement.** Which IR node kinds and which `lower/` branches are never exercised by
      any test. Publish the number; it is the honest denominator for everything that follows.
- [ ] **0.7 Colocated test files** for `lower/calls.ts` (1,245 lines, none today) and the five-file memory
      model (1,075 lines, none today).

**Exit:** CI runs the emitter; B↔C, totality and compile gates are green and wired into `ci.yml`; the
coverage number is published in the change.

---

## Phase 1 — the 11 high-severity defects

Ordered by blast radius, interpreter before emitter (design D3).

- [ ] **1.1 (T07) `interp` — `coerce`'s STRING branch is a catch-all** that answers for BOOL and TIME
      targets by parsing digits. A fallback *in the oracle*; fix first.
- [ ] **1.2 (T06) `ir` — `IrBuiltin` does not define argument evaluation.** interp evaluates every argument,
      the emitter does not. Decide it in the IR, then make both backends obey. A B↔C divergence.
- [ ] **1.3 (T01) `calls` — an `ANY` argument bypasses every `bindInOut` guard.** A global, a PROGRAM
      member, a bit or a `VAR_IN_OUT CONSTANT` binds with no diagnostic; the interpreter *writes through a
      constant in-out*. Verified by hand. Route it through `through()` + the global/bit refusals.
- [ ] **1.4 (T08) `oop` — an `ANY VAR_INPUT` through an interface gets the argument's VALUE where the
      routine expects its SIZE.**
- [ ] **1.5 (T09) `memory` — lowering throws `RangeError`** on a pointer stepped over a zero-size element.
      Direct violation of the totality contract; 0.4 must catch it.
- [ ] **1.6 (T34) `exprs` — a FOR limit is never converted to the counter's type.** Verified by hand:
      `i16 <= i32`, E0308, zero diagnostics.
- [ ] **1.7 (T35) `exprs` — a duration CONSTANT times/divided by an integer variable** is retyped to DINT
      before the duration rule runs.
- [ ] **1.8 (T02) `emit-rust` — a negative constant prints unparenthesized**, so `-1i32.max(x)` parses as
      `-(1i32.max(x))`.
- [ ] **1.9 (T03, T04) `emit-rust` — generated bindings shadow user locals.** The MOD expansion binds `a`
      and `d`; the bit-assign expansion binds `v`. Adopt one reserved prefix for every generated binding and
      gate it.
- [ ] **1.10 (T05) `emit-rust` — `routineFnName` has no uniqueness pass**, so two routines that snake alike
      collide.

**Exit:** all 11 have a failing-then-passing test; the B↔C gate is green; no recorded case regressed.

---

## Phase 2 — the 13 medium defects

- [ ] **2.1 (T18) `interp` — an array element of a type with a declared initial value starts at the type's
      zero**, not that initial value.
- [ ] **2.2 (T22) `interp` — a math domain error returns NaN and keeps running**, where the same evidence
      made division by zero throw. Decide once, apply to both.
- [ ] **2.3 (T16) `emit-rust` — `REAL → integer` saturates above `i64` where interp wraps.** B↔C.
- [ ] **2.4 (T14) `driver` — `lowerSource` swallows parse errors in library and GVL files.** (D4)
- [ ] **2.5 (T25) `memory` — a REFERENCE is never dereferenced for a field or index step**, and the refusal
      names the wrong construct. Mis-classified, not unbuilt (D6).
- [ ] **2.6 (T12) `calls` — a PROPERTY through a `REFERENCE TO` an FB is not resolved.** Same shape as 2.5:
      `instancePlace` already solves it one call away.
- [ ] **2.7 (T26) `memory` — `pack_mode` is never read for a FUNCTION_BLOCK**, so a packed FB silently gets
      the aligned size. Measure against SP21 before fixing.
- [ ] **2.8 (T27) `oop` — `instanceRelative` treats the root FB's own frame as multi-instance.**
- [ ] **2.9 (T13) `driver` — a PROGRAM whose only own member is a PROPERTY is not lowered as an instance**,
      and the refusal is mis-classified.
- [ ] **2.10 (T24) `ir` — `holdsCall` does not count the `call` node**, so the `fb-init-program` refusal
      misses an `FB_Init` that calls.
- [ ] **2.11 (T21) `exprs` — a date literal outside JS `Date`'s range throws out of lowering.** Totality.
- [ ] **2.12 (T15) `driver` — the documented refusal taxonomy names two constructs that are now lowered.**
- [ ] **2.13 (T20) `exprs` — `lowerFor`'s doc block states the opposite of the code** and of the comment ten
      lines below it.

---

## Phase 3 — the 19 low / cleanup items

Cheap, and they are how the next reviewer is misled. Group and land together.

- [ ] **3.1 Merge rules spelled twice (D5)** — T29 positional-parameter order; T38 the direct-address rule
      (regex + shape check + overlap bookkeeping); T39 `storage.ts` vs `bytes.ts` on `VAR_TEMP`.
- [ ] **3.2 Remove the remaining silent fallbacks (D4)** — T42 the two specializer fallbacks; T31
      `rootInstance` returning an empty body with no diagnostic; T37 shift/rotate widths falling back to 32.
- [ ] **3.3 Delete dead code** — T36 `impl Default for IecStr`; T33 the `builtin` case falling through into
      `case "unary"`; T40 `foldConstant`'s no-op ternary.
- [ ] **3.4 Fix doc-versus-code contradictions** — T28, T30, T32, T41, T43, and the stacked doc comments on
      `Shared.addressed` and `writeBack`.
- [ ] **3.5 (T17) `interp` — unary neg on a REAL computed as `0 - x`**, so `-0.0` becomes `+0.0` and
      disagrees with the emitted Rust. B↔C.
- [ ] **3.6 (T19) `driver` — every library file's manifest is parsed twice.**
- [ ] **3.7 (T23) `oop` — `inFramePlace` rejects a `THIS^`-rooted in-out target** although `named()` handles
      one.
- [ ] **3.8 (T11) `oop` — `onEachTag` remembers a tag but not the foreign flag it was seen with.**

---

## Phase 4 — hardening past what the review could see

- [ ] **4.1 Randomized differential testing.** Generate ST *inside the input contract* and compare interp
      against emitted Rust (the B↔C property needs no CODESYS, so it can run at volume). Seeded and
      reproducible; a failing seed becomes a committed fixture.
- [ ] **4.2 A fixture for every refusal code.** Each `LowerDiagnostic` code needs at least one case proving
      it fires where intended — a refusal nothing reaches is indistinguishable from one that is wrong.
- [ ] **4.3 The memory model under property tests.** Layout, `ADR`/`^` round-trip, UNION overlay,
      byte-level access. 1,075 lines with no colocated test today.
- [ ] **4.4 Resolve the one UNCERTAIN finding** — `MAX`/`MIN`/`LIMIT` over STRING lower and interpret but
      emit Rust that does not compile. Needs a live SP21 measurement of what CODESYS does with them first.
- [ ] **4.5 Source-map correctness gate.** The emitter ships a source map; nothing currently tests that a
      mapped position lands on the statement it claims.

---

## Out of scope, deliberately (D6)

- IEC 61131-3 / PLCopen conformance — wrong oracle, would introduce bugs.
- New lowering coverage (`lower-completeness` buckets) — belongs to `transpile-st-to-rust`. The two
  mis-classified items (2.5, 2.6) are fixed here because they are already-solved resolution, not new work.
- Performance — nothing measured slow.
- A second backend.
