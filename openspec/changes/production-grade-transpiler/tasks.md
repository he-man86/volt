# Tasks

**Findings are referenced by TITLE, never by number.** The first draft numbered them independently of
`findings.md` and almost every reference pointed at the wrong defect, including two that swapped a high with a
low. A title cannot silently repoint.

Rules throughout: a failing test before every fix; a claim about CODESYS is measured live against SP21 and the
fixture records the measurement; every gate states its CI cost.

---

## Phase 0 — state the contract, then gate it

- [x] **0.1 rustc in CI** — `273a3da2f1`. 3,627 vs 2,423 assertions; the emitter now runs on every push.
- [x] **0.2 A missing toolchain is fatal in CI** — `273a3da2f1`. `VOLT_REQUIRE_RUSTC=1`; the skip stays for
      local use but prints what it dropped.
- [x] **0.4 The totality gate** — `825346dd3e`. ~29k corpus files, ~80s, in the conformance tier. Plus targeted
      cases for the two violations the corpus cannot reach, asserting the DIAGNOSTIC and not just the absence of
      a throw.
- [x] **0.8 Write the subset into `index.ts` as the contract, and gate it.** Today it describes an input
      contract and is silent on reach. Measured: 55 of 304 top-level bodies (18.1%); 56,629 METHOD/ACTION bodies
      unreachable; ~0.10% of all executable bodies. State it with the date, and add a test that re-measures and
      fails when the doc and the number disagree — the shape `coverage.test.ts` already uses. · `e20ce78c5c`
- [x] **0.9 A refusal-code registry and the three-way taxonomy (D5).** `LowerDiagnostic.code` becomes a union
      drawn from one `LOWER_CODES` catalogue; the templated `slot-${kind}` is enumerated or folded; every
      diagnostic carries `kind: "invalid" | "not-modelled" | "not-measured"`, which `index.ts` already asserts
      as the taxonomy and nothing carries. **Blocks 4.1.** · `61b57d15f9`
- [x] **0.10 A termination and allocation contract both backends obey.** `interp.ts:43` caps loops at 1,000,000
      and throws; the emitter has no counterpart, so the same POU fails loud in B and hangs forever in C. Decide
      the cap once (in the IR or in lowering, the move already chosen for `IrBuiltin`) and make both print it.
      Give every gate a per-case wall-clock timeout. · `8a327c8754`
- [ ] **0.11 Declare the emitted surface.** A user's harness reaches in by name. `fieldNames` dedupes by FRAME
      POSITION, so declaring a new VAR ahead of an existing one renames the existing one's Rust field — an
      unrelated ST edit silently breaks hand-written test code. Say which names are contract (`scan`, `new`, the
      POU struct, `Globals`/`Programs`) and which are derived; if fields are contract, key the dedupe on the
      variable's identity, not its index.
- [ ] **0.6 Coverage measurement, on three axes.** (a) IR node kinds and `lower/` branches never exercised;
      (b) refusal codes with no fixture (needs 0.9); (c) **the construct index** — the standard function and
      standard-FB table from the CODESYS reference this package embeds, each entry resolving to a fixture or an
      explicit "not covered". This is IEC-as-index, which the first draft wrongly excluded along with
      IEC-as-oracle.
- [x] **0.5 Make `-D warnings` mean something.** Every generated function carries
      `#[allow(unused_mut, unused_variables, unused_assignments, unreachable_code, non_snake_case)]`
      (`emit.ts:721`), so the gate denies almost nothing — and `unreachable_code` is the class of a defect the
      emitter has already paid for. Narrow to per-item allows with a justification each; unify the lint flags
      between the crate check and the execution harness. · `a94552274e`
- [x] **0.3 The B↔C gate, generator-driven (D1).** Needs 0.9, 0.10 and the three specifications in D1 —
      inputs, place enumeration, comparison domain (bit-exact reals, a NaN rule, pointer and string handling).
      The 55 corpus POUs are the regression set; the generator is the case source. · `f9baac3aff — sweep + 6 probes; the generator is still owed`
- [ ] **0.7 Colocated tests for `lower/calls.ts` and the memory model** — after 0.6 says which branches are
      uncovered, so the tests are aimed rather than assumed.

---

## Phase 1 — the 11 high-severity defects

Interpreter before emitter (D3). Titles are from `findings.md`.

- [x] *"The MOD expansion binds `a` and `d`, shadowing locals of those names"* + *"The bit-assign expansion binds
      `v`"* — `1a81fe3ca5`. Reserved `__` prefix; the invariant tested is "no `let` shadows a parameter", which
      is narrower and right where "every `let` carries `__`" was wrong.
- [x] *"coerce's STRING branch is a catch-all: it answers for BOOL and TIME targets by parsing digits"* — a
      fallback in the oracle. **First.** · `52b6216708`
- [x] *"IrBuiltin says nothing about argument evaluation, and interp evaluates every arg while the Rust emitter
      evaluates…"* — decide in the IR, then both obey. B↔C. · `5db030d04c`
