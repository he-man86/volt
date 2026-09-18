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
- [x] **0.11 Declare the emitted surface.** Stated in `emit/rust/index.ts`: the POU struct, `new`, `scan`,
      `init`, `Globals`/`Programs` and every struct FIELD are contract; routine fns, locals, printer
      temporaries and the prelude types are not. A field name is now a pure function of the ST name — two that
      snake alike are refused, not numbered by frame position (which renamed an EXISTING field when a new VAR
      was declared ahead of it). Measured zero collisions over 784 POUs.
- [x] **0.6 Coverage measurement, on three axes.** (a) IR node kinds — 8/8 expressions, 9/9 statements,
      31/31 builtins, full and pinned at full. (b) refusal codes — the reachability gate, 64 of 104, the 40
      unreached named. (c) the construct index — the vendor's own closed list from `03-operators.md`, every
      entry resolving to a fixture or a stated gap, 51/60. Found that all ten operator CALL forms
      (`ADD(a,b)`) are refused while the symbol form works. · `0.6`
- [x] **0.5 Make `-D warnings` mean something.** Every generated function carries
      `#[allow(unused_mut, unused_variables, unused_assignments, unreachable_code, non_snake_case)]`
      (`emit.ts:721`), so the gate denies almost nothing — and `unreachable_code` is the class of a defect the
      emitter has already paid for. Narrow to per-item allows with a justification each; unify the lint flags
      between the crate check and the execution harness. · `a94552274e`
- [x] **0.3 The B↔C gate, generator-driven (D1).** Needs 0.9, 0.10 and the three specifications in D1 —
      inputs, place enumeration, comparison domain (bit-exact reals, a NaN rule, pointer and string handling).
      The 55 corpus POUs are the regression set; the generator is the case source. · `f9baac3aff — sweep + 6 probes; the generator is still owed`
- [x] **0.7 Colocated tests for `lower/calls.ts` and the memory model** — aimed at the refusals 0.6 named as
      reached by nothing. `calls.test.ts` created (the file had none); the memory model got property tests in
      4.2. Aiming found a real defect: a type containing ITSELF recursed until the stack ran out, where the
      rule is a diagnostic and never a throw. · `layout-recursive`

---

## Phase 1 — the 11 high-severity defects · **COMPLETE**

Interpreter before emitter (D3). Titles are from `findings.md`.

- [x] *"The MOD expansion binds `a` and `d`, shadowing locals of those names"* + *"The bit-assign expansion binds
      `v`"* — `1a81fe3ca5`. Reserved `__` prefix; the invariant tested is "no `let` shadows a parameter", which
      is narrower and right where "every `let` carries `__`" was wrong.
- [x] *"coerce's STRING branch is a catch-all: it answers for BOOL and TIME targets by parsing digits"* — a
      fallback in the oracle. **First.** · `52b6216708`
- [x] *"IrBuiltin says nothing about argument evaluation, and interp evaluates every arg while the Rust emitter
      evaluates…"* — decide in the IR, then both obey. B↔C. · `5db030d04c`
