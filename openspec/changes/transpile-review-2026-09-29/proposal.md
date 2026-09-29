## Why

An overnight review (2026-09-29) of the Rust that `src/transpile` emits asked two questions the fixture gate cannot
answer. First, is the emitted Rust right for **every** input CODESYS allows, not only the recorded ones? Second, is
it lean? `fixtures.test.ts` already compiles, runs and compares 1950 fixtures against `codesys.run.json`, so
"passes" is known. This change records what the review found beyond that. Leanness is handled separately in
`transpile-lean-candidates`, which must not be applied before these fixes land.

### Measure summary

- **Shapes:** the 2333 emitted files contain 1548 distinct statement shapes.
- **Differential run** (interpreter vs emitted Rust, seeded edge inputs):
  - 39,516 variants over 2,326 compiled fixtures, with 196,026 places compared.
  - 11,202 variants changed some output compared with the baseline. The other ~28k seeded a variable the body
    never reads or overwrites, so they are weak evidence.
  - In 604 variants both backends faulted and agreed.
  - Disagreements that surfaced: `uop_neg_real` (-0 and inf text), `op_math_expt` and `expt_mixed_width` (1 ULP),
    and `cc2_exit_outside_loop` (E0268). Most real defects were found by hand-written probes, not by the seeding,
    because the two backends share one IR and agree on it.
- **Lints** (`-W clippy::all`): 45,655 findings across 41 lints; only 5 of 2333 files are clean.
  - By tier: arith 25,886, call 11,215, decl 4,295, indirect 3,248, control 574, aggregate 437.
  - The prelude, carried whole by 521 fixtures, accounts for about 20k of them.
  - Largest lints: must_use_candidate 6492, dead_code 5627 (5594 unused prelude helpers),
    cast_possible_truncation 5621, cast_sign_loss 4315, cast_lossless 4179, uninlined_format_args 4168,
    missing_const_for_fn 3924, unreadable_literal 3547, manual_assert 1474, derive_partial_eq_without_eq 1473.
- **Size** (Rust lines per ST line, prelude excluded): median 3.14, mean 3.45.
  - Worst are the string fixtures: string_positions_low 38.0, string_positions_high 35.7,
    string_insert_delete_replace_find 29.2.
  - Per ST line: every FOR header costs 10 Rust lines; `state_any_int_pointer_increment` costs 20.
- **What could not run:**
  - 315 of 2648 fixtures do not lower (conversion-type 48, expr-call 41, graphical-body 35, parse 25,
    unary-op 19, place-not-local 16, others).
  - 15 fixtures have no addressable elementary path.
  - 7 clocked fixtures ran on a synthetic 10 ms clock.
  - Only elementary paths were seeded, one path at a time.
  - The 7 emissions that do not compile (all refused fixtures) had no runtime comparison.
  - NaN was compared as a class.
  - The cross-check against the CODESYS recording was not re-run (fixtures.test.ts owns it).
  - String-library ratios are inflated because library ST bodies are excluded.

### Counts

| | |
|---|---|
| Groups confirmed | 52 |
| Distinct root causes after deduplication and regrouping | 48 (34 high, 13 medium, 1 low) |
| Root causes settled by a live CODESYS run during the review | 22 |
| Groups refuted | 4 |
| LOW findings (not verified) | 51 |
| LEAN items (moved to `transpile-lean-candidates`) | 340 |

Several confirmed groups were mislabelled: their representative symptom had a different root cause from the group
key. The tasks below are keyed by the verified root cause, not by the group label. Symptoms that were grouped
but never verified on their own are listed in the appendix.

Two patterns run through almost every finding:

- **The shared IR hides the bug.** The interpreter and the Rust run the same IR, so they agree with each other
  while both contradict CODESYS. Most high findings are of this kind.
- **The fixtures miss the input.** No fixture exercises the edge: a limit wider than the counter, a literal beyond
  i64::MAX, a NaN into MAX, a string longer than 80 characters, a copy of an FB instance.

## What Changes

- Each root cause in `tasks.md` is fixed **failing test first**. First add a conformance fixture, recorded live
  wherever the review did not already record it, together with a colocated `src` test that is red. Then fix the
  line named. Then re-run the corpus gate.
- Where the review recorded CODESYS live, the task quotes the measured values. Those values are the oracle.
  Neither backend's current output is.
- Where CODESYS refuses the program, the fix is a lowering diagnostic, not a new meaning.
- Where CODESYS stops the task (for example EXPT(0, negative)), both backends must stop too.

## Impact

- Code: `src/transpile/lower/*`, `src/transpile/emit/rust/{emit,prelude}.ts`, `src/transpile/ir/{values,evaluate}.ts`,
  `src/transpile/interp/interp.ts`, `src/types/{arith,const-eval}.ts`, and `test/conformance/support/transpile-confidence.ts`.
- Fixtures: about 50 new conformance fixtures, most recorded with `record:exec`.
- Many fixtures' emitted Rust changes. `map.generated.ts` regenerates.
- The LSP shares `types/arith.ts` and `types/const-eval.ts`. Tasks 1-4 change LSP answers too (type checks,
  case-label and array-bound checks), so run the LSP corpus gate with them.