- [ ] *"An ANY argument's place is bound as a hidden VAR_IN_OUT without any of bindInOut's guards"* — verified by
      hand: a global emits E0499; the interpreter writes through a `VAR_IN_OUT CONSTANT`. (One guard *is*
      applied — the alias check — so the finding's "any of" overstates by one; the fix is unchanged.)
- [ ] *"An ANY VAR_INPUT called through an interface gets the argument's VALUE where the routine expects its
      SIZE"*.
- [x] *"Lowering throws (RangeError) when a pointer is stepped over an element whose byte size is 0"* — **done**
      in `825346dd3e` under 0.4; listed here because it is a Phase 1 defect by severity. · `825346dd3e`
- [ ] *"A FOR loop's limit is never converted to the counter's type, so the emitted Rust does not compile"* —
      verified by hand: `i16 <= i32`, E0308, zero diagnostics.
- [ ] *"A duration CONSTANT times/divided by an integer variable is retyped to DINT before the duration rule
      runs"*.
- [ ] *"A negative constant is printed unparenthesized, so `-1i32.max(x)` becomes `-(1i32.max(x))`"* — **prove
      reachability first**; the critique flags it as scheduled high with no demonstrated trigger.
- [ ] *"`routineFnName` has no uniqueness pass, so two routines that snake alike collide"*.

---

## Phase 2 — the 13 medium defects, and one the review missed

- [ ] **The standard FBs.** 271 corpus files declare `TON`/`TOF`/`CTU`/`R_TRIG`/`F_TRIG`; **zero execution
      fixtures cover them**, and the refusal misattributes them into `stmt-call_stmt`/`expr-member`. Give the
      class its own honest code, and decide in D6 whether a scan-cycle time model is in the contract. This is
      the largest misattribution in the tree and the review did not name it.
- [ ] *"an array element of a type with a declared initial value starts at the type's zero"* — the critique
      notes the **emitter does the same thing**, so fixing interp alone converts a shared bug into a B↔C
      divergence. Fix both.
- [ ] *"a math domain error returns NaN and keeps running"* — decide once, apply to both backends.
- [ ] *"REAL → integer saturates above i64 range where the interpreter wraps"* — B↔C.
- [ ] *"lowerSource swallows parse errors in library and GVL files"* (D4).
- [ ] *"A REFERENCE is never dereferenced for a field or index step"* — mis-classified, not unbuilt.
- [ ] *"A PROPERTY through a REFERENCE TO an FB is not resolved"* — same shape; `instancePlace` solves it.
- [ ] *"`pack_mode` is never read for a FUNCTION_BLOCK"* — measure against SP21 before fixing.
- [ ] *"instanceRelative treats the root FB's own frame as multi-instance"*.
- [ ] *"A PROGRAM whose only own member is a PROPERTY is not lowered as an instance"*.
- [ ] *"holdsCall does not count the `call` node"*.
- [x] *"A date literal outside JS Date's range throws out of lowering"* — **done** in `825346dd3e`. · `825346dd3e`
- [ ] *"The documented refusal taxonomy names two constructs that are now lowered"* — folds into 0.9.
- [ ] *"lowerFor's doc block states the opposite of the code"*.

---

## Phase 3 — the 18 low / cleanup items

**Split behaviour from text**, which the first draft grouped together: a doc fix and a semantic change must not
land in one commit.

- [ ] **3a behaviour** — *"unary neg on a REAL is computed as 0 - x"* (B↔C); the two specializer fallbacks;
      `rootInstance`'s empty body; the shift/rotate width fallback; *"inFramePlace rejects a THIS^-rooted in-out
      target"*; *"onEachTag remembers a tag but not the foreign flag"*.
- [ ] **3b duplication (D5)** — the positional-parameter order derived twice; the direct-address rule spelled
      three ways; `storage.ts` vs `bytes.ts` on `VAR_TEMP`.
- [ ] **3c dead code** — `impl Default for IecStr`; the `builtin` case falling into `case "unary"`;
      `foldConstant`'s no-op ternary; the doubly-parsed library manifest.
- [ ] **3d documentation** — the stacked doc comments on `Shared.addressed` (found twice, by two slices) and
      `writeBack`; the "one file per concern" map missing four files; `ADR(u.member)`'s message saying write
      where it means read.

---

## Phase 4 — hardening

- [ ] **4.1 A fixture for every refusal code** — implementable only after 0.9 gives an enumerable set.
- [ ] **4.2 The memory model under property tests** — layout, `ADR`/`^` round-trip, UNION overlay, byte access.
- [ ] **4.3 Source-map correctness** — the emitter ships one and nothing tests that a mapped position lands on
      the statement it claims.
- [ ] **4.4 The one UNCERTAIN finding** — `MAX`/`MIN`/`LIMIT` over STRING lower and interpret but emit Rust that
      does not compile. Needs a live SP21 measurement of what CODESYS does first.

---

## Out of scope (D6)

IEC **as an oracle** · new lowering coverage, including the 56,629 METHOD/ACTION bodies · the delivery surface
(project-level emission, a `volt` verb, a published API) — a separate change · performance.