- [x] *"An ANY argument's place is bound as a hidden VAR_IN_OUT without any of bindInOut's guards"* — verified by
      hand: a global emits E0499; the interpreter writes through a `VAR_IN_OUT CONSTANT`. (One guard *is*
      applied — the alias check — so the finding's "any of" overstates by one; the fix is unchanged.) · `59b71e1288`
- [x] *"An ANY VAR_INPUT called through an interface gets the argument's VALUE where the routine expects its
      SIZE"*. · `909f44ef3c`
- [x] *"Lowering throws (RangeError) when a pointer is stepped over an element whose byte size is 0"* — **done**
      in `825346dd3e` under 0.4; listed here because it is a Phase 1 defect by severity. · `825346dd3e`
- [x] *"A FOR loop's limit is never converted to the counter's type, so the emitted Rust does not compile"* —
      verified by hand: `i16 <= i32`, E0308, zero diagnostics. · `04b9ddd7ba`
- [x] *"A duration CONSTANT times/divided by an integer variable is retyped to DINT before the duration rule
      runs"*. · `ebc0212492`
- [x] *"A negative constant is printed unparenthesized, so `-1i32.max(x)` becomes `-(1i32.max(x))`"* — **prove
      reachability first**; the critique flags it as scheduled high with no demonstrated trigger. · `8dcb78aef9 — reachability proven first`
- [x] *"`routineFnName` has no uniqueness pass, so two routines that snake alike collide"*.

---

## Phase 2 — the 13 medium defects, and one the review missed · `84697fa324`
- [x] **The standard FBs.** 308 corpus files (measured; the review said 271) declare `TON`/`TOF`/`CTU`/`R_TRIG`/
      `F_TRIG`; **zero execution fixtures cover them**, and the refusal misattributed them into
      `stmt-call_stmt`/`expr-member`. The class has its own code now — `call-library`, `not-modelled` — and the
      rule generalised past the FBs: a LIBRARY callable of any kind is refused rather than lowered to a routine
      that does nothing. A library is a DECLARATION file, so its empty body lowered cleanly and `t1.Q` read
      FALSE forever, an invented meaning. Discriminator is `isLibrarySymbol`, not the `libraries` channel
      (which carries a project's GVLs too). The 9 standard FUNCTIONs are untouched — builtins, vendor-correct.
      · `eb121c7fe8`
      **Still open for D6:** whether a scan-cycle time model is in the contract — i.e. whether TON is ever
      IMPLEMENTED rather than refused. Refusing is the honest state until that is decided.
- [x] *"an array element of a type with a declared initial value starts at the type's zero"* — **measured, and
      the review had the shape wrong.** A STRUCT element with declared member initials is already correct in both
      backends (`arr[2].x` = 7, `arr[2].y` = 1.5). The real defect is not array-specific at all: an ENUM started
      at 0 rather than at its FIRST ENUMERATOR, scalar, array element and struct member alike — and for
      `(Reverse := -1, …)` that is not a value of the type. Refused while unmeasured, six fixtures added to
      record it, reach 55 -> 46. Narrowed to a variable that actually TAKES the default, since 425 of the 446
      non-zero enums are in libraries named only for their values. · `f89ef399c7`
- [~] *"a math domain error returns NaN and keeps running"* — measured in the interpreter: SQRT(-1) = NaN,
      LN(0) = -inf, LN(-1) = NaN, 1.0/0.0 = inf, i.e. IEEE-754. Plausible but **unmeasured on the vendor**, so
      five fixtures now record it (`overflow_domain_*`, incl. NaN propagation and NaN comparison). Decide when
      the recording lands — a guess in the oracle is the worst place for one. · `bbab6eb5be`
- [x] *"REAL → integer saturates above i64 range where the interpreter wraps"* — real, live, and INVISIBLE to the
      probe built for it: seeds were 0..96 and overwrite declared initial values, so the probe compared the two
      backends on 43 instead of 1.0E19. A magnitude-spanning seed ladder exposed three divergences at once.
      `real_to_int_out_of_range` settles the direction — the vendor WRAPS (`LREAL_TO_DINT(3.0E9)` = -1294967296),
      so the interpreter was right and Rust's saturating `as` was wrong. `TRUNC` keeps its own i32::MIN rule.
      · `bbab6eb5be`
- [x] *"lowerSource swallows parse errors in library and GVL files"* (D4) — the half-parsed file went into the
      symbol table, so the failure resurfaced downstream as `aggregate-init` + `place-not-local` over a GVL
      missing one semicolon. Reports `parse` with the file's URI now. · `101a1dc80d`
- [x] *"A REFERENCE is never dereferenced for a field or index step"* — mis-classified, not unbuilt: `pointeePlace`
      already resolved it and a scalar `a := r` already worked; only the step was missing. · `0032fde376`
- [x] *"A PROPERTY through a REFERENCE TO an FB is not resolved"* — `instancePlace` solved it, exactly as the
      review said; `propertyAccess` asked the reference's OWN type in both places it asks. · `0032fde376`
- [~] *"`pack_mode` is never read for a FUNCTION_BLOCK"* — the measurement is now WAITING rather than missing:
      `mem_fb_pack_mode_*` compare the same FB with and without the attribute, plus a STRUCT control. Note the
      existing `cc4_pack_mode_not_allowed` is named for a belief its own recording contradicts — CODESYS built
      pack_mode on an FB with no diagnostics. Needs a live SP21 `record:exec`.
- [ ] *"instanceRelative treats the root FB's own frame as multi-instance"* — **structurally real, no reaching case
      found.** The asymmetry is in the code: the root POU's harness frame is `POU:NAME` (`lower.ts`) while the root
      FB's OWN frame is `FB:NAME` (`buildLayout`), so `instanceRelative` reads the root FB's own fields as another
      instance's. But three attempts to reach the refusal all failed — an interface holding the root's own field and
      dispatching (lowers, correct), the same lent through a VAR_IN_OUT (refused earlier by `interface-place`), and
      lending the root's own instance into another instance's METHOD (lowers, correct). Not changed: behaviour that
      cannot be demonstrated should not be edited on inspection alone. **Needs a reaching case first** — try the
      `foreign` arm (a tag written through another instance) rather than the `!ownReceiver` arm.
- [x] *"A PROGRAM whose only own member is a PROPERTY is not lowered as an instance"* — `ownMembers` counted
      METHODs and ACTIONs only; a property accessor runs on the instance just as a method does. · `bbab6eb5be`
- [x] *"holdsCall does not count the `call` node"* — so `fb-init-program` was blind to a PROGRAM whose FB_Init
      ran another FB's BODY, while the same FB_Init calling a METHOD was refused. · `0032fde376`
- [x] *"A date literal outside JS Date's range throws out of lowering"* — **done** in `825346dd3e`. · `825346dd3e`
- [x] *"The documented refusal taxonomy names two constructs that are now lowered"* — `REF=` and a runtime FOR
      step both lower; replaced with the refusals that are real today. Verified each by running it.
- [x] *"lowerFor's doc block states the opposite of the code"* — the header claimed limit and step are evaluated
      ONCE into temps; `callshape_for_bounds_changed_in_body` measured otherwise and the code follows it. · `0032fde376`

---

## Phase 3 — the 18 low / cleanup items

**Split behaviour from text**, which the first draft grouped together: a doc fix and a semantic change must not
land in one commit.

- [x] **3a behaviour** — *"unary neg on a REAL is computed as 0 - x"* (B↔C); the two specializer fallbacks;
      `rootInstance`'s empty body; the shift/rotate width fallback; *"inFramePlace rejects a THIS^-rooted in-out
      target"*; *"onEachTag remembers a tag but not the foreign flag"*.
- [x] **3b duplication (D5)** — the positional-parameter order derived twice; the direct-address rule spelled
      three ways; `storage.ts` vs `bytes.ts` on `VAR_TEMP`.
- [x] **3c dead code** — `impl Default for IecStr`; the `builtin` case falling into `case "unary"`;
      `foldConstant`'s no-op ternary; the doubly-parsed library manifest.
- [x] **3d documentation** — the stacked doc comments on `Shared.addressed` (found twice, by two slices) and
      `writeBack`; the "one file per concern" map missing four files; `ADR(u.member)`'s message saying write
      where it means read.

---

## Phase 4 — hardening

- [x] **4.1 A fixture for every refusal code** — built as a REACHABILITY gate rather than 103 hand-written
      fixtures: the corpus walk plus the assembled fixtures record every code actually produced, 63 of 103, as a
      floor that only goes up, with the 40 unreached ones named. Found that a code written as a ternary
      (`string-non-ascii`) escaped the static registry gate entirely.
- [x] **4.2 The memory model under property tests** — layout soundness, `ADR`/`^` round-trip over all 14
      elementary types, UNION overlay, and ADR-difference vs the reported offsets. Deterministic (LCG, not
      `Math.random`). Verified non-vacuous: 60/60 generated structs lower, and an injected alignment fault
      makes it fail by name.
- [x] **4.3 Source-map correctness** — gated over 781 programs / 3636 mappings. Holds for a single-file
      program. **Found: the map has NO FILE IDENTITY** — a span from a GVL is sliced out of the main source
      (10 mappings today, all multi-file). Pinned as a ceiling; closing it means a URI on every span, an IR
      change. The 27 legitimate one-to-many renames are enumerated rather than absorbed.
- [x] **4.5 A source-map span should name its file** — carried on the IR (`IrRoutine.uri`, `IrLayout.bodyUri`)
      rather than on `Span`, which would touch every token the lexer makes. The gate asserts the property now
      instead of pinning the gap.
- [x] **4.4 The one UNCERTAIN finding** — confirmed by compiling it: `IecStr` has PartialOrd but not Ord, so
      `.max()` fails with E0599 while the interpreter happily compared the text. REFUSED as
      `value-string-order` rather than left half-working, with five fixtures recording what the vendor does
      (incl. the comparison operators, a separate question). SEL untouched — it picks, it does not order.

---

## Out of scope (D6)

IEC **as an oracle** · new lowering coverage, including the 56,629 METHOD/ACTION bodies · the delivery surface
(project-level emission, a `volt` verb, a published API) — a separate change · performance.