## Appendix A — LOW findings, not verified (one line each)

- FOR with an unsigned counter and a negative constant step emits `-1u8` (absorbed into task 35).
- An unbound FB VAR_IN_OUT reached from a METHOD panics with the "interface" message (emit.ts).
- No fixture checks whether REAL intermediates are rounded to f32 at each step (real-overflow.ts).
- LTIME_TO_TIME / LDT_TO_DT truncate sub-unit remainders; truncation vs rounding is unmeasured.
- UDINT op DINT fixtures run only on zeros (see task 48).
- DINT/LINT MIN MOD -1 answers 0 while MIN / -1 is a measured stop; the MOD case is unmeasured (refuted group; needs live).
- The interpreter's SHL/SHR/ROL count goes through Number(), which loses bits above 2^53.
- LEN(WSTRING), which CODESYS refuses, lowers through an implicit narrow (standard_len_wstring_rejected).
- StrReplaceA panics on an index where CODESYS returns a value when iLengthInput > LEN(string).
- `x := F(o => x)`: whether the return value or the output copy wins is decided silently, with no fixture.
- hasStatementAfterReturn misses EXIT/CONTINUE and all-return IFs (unreachable_code).
- Const-generic in-out names can collide between an open-array dimension and a STRING in-out `<x>_<n>`.
- Emitted helpers (iec_div, iec_max, ...) collide with a user FUNCTION of the same name.
- ir/codes.ts: exact refusal codes contradict their own prefix families.
- evaluate.ts constantValue swallows every non-LoweringBug throw.
- STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5' parses leading decimal digits (unmeasured).
- A whole-string cursor store is cut to the caller's capacity, not the pointer's declared capacity.
- overridesCalled resolves SUPER^.M() against the frame and over-binds in-outs.
- A bare METHOD call with an unconnected VAR_OUTPUT in an FB body is refused.
- calledLayout's doc still says an FB with VAR_TEMP is refused.
- SHL/SHR of an untyped literal shifts in DINT even into a 64-bit destination.
- `0 = p` / `0 <> p` on a pointer is refused; only a zero on the right is recognised.
- The init-sequence read walk skips `select` and an invoke's in-out freezes.
- `insideInstance` refuses `holder.started` but allows `holder.Get()` reading the same field.
- An FB instance declared in a GVL can never be called through an interface (lendPlace refuses GLOBAL tags).
- `r.3` on a REFERENCE is refused, although the reference is implicitly dereferenced elsewhere.
- An assignment chain and a store through a REFERENCE skip the implicit STRING→number refusal (part of task 38).
- commonType treats a sizeless STRING as capacity 0 when choosing the wider string.
- A huge repeat count in an array aggregate builds every leaf before the size check.
- A bit index above 7 in an X address is accepted and overlaps the next byte.
- The const fold accepts `**`, `&` and REAL MOD, which CODESYS rejects.
- REAL_MAX_MAGNITUDE (3.402823e38) is below f32::MAX, so REAL#3.4028235E38 is reported too large.
- Inferred STRING(N)/ARRAY[1..N] fold N in project scope, so a POU-local VAR CONSTANT capacity is lost.
- A negated or parenthesised untyped real literal in SIN/SQRT infers UNKNOWN.
- enumValueType resolves an enum value's type by name without the asker.

Symptoms that were grouped under a confirmed key but never verified on their own:

- A STRUCT field's FB_Init arguments are folded in the declaring POU's scope (lower.ts:507).
- A pointer's target set is read while it is still growing (pointers.ts:44): a use lowered before a later store
  sees an incomplete set.
- Copying a pointer into a multi-target pointer writes the source's constant tag, so a null source becomes
  non-null (pointers.ts:373).
- GVL1.x and GVL2.x in two plain lists share one slot (places.ts:66).
- Member access does not walk EXTENDS (types/infer.ts:122).
- Subrange bounds are dropped, so `a : INT(3..9)` starts at 0 (types/resolve.ts:36).
- A qualified type `Lib.T` resolves by its bare name (types/resolve.ts:40).
- An FB body call stores its inputs before binding its in-outs (calls.ts:1565).
- An ANY input given a REFERENCE TO emits Rust that fails with E0308 (calls.ts:409).
- A named DINT/LINT constant folds unbounded in an initializer but wraps at run time (const-eval.ts:172; see task 2).

## Appendix B — refuted groups (one line each)

- mod-min-by-minus-one: both backends answer 0, which is mathematically right and contradicted by nothing
  recorded. It needs a live run (likely an idiv trap); kept as LOW.
- rotate-in-promoted-width: filed as an ANY-argument ordering bug with no recording; it needs a live run.
  (The real ROL width bug is task 9.)
- const-eval-ignores-declared-int-width: the representative was the FOR negative step (task 35). The enum-array
  half is task 25.
- refused-fixture-rust-rejected-expected: the backends disagree only on programs CODESYS refuses. What is left
  is the implicit-conversion refusal gap (task 38) and a misgrouped EXPT ULP difference (task 46).
