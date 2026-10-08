# Tasks: transpile-restructure

Structure first, then the four models, then the open root causes, then lean. Paths are relative to `packages/volt-lsp-iec/`, and
file names are the NEW structure (design.md §2). Front-end paths (`types/…`, `symbols/…`, `syntax/…`) mean that concern's home in
the structure `frontend-conformance` built (design.md "Order", §6). "RC n" = transpile-review-2026-09-29 task n. "Lean g.i" =
transpile-lean-candidates item g.i. Hex ids are NOTES constructs in `map.generated.ts`.

**Prerequisite:** `openspec/changes/frontend-conformance` is archived (`.claude/workflows/execute-change.js` checks it).

**Format.** Every task is one `- [ ] <id> <what>` line, followed by `Where:` (files), `Accept:` (acceptance) and `Depends:` (task
ids) continuation lines, and `What:` where the line needs detail. A step writes its numbers under its task when it closes it.

**Acceptance shorthands** (design.md §8):
- **G:** `bun typecheck`, `bun run lint` (layering, size, citations) and `bun test` in the package are green; `bun run check` at the
  repo root is green.
- **G+LSP:** G, plus the LSP corpus gate (`bun run test:corpus`), the build-conformance oracle and `lsp-replay.test.ts`
  unchanged.
- **S:** `bun run snapshot:transpile check` is identical in all layers (canonical IR, emitted Rust + source map, interpreter outputs,
  Rust outputs, edge verdicts) against the 0.5 baseline.
- **S-out:** outputs and edge verdicts are identical; the Rust may change.
- **T:** `bun scripts/suite-snapshot.ts --compare <before>` is identical (every test title kept; design.md §8).
- **M:** `bun run rate:fixtures` regenerated. The delta is written under the task: fixtures whose Rust changed, `edge`, median `size`,
  `pedantic` total, lint totals, ALLOWED excused counts, and notes resolved (deleted from the authored table; the gate enforces no
  orphans).
- **F(x):** fixture x's divergence mark is removed and it passes. The expected-failure guard fails the suite until the mark is removed.
- **Filed:** a line appended to `openspec/changes/lsp-transpile-review-gaps/tasks.md` (0.7) in the same commit.

**Loop per step:** implement, one data-lens review, fix, commit. Commit type: `refactor(lsp)` for phase 1, `fix(lsp)` for phases
2-6, `perf(lsp)`/`refactor(lsp)` for phase 7, `docs(openspec)` for design sections. A second review round happens only on a high
finding. A task that turns out not to be output-neutral where it promised S is split: the neutral part lands, the rest is filed under
its RC or lean id in this file.

## 0. Baseline

- [x] 0.0 Gate: `transpile-fix-all` has finished and its changes are committed; `frontend-conformance` is archived.
  - Where: the git tree; `openspec/changes/archive/`.
  - Accept: `git status` is clean under `packages/volt-lsp-iec/` (including `fixtures.test.ts` and `support/expected-failure.ts`);
    `openspec/changes/archive/<date>-frontend-conformance` exists; `bun test` is green.
  - Depends: none.
  - Done 2026-10-07 at 3f42db0e71. `transpile-fix-all` was the run that executed `transpile-review-2026-09-29`; that change is
    archived (`archive/2026-09-30-transpile-review-2026-09-29`, f731d97181: "all 48 root causes fixed or verified"). `git status`
    was clean under `packages/volt-lsp-iec/` (the only untracked path in the repo was another change's
    `openspec/changes/codesys-single-load-dependencies/`); `archive/2026-10-03-frontend-conformance` exists (and
    `archive/2026-10-07-analysis-conformance`, which the owner's order put before this change). `bun test` in the package: 8392
    pass, 35 skip, 432 todo, 0 fail — 8859 tests across 205 files, 685 s. CAVEAT (review 0a): that run overlapped the 0.3
    implementer's own edits — the `transpile-confidence.ts` split landed mid-run and a deliberate `emit.ts` literal mutation sat
    in the tree for ~8 s — so it measured neither 3f42db0e71 nor the final tree; its end-of-step re-run covered only
    `test/conformance` + `test/frontend`. The full suite on the final tree, cold, is gate 0a's (below).
- [x] 0.1 Reconcile root causes and re-read the code.
  - What: for every RC (1-48, incl. 2.3) and every Appendix A/B line, record open, closed-upstream (commit), or closed-by-frontend-
    conformance (its task 5.2 report). Known on 2026-09-29: RC 1-5, 7-10, 13 (transpiler half), 29 (3dd773b9d7) and 30 (e06405f97c)
    closed. A closed RC's task below becomes "verify in the new home" (its src test moves with its module; its fixture stays
    confirmed). Also re-run the top-level declaration inventory of `src/transpile/**` and the `describe` list of `lower.test.ts` and
    `emit.test.ts`; add every name or describe not in design.md §4/§5 to those tables (same commit).
  - Where: this file (a table under 0.1); design.md §4, §5.
  - Accept: every RC and appendix line has a status and a commit or "open"; design.md §4 lists every top-level declaration found.
  - Depends: 0.0.
  - Done 2026-10-07 at 3f42db0e71. Every RC was closed UPSTREAM by `transpile-review-2026-09-29` (one commit each, below);
    frontend-conformance closed none (design.md §6.2). "closed" means the recorded fixture is confirmed, or refused as CODESYS
    refuses it. Where the fix was a REFUSAL pending a model, or left an LSP or a routine half, "left here" says so and names the task
    that carries it. Every phase-6 task whose RC is closed below is a "verify in the new home" task: its src test moves with its
    module and its fixture stays as recorded — its F(...) is already met (the divergence mark is gone), nothing else is owed.

    | RC | Status | Commit | Left here (task) |
    |---|---|---|---|
    | 1 | closed upstream | 3bbf2ac145 | — |
    | 2 | closed upstream | 4bb196101a | — |
    | 2.3 | closed upstream | cf95980537 | 6.1 verify (`named_const_expression_keeps` confirmed) |
    | 3 | closed upstream | 1dd58e5855 | — |
    | 4 | closed upstream | 3ab2a93eb3 | — |
    | 5 | closed upstream | 0f306e7385 | — |
    | 6 | closed upstream (lowering's `beside`) | ec3ffc5df8 | 6.2 verify; the shared `contextLiteralType` home open (design.md §6.1 row 7, H5) |
    | 7 | closed upstream | 01eda5b771 | — |
    | 8 | closed upstream | e467766eb3 | — |
    | 9 | closed upstream | ee11cb732f | — |
    | 10 | closed upstream | d912af0662 | — |
    | 11 | closed upstream | 5d4df92e5b | model 2 (3.x) keeps the storage decision |
    | 12 | closed upstream | 2564e50b83 | 6.3 verify |
    | 13 | transpiler half closed upstream | 106a7b660c | LSP half open (`for_limit_wider_than_counter_{dint_var,dint_expr,upper_bound}` lsp-gap) → 0.7; model 1 guard |
    | 14 | closed upstream | 968a1e3828 | model 3 (4.x) |
    | 15 | closed upstream by a REFUSAL (`copy-instance-pointer`) | 73ed52a95e | model gap: `tr_15_fb_copy_keeps_pointer_address` not-lowered → model 3 |
    | 16 | closed upstream by a REFUSAL (`call-fb-inout`) | 8f9c88460b | model gap: `tr_16_fb_copy_carries_inout_binding` not-lowered → model 3 |
    | 17 | closed upstream by a REFUSAL (`pointer-type`) | b411c6b5a4 | model gap: the four `tr_17_any_pvalue_*` not-lowered → model 3 |
    | 18 | closed upstream by a REFUSAL (`interface-instance-relative`) | d8b344b239 | model gap: `tr_18_queryinterface_into_global` not-lowered → model 3 |
    | 19 | closed upstream | ad6825592f | 6.4 verify |
    | 20 | the routine output's copy-out closed upstream | 8ce61e47f8 | LSP false positive open (`KNOWN_DIVERGENCES.codesys` `tr_20_output_index_moved_by_callee`) → 0.7; a converting routine output → 4.11 / 6.17 |
    | 21 | closed upstream | cf64cc0ba2 | 6.5: the required asker of `resolveNamedType` open (design.md §6.1 row 14) |
    | 22 | closed upstream | d6e9c1a060 | `tr_22_fb_init_reads_this_field` not-lowered (`place-not-local`) → model 4 |
    | 23 | closed upstream | fb7adf8c48 | model 4 (5.x) |
    | 24 | closed upstream | 06d5b9122b | model 4 (5.x) |
    | 25 | closed upstream | e171078be2 | model 4 (5.x) |
    | 26 | closed upstream | 381a1810ed | 4.0 verify |
    | 27 | closed upstream (no cap; a harness-only `loopGuard`) | f052467157 | model 1 (2.x) |
    | 28 | closed upstream in both backends | 7da3814d3d | 6.7: both `tr_28_*` not-lowered (`pointer-type`, the bit readback) until 4.12 |
    | 29 | closed upstream | 3dd773b9d7 | 6.8 verify |
    | 30 | closed upstream | e06405f97c | 5.4 verify |
    | 31 | closed upstream | 149d15cb41 | 6.9 verify |
    | 32 | closed upstream | 2bb72d5428 | 6.10 verify |
    | 33 | closed upstream | 69caa32921 | 6.11 verify |
    | 34 | closed upstream | 5c1e7e00df | model 2 (3.x) |
    | 35 | transpiler half closed upstream | 8f6ae481e6 | LSP half open (`tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` lsp-gap) → 0.7; model 1 |
    | 36 | closed upstream | 7a69d45643 | model 1 (2.x) |
    | 37 | closed upstream, LSP and lowering | 194319e648 | 6.12 verify (the four `tr_37_*` refused) |
    | 38 | closed upstream | 8531164eca | 6.13: the store through a REFERENCE (appendix) open |
    | 39 | closed upstream | 514418a4c0 | model 1 (2.x) |
    | 40 | closed upstream, LSP and lowering | 1d84643239 | 6.14 verify (the four `tr_40_*` refused) |
    | 41 | closed upstream | 03b9de81e9 | 6.15 verify |
    | 42 | closed upstream | 62ebd765b1 | 6.16 verify |
    | 43 | the FB path closed upstream | 900c8c30b6 | the routine path → 4.11 / 6.17 (`tr_43_output_dint_to_int` refused) |
    | 44 | closed upstream | bb31088a35 | model 3 (4.x) |
    | 45 | closed upstream (landed with 34) | 5c1e7e00df, bc89e6b7b5, fdbc7cbc75 | model 2 (3.x) |
    | 46 | closed upstream | c581ac19e3 | 6.18 verify |
    | 47 | closed upstream | bc17d0a441 | 6.19 verify |
    | 48 | closed upstream (the rating) | 0ca79f7bae | 6.20 verify |

    Appendix A (LOW, unverified), in its order:

    | Line | Status | Commit / task |
    |---|---|---|
    | FOR with an unsigned counter and a negative constant step emits `-1u8` | closed upstream (absorbed into RC 35) | 8f6ae481e6; 6.A.27 closes by reference |
    | an unbound FB VAR_IN_OUT reached from a METHOD panics with the "interface" message | open | 6.A.28 |
    | REAL intermediates rounded to f32 per step | open | 6.A.2 |
    | LTIME_TO_TIME / LDT_TO_DT sub-unit truncation | open | 6.A.1 |
    | UDINT op DINT fixtures run only on zeros | closed upstream by the rating (RC 48: an all-default recording rates `compiles`) | 0ca79f7bae; 6.20 |
    | DINT/LINT MIN MOD -1 | open | 6.A.3 |
    | the interpreter's SHL/SHR/ROL count goes through `Number()` | open (`ir/evaluate.ts:81`) | 6.A.4 |
    | LEN(WSTRING) lowers through an implicit narrow | closed upstream (`standard_len_wstring_rejected` refused, no tier) | 8531164eca (RC 38) |
    | StrReplaceA panics past LEN | open | 3.11 |
    | `x := F(o => x)`: which write wins | open | 6.A.5 |
    | `hasStatementAfterReturn` misses EXIT/CONTINUE and all-return IFs | open | 1.5.9 moves it as `exitsAfter` with today's behaviour; 7.5.11 fixes it |
    | const-generic in-out names collide | open | 6.A.6 |
    | emitted helpers collide with a user FUNCTION | open | 7.1.5 |
    | `ir/codes.ts` exact codes contradict their prefix families | open | 6.A.8 |
    | `constantValue` swallows every non-LoweringBug throw | open | 6.A.9 |
    | STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5' | open | 6.A.10 |
    | a whole-string cursor store is cut to the caller's capacity | open | 3.10 |
    | `overridesCalled` resolves SUPER^.M() against the frame | open | 6.A.11 |
    | a bare METHOD call with an unconnected VAR_OUTPUT in an FB body is refused | open | 6.A.12 |
    | `calledLayout`'s doc about VAR_TEMP | open (it still reads "Refused, until recorded: an FB with VAR_TEMP") | 6.A.13 |
    | SHL/SHR of an untyped literal into a 64-bit destination | open | 6.A.14 |
    | `0 = p` / `0 <> p` refused | open | 4.13 (c) |
    | the init-sequence read walk skips `select` and an invoke's freezes | open | 5.9 |
    | `insideInstance` refuses `holder.started`, allows `holder.Get()` | open | 5.8 |
    | an FB instance in a GVL is never callable through an interface (`lendPlace`) | open | 4.13 (f) |
    | `r.3` on a REFERENCE refused | open | 4.13 (d) |
    | an assignment chain and a store through a REFERENCE skip the implicit STRING→number refusal | the chain closed upstream (RC 38); the REFERENCE store open | 8531164eca; 6.13 |
    | `commonType` treats a sizeless STRING as capacity 0 | open | 3.3 |
    | a huge repeat count builds every leaf before the size check | open | 6.A.15 |
    | a bit index above 7 in an X address | open | 6.A.16 |
    | the const fold accepts `**`, `&` and REAL MOD | `**` and `&` closed by frontend-conformance 2.5a; REAL MOD open | 58de5afeb0; 6.A.20 |
    | REAL_MAX_MAGNITUDE below f32::MAX | open (both constants in `src/frontend/types/literal.ts`) | 6.A.21 |
    | inferred STRING(N)/ARRAY[1..N] fold N in project scope | closed by frontend-conformance 4.6.2 | 62bcb30d65; 6.A.22 verify |
    | a negated or parenthesised untyped real literal in SIN/SQRT infers UNKNOWN | open | 6.A.23 |
    | `enumValueType` resolves without the asker | open | 6.5 |
    | (grouped) a STRUCT field's FB_Init arguments folded in the declaring POU's scope | open | 5.8 |
    | (grouped) a pointer's target set read while still growing | open | 4.13 (a) |
    | (grouped) a null source copied into a multi-target pointer becomes non-null | open | 4.13 (b) |
    | (grouped) GVL1.x and GVL2.x in two plain lists share one slot | open | 6.A.17 |
    | (grouped) member access does not walk EXTENDS | closed by frontend-conformance 3.2.3 | 461b70fc4d; 6.A.24 verify |
    | (grouped) subrange bounds dropped | the front-end closed by frontend-conformance 4.7.1; lowering open (`decl_subrange_unsigned` diverges) | 62bcb30d65; 6.A.25 |
    | (grouped) a qualified `Lib.T` resolves by its bare name | closed by frontend-conformance 3.4.2 | 1bdaf58172; 6.A.26 verify |
    | (grouped) an FB body call stores its inputs before binding its in-outs | open | 6.A.19 |
    | (grouped) an ANY input given a REFERENCE TO fails E0308 | open | 4.13 (e) |
    | (grouped) a named DINT/LINT constant folds unbounded in an initializer | the front-end half closed by frontend-conformance 4.6.1; the lowering half open | 62bcb30d65; 6.A.29 |

    Appendix B (refuted groups): mod-min-by-minus-one — open (6.A.3); rotate-in-promoted-width — open (6.A.30);
    const-eval-ignores-declared-int-width — closed upstream (its halves are RC 35, 8f6ae481e6, and RC 25, e171078be2);
    refused-fixture-rust-rejected-expected — closed upstream (RC 38, 8531164eca; RC 46, c581ac19e3).

    The code re-read: the top-level inventory of `src/transpile/**` found 47 names §4 did not place (the IR node types aside, which
    §4.5 places by line range), and the describe/test list found 6 `emit.test.ts` describes and 25 `lower.test.ts` tests or describes
    §4.6/§5 did not place; all are placed now (design.md §4.9; §5 "Placed by task 0.1"). Three names §4 listed are gone
    (`LOOP_ITERATION_CAP`, `LOOP_CAP_MESSAGE`, `defaultOfValues`). New file since 2026-09-29: `lower/conditions.ts` (→
    `project/conditions.ts`).
- [x] 0.2 Baseline numbers.
  - What: copy the map header (evidence counts, tier lowered/clean, surviving and allowed lints with excused counts, edge
    agree/disagree/not-run and each disagreement, the pedantic top ten and total, the size median and top ten, shapes and constructs,
    notes and improvable fixtures) and the open divergence marks per RC.
  - Where: this file, under 0.2.
  - Accept: the numbers match `map.generated.ts` at the 0.0 commit.
  - Depends: 0.0.
  - Done 2026-10-07: the header of `map.generated.ts` at 3f42db0e71 (unchanged since; `rate:fixtures` regenerates it identically).
    - evidence: confirmed 2806, refused 1989, not-lowered 389, lsp-gap 76, diverges 5, unaskable 92 (5357 fixtures).
    - tier (lowered / clean): decl 755 / 755, arith 1545 / 1543, control 155 / 144, aggregate 142 / 142, call 268 / 266,
      indirect 360 / 356 — 3225 lowered, 3206 clean.
    - surviving lints: unreachable_patterns 6, clippy::match_overlapping_arm 5, clippy::collapsible_if 4,
      clippy::match_single_binding 2, clippy::too_many_arguments 2, clippy::assign_op_pattern 1, clippy::identity_op 1,
      clippy::neg_cmp_op_on_partial_ord 1, clippy::nonminimal_bool 1, overlapping_range_endpoints 1.
    - allowed (11), with the fixtures each excuses: dead_code 5263, clippy::self_assignment 34, clippy::eq_op 17,
      clippy::unnecessary_min_or_max 10, clippy::approx_constant 6, clippy::absurd_extreme_comparisons 3, unused_comparisons 3,
      unreachable_code 2, clippy::manual_clamp 1, clippy::manual_range_patterns 1, clippy::never_loop 1.
    - edge: agree 3046, disagree 0, not-run 179 (reaches the platform's libm 71, the emitted Rust does not build 65, no elementary
      variable to seed or compare 43). No disagreement to list.
    - pedantic: 30845 findings; the top ten: clippy::must_use_candidate 7854, clippy::cast_possible_truncation 4856,
      clippy::cast_lossless 4266, clippy::cast_sign_loss 3401, clippy::uninlined_format_args 3222, clippy::unreadable_literal 2810,
      clippy::missing_panics_doc 1065, clippy::manual_assert 818, clippy::format_push_string 716, clippy::cast_possible_wrap 364.
    - size: median 3.1; the ten largest: string_positions_low 33.5, string_positions_high 31.7,
      string_insert_delete_replace_find 25.7, string_edge_positions 24, string_conversions_formats 18.3, string_len_left_right_mid 18,
      string_input_truncation 13.3, string_escapes_named 13, tr_14_set_reset_through_multi_target_pointer 12.2,
      string_to_real_parse 11.
    - shape: 1716 distinct emission shapes over 3225 lowered fixtures, 1798 distinct constructs.
    - notes: 723 constructs carry a review note; 3056 fixtures are improvable, 2971 touch a construct with alternatives.
      (design.md's "776 notes" was the 2026-09-29 count; 0.6 tags these 723.)

    Open divergence marks by RC. The transpiler's own marks are the five `diverges` rows (each an expected failure carrying
    `deferred.transpile`); none belongs to an RC:
    - `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` — the x87 argument reduction, not emulated (design.md §7.2, task 6.21).
    - `decl_subrange_unsigned` — a subrange's default is its lower bound (CODESYS 1, both backends 0): the lowering half of the
      appendix line "subrange bounds dropped" (6.A.25; the default itself is `typeDefault`'s, 1.1.4).
    - `lt_literal_negative_in_comparison_unsigned` — `ui > -1` converts the literal into UDINT (CODESYS FALSE, lowering TRUE); no RC
      names it (recorded 2026-10-03 by frontend-conformance, rule LT12; its home is literal typing, hand-off H5). Filed by 0a: task
      6.2's Accept carries F(`lt_literal_negative_in_comparison_unsigned`), and H5 names it.
    Marks that belong to an RC are LSP-side only: `tr_20_output_index_moved_by_callee` (`KNOWN_DIVERGENCES.codesys`, RC 20's LSP false
    positive). The RC fixtures not confirmed are refusals, not marks: not-lowered `tr_15_*`, `tr_16_*`, `tr_17_*` (4), `tr_18_*`,
    `tr_22_fb_init_reads_this_field`, `tr_28_*` (2); lsp-gap `tr_35_for_byte_runtime_int_step`, `tr_35_for_sint_step_300` and the three `for_limit_wider_than_counter_{dint_var,dint_expr,upper_bound}` (RC 13; they lower and run, CODESYS refuses); refused
    `tr_37_*` (4), `tr_40_*` (4), `tr_43_output_dint_to_int`. The other 328 `diverges: {…}` entries of the map are LSP replay marks
    (`KNOWN_DIVERGENCES` per vendor), owned by the LSP review, none by an RC.
- [x] 0.3 Snapshot tool (S).
  - What: `scripts/transpile-snapshot.ts` (`write [--baseline] | check [--layers ir,rust,outputs,edge]`) with
    `test/conformance/support/snapshot.ts`, as design.md §8 defines S. Rust outputs are built through `support/rustc.ts`'s batch path
    (the one `fixtures.test.ts` uses today). Files go to `test/conformance/.snapshot/`; `check` prints the first difference per fixture.
  - Where: `scripts/transpile-snapshot.ts`, `test/conformance/support/snapshot.ts`, `package.json` script `snapshot:transpile`,
    `.gitignore` (`test/conformance/.snapshot/`), `scripts/README.md`.
  - Accept: write then check on an unchanged tree reports identical; a deliberate one-character change to one emitted literal is
    reported with its fixture name; `git status` shows no `.snapshot` file; the run time is written here.
  - Depends: 0.0.
  - Done 2026-10-07. Layers `ir` (canonical IR; a fixture that does not lower records its diagnostics), `rust` (code, source map,
    `usesGlobals`/`usesPrograms`), `outputs` (the interpreter on the declared inputs — every recorder path after the scans — then per
    edge variant the interpreter's and the compiled Rust's values) and `edge` (the verdict as `rate:fixtures` orders it: the build,
    libm, nothing to seed, the comparison). S-out is `--layers outputs,edge`. One `<layer>.jsonl` per layer under
    `test/conformance/.snapshot/{baseline,current}/` (a case-insensitive file system cannot hold a file per fixture); gitignored
    at the repo root. The Rust is built by `buildRust` (the rustc cache) with the suite's argv, and for every fixture that does not
    reach libm from the very source `rate:fixtures` builds, so a snapshot after a regeneration compiles nothing; a libm fixture is
    built from a harness seeding the same variants, so its Rust's values are snapshotted too. `edgeVerdict` was split, behaviour
    kept, into `rustEdgeRun` + `compareEdge` (`support/transpile-confidence.ts`) so the snapshot reads both backends' outcomes and
    the verdict from one run. A clocked fixture scans on the edge run's 10 ms per scan in both halves. `VOLT_FIXTURES` narrows a
    run (inner loop only). Tests: `support/snapshot.test.ts` (canonical form, the first-difference report, `--layers`).
    Measured: `write --baseline` of all 5357 fixtures 171 s (3225 lowered; the edge layer reproduces the map: 3046 agree, not-run
    71 libm / 65 does not build / 43 nothing to seed); `check` on the unchanged tree 180 s, "✓ identical"; `check --layers ir,rust`
    3 s. A deliberate one-character change to one emitted literal (`$1.0$2` → `$1.5$2` in `emit.ts` `literal`, reverted) was
    reported per fixture, e.g. `abs_values: rust line 24: baseline "            abs_real: 0.0f32,", now "            abs_real:
    0.5f32,"`. `git status` shows no `.snapshot` file. Baseline size 37 MB.
- [x] 0.4 Test-move gate (T).
  - What: `scripts/suite-snapshot.ts` gains `--dirs` and a default set that includes `src/transpile`, `src/types`, `src/symbols`,
    `src/syntax` and `test/libraries` beside `test/conformance` and `test/exec`.
  - Where: `scripts/suite-snapshot.ts`, `scripts/README.md`.
  - Accept: write then `--compare` on an unchanged tree is identical; renaming one test title in a scratch copy is reported.
  - Depends: 0.0.
  - Done 2026-10-07. `--dirs a,b` (each must exist, a typo refused by name); the default set is `test/conformance`, `test/exec`,
    `src/transpile`, `src/frontend/types`, `src/frontend/symbols`, `src/frontend/syntax`, `test/libraries`, as far as the tree has
    them (`test/exec` does not exist today) — `src/{types,symbols,syntax}` are under `src/frontend/` since frontend-conformance
    (design.md §6.1). The pure parts (`suiteDirs`, `junitLines`, `compareLines`) are exported and tested in
    `scripts/suite-snapshot.test.ts`; the script runs only as `import.meta.main`. Live, with a scratch copy of
    `ir/values.test.ts` beside it: a write then `--compare` of `--dirs src/transpile/ir` printed "✓ identical" (16 tests); with one
    title renamed in the copy, `--compare` printed that title's `-` and `+` lines and exited 1 (the copy deleted afterwards).
- [x] 0a Gate: the review of 0.0-0.4 (five findings, each fixed with a failing test first or written into its task).
  - Done 2026-10-07.
    - S-out false red (medium): `compareSnapshots` treats a fixture with none of the requested layers as equal to one the
      stored set has no line for (a not-lowered fixture has only `ir`, so an `outputs,edge` set holds no line for it and a take
      gives `{}`); a fixture that stops lowering still differs in its `outputs` layer. Live: `VOLT_FIXTURES=addr_bit_inside_byte,
      abs_values … check --layers outputs,edge` "✓ identical" (exit 0; it exited 1 before).
    - The canonical IR's `Type` now carries the facts its rendered name hides and a backend reads (`typeText`): a folded
      `length` (also behind a `lengthText`), `unfoldedLength`, a subrange, an enum's `base`, a `union`, an array's folded
      `bounds`, nested under an array element or a pointer/reference target.
    - The `rust` layer holds the user's emission (`emitRust(pou)`, no loop guard — what `rate:fixtures` rates as `shown`) beside
      the harness's (`rustLayer`).
    - `lt_literal_negative_in_comparison_unsigned` filed: F in 6.2's Accept, named in H5 (and the 0.2 note).
    - The 0.0 suite numbers carry their caveat (the run overlapped 0.3's edits); the full suite on the final tree is below.
    - Tests: `support/snapshot.test.ts` 14 pass (4 new: the type facts, the absent-layer equality, the user's emission, the
      "starts being snapshotted" case given a requested layer — its old form asserted the false red).
    - Baseline rewritten in the new format (`write --baseline` 182 s, 5357 fixtures); on the unchanged transpiler `check
      --layers outputs,edge` 193 s "✓ identical", `check` (all layers) 233 s "✓ identical". (0.5 still records the baseline's
      hashes.)
    - The gate's first full cold run (`VOLT_REQUIRE_FULL=1 VOLT_RUSTC_CACHE=0 bun test`, 1294 s) failed ONE test:
      `test/frontend/baseline.test.ts` "the ceilings never rose…" timed out at 5 s (a `git show` per committed revision, ~30
      spawns, under the cold suite's load; 2 s alone). Root fix: every version read by one `git cat-file --batch` (1 s alone).
    - Full suite, cold, final tree: 8410 pass, 35 skip, 432 todo, 0 fail — 8877 tests across 207 files, 1200 s.
      `bun typecheck` clean; `bun run lint` (layering) green; `bun run check` (repo root) green. Fixtures and the transpiler
      unchanged, so `map.generated.ts` is not regenerated.
- [x] 0.5 Baseline snapshots.
  - What: `snapshot:transpile write --baseline` and `suite-snapshot.ts <file>` at the 0.0 commit; both hashes recorded here.
  - Where: `test/conformance/.snapshot/baseline/` (untracked); this file.
  - Accept: `check` and `--compare` are identical.
  - Depends: 0.3, 0.4.
  - Done 2026-10-07 at d677078540 (the 0.0 commit 3f42db0e71 plus 0a's snapshot and ceilings-test fixes; the transpiler, the
    fixtures and every test title the T set covers are the same, so the baseline stands for 0.0 — taken at d677078540 so 0a's own
    test titles are in the "before"). S: the baseline is 0a's rewrite (`write --baseline`, 5357 fixtures, 182 s); `snapshot:transpile
    check` (all layers) 191 s "✓ identical". Hashes (sha256) of `test/conformance/.snapshot/baseline/`: `ir.jsonl`
    58c47d39f5ed711f01bb98ded9190a4479f8b45cc4a5b8ebfa5386475df050d8, `rust.jsonl`
    e1c9cd3bc3e199a46a301d84c52efe1d60cfffd15d6794aeb8e8edceac2dd653, `outputs.jsonl`
    4dfd387291342e5ed5e99a8f5a15f8b103892a18f7ba1b723066036e4606325f, `edge.jsonl`
    9193b539ae49cad4fb42e1c52e089ebe71ebe152a38e3e31051bc05cba5dc2a8. T: `bun scripts/suite-snapshot.ts
    test/conformance/.snapshot/suite-baseline.txt` (the default dir set: `test/conformance`, `src/transpile`,
    `src/frontend/{types,symbols,syntax}`, `test/libraries`; `test/exec` does not exist) wrote 7387 tests (6998 pass, 389 skip)
    in 358 s, sha256 260c87768e39c8161700000ab12196e4566dbc28d19003cc14cbd4e67712ff22; `--compare` of it 460 s "✓ identical".
    Both baselines are untracked (gitignored under `test/conformance/.snapshot/`). 0.6 then added four test titles
    (`transpile-confidence.test.ts` "every note is tagged with the task that owns it"), so the T "before" for phase 1 is
    re-taken after 0.6: 7391 tests, sha256
    0cd1ef9f5e53fd06b55bab9465b8c243ee106cd46a6a8f284d51246e2ee8899e, the 0.5 file plus exactly those four `pass` lines.
    Superseded by 0b (which renamed and added test titles there): the T baseline phase 1 compares against is the one 0b records,
    taken on 0b's committed tree — it stands for the 0b commit. S stands for d677078540 (rebuildable from that commit with
    `write --baseline`; 0b re-checked it against 0b's tree).
- [x] 0.6 Tag every NOTE with its task.
  - What: the authored `NOTES` gain a `task` field: a task id of this file (`7.4.1`, `2.3`, `6.15`, …) or `keep:<reason>` for a note
    that says nothing needs to change. The generator refuses a note without a tag and a tag naming an id that is not in this file.
    Every note that fits no existing task gets a new task in phase 7 (same commit); the 520 notes no task cited on 2026-09-29 are
    placed this way. The exact `keep` count is written here (it replaces the estimated "13").
  - Where: `test/conformance/support/transpile-confidence.ts` (or `support/notes/notes.data.ts` after 1.8.3), `scripts/rate-fixtures.ts`;
    this file.
  - Accept: M (no row change); all 776 notes carry a valid tag; the map header prints a per-task note count; no task id in it is
    missing from this file.
  - Depends: 0.2.
  - Done 2026-10-07. `ShapeNote.task` (required; `fixtures/map-row.ts`); the review items (`LEAN`) carry no task, every
    NOTES entry is `note(<task>, …items)` (`note` replaces `merged`: one item is kept as it is, several are merged as before).
    `assertNotes` (run first by `rate:fixtures` and by `fixtures.test.ts`) refuses a note with no tag, a `keep:` with no reason
    and a task id that is not a task line of this file (`taskIdsOf`, `noteTagProblems`; it reads this file only while some
    tag names a task, and refuses by name when the file is gone). The map header prints the count per task (`notesByTask`), and
    each note in the map's NOTES section shows its `task`. Tests: `support/transpile-confidence.test.ts` (4 new: the id
    parser, the three refusals by note id, the per-task count, every authored note valid); `fixtures.test.ts`'s render test
    carries a task. Live: a tag `7.3.99` and an empty one made `rate:fixtures` stop at once with "013de1dc6a: no task" and
    "0153115496: task 7.3.99 is not in transpile-restructure's tasks.md".
    How the 723 notes were placed (the work is reproducible from the review items and this file's citations): 226 named by
    exactly one task here; 5 named by two (7.3.1/7.3.2, 7.5.4/7.5.7: the later task, which finishes it); 9 named by the keep
    tasks 7.2.13, 7.7.10, 7.8.9 → `keep:<reason>`; 218 whose review item has another note one task names → that task; 14 whose
    item's notes two tasks name and 12 made of two items no task names → decided on the construct line; 236 whose items no
    task named → placed by reading the item's text (107 items); 3 → `keep` (shapes6_11: `iec_r2i32` then a narrowing cast is
    correct against all 192 measured cells). Every note fit an existing task, so phase 7 gained no task; one item lands
    outside phase 7: shapes1_12 (pointers as `usize` tags, 2 notes) → 4.2, the pointer-model decision.
    The `keep` count is 12 (replaces the estimated 13): the seven 7.2.13 lists, fb7e9e6ff4 (7.7.10), ea53989ac8 (7.8.9 / 7.11.1)
    and the three shapes6_11 notes (7.11.1 deletes them).
    M: `rate:fixtures` regenerated — no row changed; the header gained the per-task counts, the NOTES section a `task` line per
    note. Notes per task: 7.3.1 92, 7.2.3 42, 7.3.3 30, 7.2.6 27, 7.4.1 24, 7.4.4 24, 7.7.1 24, 7.4.2 22, 7.8.6 22, 7.2.2 18,
    7.6.1 18, 7.7.3 17, 7.2.9 15, 7.7.5 15, 7.7.8 15, 7.4.3 14, 7.9.3 14, 7.4.6 13, 7.5.7 13, 7.6.3 12, 7.7.2 12, keep 12,
    7.2.7 11, 7.5.6 11, 7.8.7 11, 7.9.1 11, 7.2.5 10, 7.6.2 10, 7.8.2 10, 7.2.4 9, 7.2.10 8, 7.3.5 8, 7.3.6 8, 7.2.8 7, 7.6.5 7,
    7.7.9 7, 7.8.3 7, 7.8.10 7, 7.2.14 6, 7.4.5 6, 7.8.5 6, 7.3.9 5, 7.3.12 5, 7.8.4 5, 7.3.13 4, 7.5.2 4, 7.8.8 4, 7.3.8 3,
    7.4.8 3, 7.7.6 3, 4.2 2, 7.2.11 2, 7.3.2 2, 7.3.10 2, 7.3.11 2, 7.4.7 2, 7.4.9 2, 7.5.9 2, 7.6.4 2, 7.6.6 2, 7.7.11 2, 7.2.12 1,
    7.3.4 1, 7.3.7 1, 7.5.1 1, 7.5.3 1, 7.5.8 1, 7.5.10 1, 7.5.11 1, 7.8.1 1, 7.9.2 1 (the 2026-09-29 "776 notes" are 723 today).
- [x] 0.7 Create the LSP hand-off change `lsp-transpile-review-gaps`.
  - What: `proposal.md` (why: LSP-only gaps found by the transpiler work, consumed by "the rest of the LSP review") and `tasks.md`
    with one task per row of design.md §7.1 (RC 13, 35, 37, 20, 38 halves), each naming its fixtures.
  - Where: `openspec/changes/lsp-transpile-review-gaps/`.
  - Accept: `npx --yes openspec validate lsp-transpile-review-gaps` passes; every "Filed" in this file names a line there.
  - Depends: 0.1.
  - Done 2026-10-07. `openspec/changes/lsp-transpile-review-gaps/` (proposal, one ADDED requirement, tasks): 1.1 RC 13 (the
    three `for_limit_wider_than_counter_*`, `MEASURED_SILENT`), 1.2 RC 35 (`tr_35_for_byte_runtime_int_step`,
    `tr_35_for_sint_step_300`), 1.3 RC 37 — ticked there: the four `tr_37_*` already rate `refused` (the LSP reports CODESYS's
    refusal since 194319e648), so nothing is owed, 1.4 RC 20 (`tr_20_output_index_moved_by_callee`, `KNOWN_DIVERGENCES.codesys`),
    1.5 RC 38 (no LSP half known today — `string_wstring_mixing`, all 39 `uop_*` and `standard_len_wstring_rejected` rate
    `refused`; 6.13 files what it finds or ticks it). Section 2 receives later "Filed" lines. The "Filed" acceptances here map
    to it: 2.4 → 1.2, 2.6 → 1.1, 4.11 → 1.4, 6.12 → 1.3, 6.13 → 1.5. `npx --yes openspec validate lsp-transpile-review-gaps`:
    "Change 'lsp-transpile-review-gaps' is valid".
- [x] 0.8 Reconcile `transpile-st-to-rust`'s 39 open tasks.
  - What: per design.md §7.3, each open task is marked "superseded by transpile-restructure <id>" or "stays"; the pointer tasks point
    at 4.2; the VAR_OUTPUT copy-back task at 4.11.
  - Where: `openspec/changes/transpile-st-to-rust/tasks.md`; this file (the list).
  - Accept: every open task there carries a verdict; none is ticked without its superseding task being done.
  - Depends: 0.1.
  - Done 2026-10-03 by the hand-off at the end of this file (54ba095d06; transpile-st-to-rust archived at
    `archive/2026-10-03-transpile-st-to-rust`, 146565d27a); re-checked 2026-10-07: its tasks.md has 39 open lines, 6 marked
    "*Superseded by transpile-restructure <id>*" (4.11 ×1, 4.2 ×4, 4.14 ×1) and 33 "*Backlog (handed off)*", none ticked, so none is
    ticked ahead of its superseding task. Because that change is archived, 4.2, 4.11, 4.14 and 8.4 name the superseded line in
    their commit instead of ticking the archived file (the hand-off's rule).
- [x] 0.9 What the front-end already provides.
  - What: for each of the 15 needs in design.md §6, record "met by frontend-conformance at <path>" or "unmet"; for each met one, the
    matching 1.1 task becomes a verification that the transpiler uses that home (and nothing else). If frontend-conformance moved the
    folders (e.g. under `frontend/`), rewrite the front-end paths of design.md §2.7 and of this file in the same commit.
  - Where: this file (a table under 0.9); design.md §2.7, §6.
  - Accept: every need has a verdict and a path; design.md names only existing front-end paths or planned ones.
  - Depends: 0.1.
  - Done 2026-10-07, re-checked against the code (every export and index named below grepped in `src/frontend/`, every
    transpiler copy in `src/transpile/`). design.md §6.1 stands as written; this adds what is not on a layer's index yet.

    | # | Need | Verdict | Path | 1.1 task becomes |
    |---|---|---|---|---|
    | 1 | `sameName` | met | `src/frontend/syntax/identifier.ts` (+ `selfRefKind`, H10) | 1.1.1 verify: drop `interp/interp.ts:467` |
    | 2 | `extendsChain` | met | `src/frontend/symbols/extends.ts` (`extendsChain`, `baseOf`, `basesOf`, `ancestry`); `scope-nav.ts` `hasUnresolvedBase` | 1.1.2 verify: drop `lower/lower.ts:212`, `lower/lowering.ts` `baseOf` (H1) |
    | 3 | `peelArray`, `elementOf` | unmet | planned `src/frontend/types/arrays.ts` | 1.1.3 builds it (today `ir/ir.ts:49,58`) |
    | 4 | `typeZero`, `typeDefault` | unmet (the facts it reads exist: `types/enums.ts`, `types/defaults.ts` `DEFAULT_STRING_LENGTH`) | planned in `src/frontend/types/defaults.ts` | 1.1.4 builds it (today `ir/ir.ts:36` `defaultValueOf`) |
    | 5 | type predicates | unmet (the file exists with the front-end's own) | `src/frontend/types/predicates.ts` | 1.1.5 adds the set (today `ir/ir.ts:43` `isBit`, `emit.ts:215` `isReal`) |
    | 6 | widths | met for `integerOfWidth` and `wrapToWidth` (the latter not on the types index); `widthOf` unmet | `src/frontend/types/width.ts` | 1.1.6: verify + index `wrapToWidth`; `widthOf` (today `ir/evaluate.ts:23`) built there |
    | 7 | literal typing | met but `contextLiteralType` (LT14 pins the disagreement; H5) | `src/frontend/types/literal.ts` | 1.1.7 verify; `contextLiteralType` stays in `lower/constants.ts:251` until 6.2 |
    | 8 | `parseConversionName` | met (target required) | `src/frontend/types/conversion-name.ts` | 1.1.10 verify; the two `undefined` targets (`lower/builtins.ts:156`, `lower/constants.ts:132,183`) are H4's |
    | 9 | arithmetic result types | met; `durationScaleResultType` is not on the types index | `src/frontend/types/arith/{runtime,checked,temporal,operators}.ts`, `exptResultType` in `types/builtins.ts` | 1.1.8 verify (H4) |
    | 10 | constancy / fold | met; `compileTimeConstant`, `constancyIn` are not on the types index | `src/frontend/types/const/{constancy,fold}.ts` (`declaredValue` = `heldAs`) | 1.1.9 verify (H7) |
    | 11 | enum numbering, default | met; `enumMemberValue`, `enumStorage`, `enumValueStorage`, `enumBase` are not on the types index | `src/frontend/types/enums.ts` | 1.7.14 / H7 use it; `lower/constants.ts:28` `enumStorage` is the copy |
    | 12 | `calendarNanoseconds` | met, already used (`lower/constants.ts:4,224`) | `src/frontend/syntax/literal/calendar.ts` | 1.1.12 verify only |
    | 13 | infer split, `resolveCallee` | met; `mathResultType`, `MATH_ARG_TYPED` (H4 `UNARY_MATH`) are not on the types index | `src/frontend/types/infer/{expr,member,callee}.ts` | 1.1.13 verify |
    | 14 | `resolveNamedType` with a required asker | unmet (`askerUri` still optional, `types/resolve.ts:106`) | `src/frontend/types/resolve.ts` | 6.5 makes it required |
    | 15 | every one on its layer's index | met but: `wrapToWidth`, `durationScaleResultType`, `compileTimeConstant`, `constancyIn`, `enumMemberValue`, `enumStorage`, `enumValueStorage`, `enumBase`, `mathResultType`, `MATH_ARG_TYPED`, `namespaceOf`, `systemStructType` (and `fbChainSections`, private by design) | `src/frontend/{syntax,symbols,types}/index.ts` | 1.1.14 adds each the transpiler starts importing |

    design.md §2.7's table now names the real files (`src/frontend/<layer>/…`, each marked exists or planned by its 1.1 task);
    §6.1 already states the same rule for every other front-end path in design.md and in this file (`types/…` = `src/frontend/types/…`).

- [x] 0b Gate: the review of 0.5-0.9 (four findings, each fixed with a failing test first or written into its task).
  - Done 2026-10-07.
    - Merged notes lost items (medium): a note merging several review items had ONE owner, so the day 7.11.2 deleted it every other
      item went too — 32 items lived only in merged notes (shapes6_4, the hand-written `impl Default`, under 7.2.8; shapes5_5 and
      shapes3_2, MOD by a literal, under 7.3.9 and 7.8.4; …). Now every item names its own owner: `ShapeNote.tasks` (one per item,
      in item order), authored as `merged([task, item], …)` (`note(task, item)` takes one item). 72 merged notes, 807 items over
      723 notes, 59 notes with more than one owner. Items with a single-item note elsewhere took that note's task; the 32 were placed
      by their text: 7.4.3 shapes16_3; 7.2.8 shapes4_1; 7.2.11 shapes4_2; 7.2.12 shapes4_3, 5_15; 7.7.7 shapes15_8; 7.9.3 shapes9_10,
      6_3, 11_3, 11_4; 7.3.5 shapes11_6, 9_13; 7.4.1 shapes10_5; 7.2.5 shapes13_2; 7.3.1 shapes13_3, 12_13, 3_10; 7.2.2 shapes13_4,
      12_12; 7.2.6 shapes10_2 (its `count / day * day` written into 7.2.6), 3_2, 5_5; 7.6.6 shapes8_11, 16_16; 7.2.4 shapes16_10,
      11_1, 11_2; 7.8.4 shapes3_1; 7.8.8 shapes6_2 (the REF= tag written into 7.8.8); 7.5.6 shapes11_17; keep shapes13_1 (its
      reason is its own). One fit no task: shapes6_4 → new task 7.8.11.
    - `keep` notes hid change requests (medium): 1307e33bbf, 1d7709a031, a497507b30, 4a6baf16b3 and 496b8acb56 keep their `keep`
      item, and their other items are owned (7.3.5; 7.2.5 + 7.3.1; 7.2.5; 7.2.2; 7.6.6). 7.2.13 and 7.11.1 now remove `keep`
      ITEMS (a note goes with its last item); the keep reasons say "removed by", not "deleted by".
    - No gate on 7.11.2 (low): `taskIdsOf` now returns each id with whether it is ticked, and `noteTagProblems` refuses an item
      whose owner is ticked ("<id>: item <n>'s task <t> is ticked — the task that lands removes its items from the note"), so each
      task removes its items in the commit that ticks it. Live: 7.2.12 ticked in a scratch edit → the authored-notes test failed
      on 1707972c33 item 2 and 74845f98c6 items 1-2 (reverted).
    - 0.5's baselines (low): 0.5 now says what each stands for; T is re-taken below on 0b's tree.
    - Tests: `support/transpile-confidence.test.ts` 11 pass (6 red first: the ticked state, per-item refusals, the ticked-owner
      refusal, the per-owner count, and the four merged/keep notes named above); `fixtures.test.ts`'s render test renders `tasks`.
    - M: `rate:fixtures` regenerated — no row changed; each note's `task` line became `tasks: [...]`, and the header counts a
      note under each owner: 7.3.1 99, 7.2.3 47, 7.3.3 31, 7.2.6 30, 7.4.1 27, 7.4.4 24, 7.7.1 24, 7.4.2 22, 7.8.6 22, 7.2.2 19,
      7.4.3 19, 7.6.1 19, 7.9.3 18, 7.7.3 17, 7.2.4 16, 7.2.9 15, 7.4.6 15, 7.7.5 15, 7.7.8 15, 7.7.2 14, 7.5.7 13, 7.6.3 13,
      7.2.5 12, 7.2.7 12, keep 12, 7.5.6 11, 7.8.7 11, 7.9.1 11, 7.2.14 10, 7.3.5 10, 7.6.2 10, 7.8.2 10, 7.2.8 8, 7.2.10 8,
      7.3.6 8, 7.4.5 7, 7.6.5 7, 7.7.9 7, 7.8.3 7, 7.8.10 7, 7.6.6 6, 7.8.4 6, 7.8.5 6, 7.3.9 5, 7.3.12 5, 7.8.8 5, 7.2.11 4,
      7.3.13 4, 7.4.8 4, 7.5.2 4, 7.3.8 3, 7.7.6 3, 4.2 2, 7.2.12 2, 7.3.2 2, 7.3.10 2, 7.3.11 2, 7.4.7 2, 7.4.9 2, 7.5.9 2,
      7.6.4 2, 7.7.11 2, 7.3.4 1, 7.3.7 1, 7.5.1 1, 7.5.3 1, 7.5.8 1, 7.5.10 1, 7.5.11 1, 7.7.7 1, 7.8.1 1, 7.8.11 1, 7.9.2 1.
    - T re-taken on 0b's tree (the tree of the 0b commit; it stands for that commit): `bun scripts/suite-snapshot.ts
      test/conformance/.snapshot/suite-baseline.txt` 335 s, 7394 tests (7005 pass, 389 skip), sha256
      e7a6e2f6e0eb7c0edb8fbc3731b1b31a81810bab5e0f267f682151449b9ee565 — 0.6's file with this step's three new titles and two
      renamed ones, nothing else. S: `snapshot:transpile check` (all layers) against d677078540's baseline, 153 s "✓ identical"
      (5357 fixtures; the transpiler is unchanged).
    - Full suite (`VOLT_REQUIRE_FULL=1 bun test`, rustc cache on, VOLT_FIXTURES unset): 8417 pass, 35 skip, 432 todo, 0 fail —
      8884 tests across 207 files, 725 s. `bun typecheck` clean; `bun run lint` (layering) green; `bun run check` (repo root)
      green.

## 1. Structure (output-neutral: every step G + S unless it says otherwise)

Every step moves or splits code without changing behaviour. Where a consolidation would change behaviour, the old behaviour is kept
behind a named parameter, listed under the task, and its removal is the task named in design.md P6.

### 1.0 Tooling

- [x] 1.0.1 Amend layering rule 4 and add rules 4b and 6.
  - What: design.md P2. Among transpile folders: `ir/` imports only itself; `semantics/` imports `ir/`; `lower/` imports `ir/` and
    `semantics/`; `interp/` imports `ir/` and `semantics/`; `emit/` imports `ir/`; `pipeline/` and `index.ts` are composition roots.
    Frontend imports stay governed by rule 3 (syntax, symbols, types only; `semantics/` and `interp/`/`emit/` may import `types`,
    `semantics/` also `syntax`). Rule 4b: the `lower/` leaves (`diagnostics`, `core`, `values`, `project`) import only what P2 allows.
    Rule 6: a file under `src/` (test files included) may not import `test/`.
  - Where: `scripts/check-layering.ts`, a fixture test of the lint beside it.
  - Accept: lint green on today's tree except the known `emit.test.ts → test/…/rustc.ts` edge, listed as a temporary exception that
    1.5.13 removes; the fixture test shows each new rule catching a planted violation.
  - Depends: 0.5.
  - Done 2026-10-07 (step 1.0). `scripts/check-layering.ts`: rule 4 is the folder table (`TRANSPILE_MAY_IMPORT`: `ir` itself
    only, `semantics` → `ir`, `lower`/`interp` → `ir` + `semantics`, `emit` → `ir`; `pipeline/` and `index.ts` import anything; only
    the barrel imports `pipeline/`), rule 4b the `lower/` leaves (`LOWER_LEAVES`; a file directly in `lower/` is its own folder;
    only `entry/` and the `lower/` barrel import `project/`), rule 6 a `src/` file (tests included) importing `test/`. Rules 4/4b
    cover production files, rule 6 every file. The front-end column of P2 stays rule 3's, unchanged (front-end only, through the
    indexes): today `emit/rust/emit.ts` imports `Span` from syntax and three `lower/` files import `frontend/library`, which P2's
    column does not list — tightening rule 3 per folder is not this task's. `KNOWN_TRANSPILE_VIOLATIONS` holds the two `emit.test.ts`
    imports (`test/conformance/support/rustc-cache.ts` and `rustc.ts`, both removed by 1.5.13). Lint green on today's tree.
    Tests: `scripts/check-layering.test.ts` 6 pass — each rule catches a planted violation in a scratch package (emit → semantics,
    ir → semantics, semantics → lower, emit → interp, a non-barrel → pipeline, the four leaves past their tables, a non-entry →
    project, a src test and a src file → test/), the allowed edges beside them clean.
- [x] 1.0.2 Size ratchet.
  - What: design.md §8. The 12 oversize files of 2026-09-29 (`lower/calls.ts`, `emit/rust/emit.ts`, `lower/lower.ts`,
    `lower/storage.ts`, `ir/ir.ts`, `lower/pointers.ts`, `lower/interfaces.ts`, `ir/values.ts`, `lower/builtins.ts`; tests
    `lower/lower.test.ts`, `interp/interp.test.ts`, `emit/rust/emit.test.ts`) are ceilings at their current line counts; functions over
    80 lines are printed as a warning list.
  - Where: `scripts/check-size.ts`, `package.json` `lint`.
  - Accept: green with 12 entries; a new 401-line file fails; the function list is printed.
  - Depends: 1.0.1.
  - Done 2026-10-07 (step 1.0). `scripts/check-size.ts` (`sizeReport`, `CEILINGS`), in `package.json` `lint`. 14 entries, not
    12: design.md's twelve at today's counts (`lower/calls.ts` 1657, `emit/rust/emit.ts` 1369, `lower/lower.ts` 860,
    `lower/storage.ts` 655, `ir/values.ts` 641, `ir/ir.ts` 551, `lower/pointers.ts` 542, `lower/builtins.ts` 490,
    `lower/interfaces.ts` 480; tests `lower/lower.test.ts` 2645, `interp/interp.test.ts` 1349, `emit/rust/emit.test.ts` 969) plus two
    that grew past 400 since 2026-09-29: `interp/interp.ts` 544 and `lower/statements.ts` 437. A file over its ceiling fails, a
    stale entry (gone, or within the limit) fails, a shrunk one is printed with its new ceiling. Functions over 80 lines (17
    today, printed as warnings): `initStep` 383, `lowerInvoke` 341, `Printer.expr` 278, `lowerExpr` 271, an `initStep` closure
    (lower.ts:417) 203, `lowerStmt` 192, `lowerConversion` 186, `emitRust` 183, `lowerBuiltin` 177, `calledRoutine` 139,
    `Printer.stmt` 135, `lowerCallStatement` 129, a `calledRoutine` closure (calls.ts:556) 124, `declareVars` 102, `lowerUnit` 95,
    `coerce` 89, `builtinValue` 86. The function scan is its own small lexer (`codeOnly`): the package's TypeScript is the native
    7.0 compiler, which has no JS API. Tests: `scripts/check-size.test.ts` 6 pass (the real tree green with 14; a new 401-line
    file fails and 400 passes; a 601-line test fails; a risen, a stale and a shrunk ceiling; functions found by name and first
    line; braces in strings, templates, comments and regexes are not code).
- [x] 1.0.3 Citation check.
  - What: design.md §8: report `file.ts:NNN` / `file.ts` citations in `src/**` comments, fixture comments, the authored NOTES and
    LEAN texts, `docs/*.md` and open openspec changes' `tasks.md` whose file does not exist. Warning-only until 1.9.3.
  - Where: `scripts/check-citations.ts`, `package.json` `lint`, `scripts/README.md`.
  - Accept: runs in lint; prints today's count (expected ≈ 0 missing today, since no file has moved yet).
  - Depends: 1.0.1.
  - Done 2026-10-07 (step 1.0). `scripts/check-citations.ts` (warning-only; `--strict` for 1.9.3, `--all` lists each), in
    `package.json` `lint`; `scripts/README.md`. A citation resolves when a `.ts` file of the repo ends with it at a `/`.
    Today's count is NOT ≈ 0: 661 missing before this note (669 with the paths it names), 0.7 s. 577 were in this file — mostly the target files of later tasks
    (`ir/walk.ts` 13, `emit/rust/values.ts` 11, `lower/statements/loops.ts` 8, …) and the pre-frontend-conformance front-end
    paths (`types/infer.ts`, `infer.ts`); 15 in `lsp-package-structure/tasks.md`, 2 in `vendor-fact-probe/tasks.md`; 67 in
    the package: 23 in `src/` comments, 43 in fixture comments (`pragma-tests.ts`, `var-section.ts`, `check-deref.ts`, …: files
    moved or deleted before this change), 1 in `transpile-confidence.ts`. Phase 1's steps re-point what they move; 1.9.3 makes the
    rest an error. Tests: `scripts/check-citations.test.ts` 3 pass (what a citation is — URLs, globs, `<…>` placeholders and
    `.d.ts` are not; resolution by tail; a scratch repo reports exactly the five missing citations, one per kind of text, and
    ignores the archive).
- [x] 1.0.4 Dead-export scope and exclusion.
  - What: `scripts/dead-exports.ts` gains `--scope <dir>` and excludes the IR union members and the §2.1.1 barrel names (design.md §8).
  - Where: `scripts/dead-exports.ts`.
  - Accept: `--scope src/transpile` prints the filtered NOBODY list; the list is written here as the starting point for 1.7.20.
  - Depends: 1.0.1.
  - Done 2026-10-07 (step 1.0). `scripts/dead-exports.ts`: `--scope <dir>`; under `src/transpile` it leaves out the members
    of `IrExpr`/`IrStmt` (read from their declarations), `ir/`'s exported types and the §2.1.1 names (`TRANSPILE_SURFACE`).
    Tests: `scripts/dead-exports.test.ts` 2 pass. The starting point for 1.7.20 (`--scope src/transpile`, 24 names):
    `EmitOptions` (emit.ts), `RunOptions` (interp.ts), `LoweringBug` (ir/evaluate.ts), `calendarText` (ir/values.ts),
    `UNARY_MATH`, `lowerConversion`, `meetOperands` (lower/builtins.ts), `byteOffset` (lower/bytes.ts), `ANY_TARGET`, `BORROWED`,
    `inGlobals` (lower/calls.ts), `inTicks` (lower/constants.ts), `BIN_OPS`, `LIFTED` (lower/expressions.ts),
    `implementsInterface` (lower/interfaces.ts), `CalledRoutine`, `ZERO_SPAN` (lower/lowering.ts), `bitPlace` (lower/places.ts),
    `pointerValue` (lower/pointers.ts), `lowerChain`, `lowerFor` (lower/statements.ts), `INSTANCE_STORAGE`, `holdsInstance`,
    `aliasInit` (lower/storage.ts) — each exported and used only in its own file (the `export` is what is redundant).
### 1.1 Front-end facts the transpiler shares (built only where 0.9 says "unmet"; else verified)

Each task below: if 0.9 found the home already built, the task is "the transpiler uses that home and no copy of its own", accepted
by G+LSP and S. Otherwise it builds the home in the front-end structure, accepted as written.

- [x] 1.1.1 `sameName` in the identifier module.
  - What: move it from `interp.ts:289-292`; `types/compat.ts:107` uses it.
  - Where: `syntax/identifier.ts`, `interp/interp.ts`, `types/compat.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.0.1, 0.9.
  - Done 2026-10-07 (step 1.1a; 0.9: met). `interp/interp.ts` drops its `sameName`: the IDE path names a quoted variable
    with or without its backticks, so `resolvePath` unquotes both sides (`unquoted`, the path grammar's fact — 1.2.5 moves it to
    `ir/path.ts`) and compares through `syntax` `sameName`. `sameName` leaves the transpile surface (`index.test.ts`); no consumer
    outside `src/transpile` imported it. H10's self-reference spellings use `selfRefKind`: `lower/calls.ts` `isSuper`,
    `lower/places.ts` THIS. `syntax/identifier.ts`'s doc says where the unquoting lives. S identical (all layers, 169 s, after 1.1.5).
- [x] 1.1.2 `extendsChain(scope)` for FBs and interfaces.
  - What: base first, cycle guarded, reports incomplete; one function for FB and interface EXTENDS. Re-export `precedence.ts` from
    the symbols barrel; `types/resolve.ts` imports it through the barrel.
  - Where: `symbols/scope-nav.ts`, `symbols/index.ts`, `symbols/scope-nav.test.ts`.
  - Accept: G+LSP; unit tests for a cycle, an unresolved base and an interface chain.
  - Depends: 1.0.1, 0.9.
  - Done 2026-10-07 (step 1.1a; 0.9: met). `precedence.ts` is on the symbols barrel (`libraryRank`, `pickForAsker`,
    `scopeUri`) and `types/resolve.ts` reaches symbols only through it — already so. `lower/lower.ts`'s by-NAME `extendsChain(lw, fb)`
    (walked `lw.bodies` through `unit.extends?.text`) is gone: `chainNamesOf(t)` reads `symbols` `extendsChain(t.scope)` (the bases
    the binder linked, a cycle ending it; an FB type without a scope throws — a lowering bug, never a guess). S identical. NOT done
    here: `lower/lowering.ts` `baseOf` (the AST `extends` token, not a chain) and its four by-name walks (`calls.ts:98`,
    `storage.ts:112`, `bytes.ts:64`, `lower.ts:200`) — each is a site of 1.7.3's list, which moves them onto `core/chain.ts` over
    `extendsChain` together with the other EXTENDS walks (H1). Tests: `symbols/extends.test.ts` "extendsChain" 4 new (base first; a
    cycle and a self-EXTENDS end the chain, each scope once; an unresolved base ends it and `hasUnresolvedBase` reports every scope
    above it; an interface chain through `ancestry`, an unresolved interface base reported).
- [x] 1.1.3 `peelArray` and `elementOf` into `types/arrays.ts`.
  - What: from `ir/ir.ts:66-81`; every caller updated (interp, emit, about 20 in lower).
  - Where: `types/arrays.ts`, `ir/ir.ts`, callers.
  - Accept: G, S.
  - Depends: 1.0.1, 0.9.
  - Done 2026-10-07 (step 1.1a). `src/frontend/types/arrays.ts` (`peelArray`, `elementOf`, verbatim), on the types index;
    `ir/ir.ts` loses both; 16 transpile files import them from the types index. They leave the transpile surface (`index.test.ts`);
    no consumer outside `src/transpile` imported them. Tests: `types/arrays.test.ts` 3 new. S identical.
- [x] 1.1.4 `typeZero` in `types/defaults.ts`.
  - What: `defaultValueOf` from `ir/ir.ts:49-58`, same behaviour, renamed.
  - Where: `types/defaults.ts`, `ir/ir.ts`, callers.
  - Accept: G, S.
  - Depends: 1.1.3.
  - Done 2026-10-07 (step 1.1a). `types/defaults.ts` `typeZero` (was `ir/ir.ts` `defaultValueOf`, same body; its return type
    spelled `bigint | number | boolean | string`, since `types/` cannot import `IrValue`), on the types index; every caller renamed
    (bindings, calls, lower, lowering, places, storage, values, emit). `defaultValueOf` leaves the surface. Test: `types/predicates.test.ts`
    "typeZero" (one row per family). S identical.
- [x] 1.1.5 Type predicates.
  - What: `isBit`, `isBoolValued` (= isBit || BOOL), `isIntegral`, `holdsIntegerBits`, `stringKind`, `isReal`/`floatBits`,
    `hasTextFormat` (= today's `isTemporal` text part, same answer). Only call sites whose result is identical switch: `lower/convert.ts`
    16-19, 76, 95; `builtins.ts:276`; `values.ts` `fit`; `emit.ts:52` `rustType`. Every site that does not switch is listed here with
    why (it is 6.B.1's input); the emitter's conversion dispatch (`emit.ts:666-667`) is RC 31 (6.9).
  - Where: `types/predicates.ts`, `types/predicates.test.ts`, the listed sites.
  - Accept: G+LSP, S; predicate unit tests; the not-switched list is written here.
  - Depends: 1.1.4.
  - Done 2026-10-07 (step 1.1a). `types/predicates.ts`: `isBit`, `isBoolValued`, `isIntegral` (int, or a bit string that is not
    a BIT), `holdsIntegerBits` (`isIntegral`, time, date), `stringKind`, `isReal`, `floatBits`, `hasTextFormat` (`isTemporal` of the
    elem name), all on the types index. `isBit` leaves the transpile surface; its two test consumers import from the types index
    (`fixtures.test.ts` asks `isBoolValued`, `transpile-confidence.ts` `isBit`). Switched (identical answers): `lower/convert.ts`
    `convert`'s BIT/BOOL pair, `adopt`, `valueAs` (×3), `stored`'s family list; `lower/builtins.ts` `lowerConversion`'s `boolLike`
    (inlined), `isString`, the math argument type, `parses`; `ir/values.ts` `fit`'s integer families; `emit/rust/emit.ts` `rustType`
    (bool, float width, string, integer families) and its private `isReal` (deleted). Tests: `types/predicates.test.ts` (every
    predicate × 14 types). S identical (all layers). Not switched (6.B.1's input), with why:
    - the predicate itself or its rule: `lower/convert.ts` 44, 149 (`isBit`), `ir/values.ts` 441 (`fit`'s BIT); `emit.ts` 57
      `emittedFamily` (RC 31, task 6.9);
    - a different question (includes a BIT, or a width/rank/range): `lower/builtins.ts` 56 and `ir/values.ts` 475 (int or bit string
      incl. BIT, with bits), `lower/constants.ts` 135, `lower/expressions.ts` 169-170, 182, 315 (operator operand families),
      `lower/places.ts` 290 (bit-addressable: rank), `lower/statements.ts` 239 (a CASE selector's range), `lower/unions.ts` 21
      (unsigned ≥ 8 bits), `lower/bytes.ts` 37-40, 98, 114 (byte sizes: a BIT has none, a STRING needs its capacity);
    - STRING vs WSTRING by name (the character unit, a cursor's text): `lower/builtins.ts` 336-337, 383; `lower/calls.ts` 466, 475,
      495, 501; `lower/places.ts` 236; `lower/pointers.ts` 112, 330, 350-352, 374, 388; `emit.ts` 213, 228, 240 (`Type.name`, not
      the elem's family — the same answer only if every string Type's name is its kind, not verified here);
    - time/date as a family where `hasTextFormat` asks by name (same answer not proven): `lower/builtins.ts` 423-424, 447,
      `lower/expressions.ts` 257;
    - identical rewrites outside the listed set, left to the move of their file (1.3, 1.5, 1.6) or 6.B.1: `emit.ts` 99, 244, 264,
      589, 802, 835, 847, 894; `ir/values.ts` 416, 444, 534, 546, 569, 574, 577; `lower/builtins.ts` 275, 294, 482-483;
      `lower/constants.ts` 239, 258; `lower/convert.ts` 31; `lower/expressions.ts` 273-274, 284; `lower/lower.ts` 540;
      `lower/storage.ts` 536. (Line numbers on this step's tree.)
- [x] 1.1.6 Widths in `types/width.ts`.
  - What: `integerOfWidth` (from `arith.ts:84-87`), `widthOf` (from `ir/evaluate.ts:23`), `wrapToWidth(value, elem)` as the core of
    `heldAs`, `stored` and `fit`. Each caller keeps its own family guard; the guards are listed here (6.B.2's input). The three
    `infer.ts` ladder spellings (95, 426, 471) use `integerOfWidth`.
  - Where: `types/width.ts`, `types/width.test.ts`, `types/const-eval.ts`, `lower/convert.ts`, `ir/values.ts`, `ir/evaluate.ts`, `types/infer.ts`.
  - Accept: G+LSP, S; the guard list is written here.
  - Depends: 1.1.5.
  - Done 2026-10-07 (step 1.1b; 0.9: met for `integerOfWidth`, `wrapToWidth`). `wrapToWidth` goes on the types index;
    `widthOf(t)` is built in `types/width.ts` (an elementary type's bits, else undefined) and `ir/evaluate.ts`'s shift/rotate width
    reads it, keeping its own `LoweringBug` when lowering left a non-elementary type. `wrapToWidth` is now the core of the three
    store wraps: `lower/convert.ts` `stored`, `ir/values.ts` `fit` (its no-allocation `inWidth` fast path kept in front), and the
    front-end's `const/fold.ts` `declaredValue` (`heldAs`; already so). The three `infer.ts` ladder spellings are gone (frontend-
    conformance's infer split uses `integerOfWidth`). The guards each caller keeps (6.B.2's input): `stored` — not a bigint, not
    elementary, a BIT (holds a BOOLEAN), not `holdsIntegerBits`; `fit` — not elementary, REAL (fround), BIT, STRING (capacity cut),
    then `holdsIntegerBits` and a bigint; `declaredValue` — a STRING literal (capacity cut), a CONSTANT (the fold as named, CE2), a
    declared type that is no integer (`integerType` undefined), a REAL (`Math.fround` at 32 bits). The rotate (`ir/evaluate.ts`
    94-95) wraps by itself (P1's fourth copy; 6.B.2). H9 (`conditions.ts` `EXEC_ORACLE_TARGET`, `bytes.ts` `elementaryTypeOn`) is
    left to 6.B. Tests: `types/width.test.ts` 3 new (the ladder, the wrap, `widthOf`). S identical.
- [x] 1.1.7 Literal typing in `types/literal.ts`.
  - What: `literalType`, `literalCheckType`, `literalErrorType` (infer.ts 323-374, the duplicated negated-literal unwrap merged),
    `integerLiteralType` (elementary.ts 245), `contextLiteralType` (lower `constants.ts:316-329`, rule unchanged).
    `literal-check.test.ts` becomes `literal.test.ts`.
  - Where: `types/literal.ts`, `types/literal.test.ts`, `types/infer.ts`, `types/elementary.ts`, `lower/constants.ts`.
  - Accept: G+LSP, S, T.
  - Depends: 1.1.6.
  - Done 2026-10-07 (step 1.1b; 0.9: met but `contextLiteralType`). Verified: the transpiler types a literal only through the
    types index (`integerLiteralType`, `literalCheckType`, `REAL_LITERAL_TYPE`); `literal-check.test.ts` is `types/literal.test.ts`
    already; `contextLiteralType` stays in `lower/constants.ts` until 6.2 (H5: LT14 pins 29 classes where the two rules answer
    differently). No code change.
- [x] 1.1.8 Split `types/arith.ts` into `arith/runtime.ts`, `arith/checked.ts`, `arith/temporal.ts`.
  - What: also move the NOT and bitwise result rules (infer.ts 87-96, 420-429), the typed-literal sum (465-474) and `exptResultType`
    into `checked.ts`. `arith.test.ts` becomes `arith/runtime.test.ts`; `checked.test.ts` and `temporal.test.ts` gain the missing
    cases (`promoteForRuntime`, `checkedNegationType`, `temporalResultType`, `exptResultType`).
  - Where: `types/arith/*`, `types/infer.ts`.
  - Accept: G+LSP, S, T (plus the new cases).
  - Depends: 1.1.7.
  - Done 2026-10-07 (step 1.1b; 0.9: met). The split is frontend-conformance's (`arith/{runtime,checked,temporal,operators}.ts`,
    `exptResultType` in `types/builtins.ts`). The missing cases: `arith/runtime.test.ts` `promoteForRuntime` (+1), new
    `arith/checked.test.ts` (`checkedMeetType` ×2, `checkedNegationType`), `arith/temporal.test.ts` `temporalResultType` (+1), new
    `types/builtins.test.ts` (`exptResultType`) — each the measured answers the functions' docs cite. H4's two lowering
    re-decisions are NOT output-neutral and are filed as 6.B.5: `NOT` of a signed integer (lowering stamps the bit string BYTE,
    `notResultType` the unsigned integer USINT — same value, another IR type) and duration × integer (`durationScaleConversion`
    makes a 64-bit integer beside a TIME the integer).
- [x] 1.1.9 Split `types/const-eval.ts` into `const/constancy.ts` and `const/fold.ts`.
  - What: no merge yet; `heldAs` sits on `width.wrapToWidth`. `const-eval.test.ts` plus `types.test.ts:103-148` become
    `const/fold.test.ts`, keeping every case (the `**` case at 113 stays until 6.A.20).
  - Where: `types/const/*`.
  - Accept: G+LSP, S, T.
  - Depends: 1.1.8.
  - Done 2026-10-07 (step 1.1b; 0.9: met). `const/constancy.ts` and `const/fold.ts` are frontend-conformance's; `declaredValue`
    (`heldAs`) wraps through `wrapToWidth`. `types.test.ts`'s two "const-eval:" tests (and their `evalConst` helper) move to
    `const/fold.test.ts`, every case kept (the `**` case went with frontend-conformance 2.5a: the parser refuses it). H7 (lowering's
    `foldConstant`/`foldsToConstant`/`convertedConstant` → `const/fold`) is 1.7.14's and 7.2's. T: titles kept (checked with
    1.1.11's move, below).
- [x] 1.1.10 `parseConversionName` into `types/conversion-name.ts`.
  - What: from `elementary.ts:260`; `conversion-name.test.ts` follows it.
  - Where: `types/conversion-name.ts`, `types/elementary.ts`.
  - Accept: G+LSP, T.
  - Depends: 1.1.9.
  - Done 2026-10-07 (step 1.1b; 0.9: met, target required). `conversion-name.test.ts` already sits beside it. H4's platform
    names are NOT switched anywhere in this step — every site keeps `undefined` and moves with 6.B.5. `lower/builtins.ts`'s rewrite
    (`PLATFORM_ALIASES` on the left side, then `undefined`): measured, `parseConversionName(name, targetOf(project))` also reads the
    platform side on the right, so `ty_dint_to_uxint` starts lowering and `ty_xint_to_dint_result_type`'s refusal code moves
    (`expr-call` → `assign-string`). `lower/constants.ts` `convertedConstant` and `isConstantCallee` were first switched to the
    target here (S identical), but the gate's review found it changes answers S has no fixture for: a platform conversion in an FB
    VAR initializer went from refused (`expr-call`, as in a body) to lowered, and `5 + __XINT_TO_DINT(5)` from a deferred runtime
    init to a static fold of 10 — the body and the initializer disagreed, with no recording behind the new answer (0 such
    conversions in the corpora). Reverted to `undefined` (gate 1.0-1.2); `lower/constants.test.ts` pins that the initializer
    refuses exactly as the body does and is not folded (both red on the switched tree). All three sites are 6.B.5's.
- [x] 1.1.11 Dissolve `types/types.test.ts`.
  - What: into `resolve.test.ts`, `compat.test.ts` and `elementary.test.ts` (its 103-148 already went in 1.1.9).
  - Where: `types/*.test.ts`.
  - Accept: G, T.
  - Depends: 1.1.10.
  - Done 2026-10-07 (step 1.1c). `types/types.test.ts` (711 lines, 42 tests) is gone, each test beside its subject with the
    helpers it uses: `elementary.test.ts` (3, new), `resolve.test.ts` (+1), `compat.test.ts` (7, new), `render.test.ts` (1, new),
    `infer/expr.test.ts` (25, new — the "infer:" tests; `inferExprType` lives in `infer/expr.ts`), `arith/operators.test.ts` (3,
    new: `operatorFunctionResult`, `shortCircuitType`, `pointerArithmeticType`); its two "const-eval:" tests went to
    `const/fold.test.ts` in 1.1.9. T (narrowed to `src/frontend/types` for the inner loop): every one of the 42 titles present
    and passing, 131 tests in the folder, all pass; the gate's full T is the check.
- [x] 1.1.12 `calendarNanoseconds` into the literal valuation module.
  - What: from lower `constants.ts:294-313`. `inTicks` stays in lowering (it reads `types/` `tickNs`) and moves to
    `values/literals.ts` in 1.6.10.
  - Where: `syntax/literal-value.ts`, `lower/constants.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.0.1, 0.9.
  - Done 2026-10-07 (step 1.1c; 0.9: met). Verified: `calendarNanoseconds` lives in `src/frontend/syntax/literal/calendar.ts`
    (syntax index) and `lower/constants.ts` imports it; the transpiler has no copy. `inTicks` stays in lowering (1.6.10). No change.
- [x] 1.1.13 Split `types/infer.ts` into `infer/expr.ts`, `infer/member.ts`, `infer/callee.ts`.
  - What: mandatory (no other plan claims it). `fbChainSections` goes on `extendsChain`; the orphan doc at infer.ts:258 (lean 10.4) is
    deleted; `resolveCallee` exported for lowering's parameter view (6.B.4).
  - Where: `types/infer/*`.
  - Accept: G+LSP, S.
  - Depends: 1.1.2, 1.1.8.
  - Done 2026-10-07 (step 1.1c; 0.9: met). Verified: `types/infer/{expr,member,callee}.ts`; `fbChainSections` (private,
    `infer/callee.ts`) walks `symbols` `extendsChain`; `resolveCallee` is on the types index for lowering's parameter view (6.B.4).
    No code change.
- [x] 1.1.14 The types barrel exports every new module.
  - What: `types/index.ts` re-exports predicates, width, arrays, defaults, literal, conversion-name, arith, const, infer (and enums
    after 1.7.14); every consumer imports from the barrel, never a deep path (architecture.md mechanism 2).
  - Where: `types/index.ts`, consumers.
  - Accept: G+LSP; a grep finds no deep `types/<module>` import outside `types/`.
  - Depends: 1.1.13.
  - Done 2026-10-07 (step 1.1c). The types index now also carries `isBit`, `isBoolValued`, `isIntegral`, `holdsIntegerBits`,
    `stringKind`, `isReal`, `floatBits`, `hasTextFormat` (1.1.5), `typeZero` (1.1.4), `peelArray`, `elementOf` (1.1.3), `widthOf`,
    `wrapToWidth` (1.1.6); literal, conversion-name, arith, const and infer were on it already. The other names 0.9 found off the
    index (`durationScaleResultType`, `compileTimeConstant`, `constancyIn`, `enumMemberValue`, `enumStorage`, `enumValueStorage`,
    `enumBase`, `mathResultType`, `MATH_ARG_TYPED`) are added by the task that first imports them in the transpiler (1.7.14, 6.B.5,
    1.6.15). Grep: no import of a `frontend/types/<module>` other than the index outside `src/frontend/types/` (the one hit is
    `test/frontend/layering.test.ts`'s planted violation, a string). Lint (F2) enforces it.
### 1.2 `ir/`

- [x] 1.2.1 Split `ir/ir.ts` into `ir/expr.ts`, `ir/stmt.ts` and `ir/program.ts`.
  - What: a pure move. `holdsCall` moves verbatim into a new `ir/walk.ts` (rebuilt in 1.2.3); `IrValue` into `program.ts`. Move the
    misplaced `import type { Type }` (line 41) to the top, delete the orphan doc at 252-254, and drop the abandoned sentence at 320-322.
  - Where: `transpile/ir/*`.
  - Accept: G, S.
  - Depends: 1.1.5.
  - Done 2026-10-07 (step 1.2). `ir/ir.ts` (517 lines after 1.1) is split: `ir/expr.ts` (places and expressions, 271),
    `ir/stmt.ts` (85), `ir/program.ts` (`IrValue` and the frame, 106), `ir/walk.ts` (`holdsCall`, moved verbatim, then rebuilt by
    1.2.3); the lowering results stayed in `ir.ts` for 1.2.2. The two-decisions doc heads `ir/index.ts`, which every citation of
    "see `ir.ts`" now names (`transpile/index.ts`, `test/corpus/corpus.test.ts`). The type imports sit at the top of each file
    (the misplaced `import type { Type }` is gone with the file). The orphan doc before `IrBuiltinName` became the `trunc`
    member's own comment (its one fact, TRUNC's rounding, kept); the abandoned "`conversions`… no:" in `IrFresh`'s doc is
    dropped. `ir/ir.ts`'s ceiling is removed from `scripts/check-size.ts`. S identical.
- [x] 1.2.2 Codes and lowering results leave `ir/`.
  - What: `ir/codes.ts` and `ir.ts` 548-575 move to `lower/diagnostics/codes.ts` and `diagnostic.ts`, `codes.test.ts` beside them. The
    transpile barrel exports `LOWER_CODES`, `LOWER_CODE_PREFIXES`, `lowerCodeKind`. The deep-path consumers change in the same commit:
    `test/corpus/corpus.test.ts:55`, `test/conformance/fixtures.test.ts:48`. Fix the stale header (test name, "six families") and the
    misplaced comment at 127-131.
  - Where: `transpile/lower/diagnostics/*`, `transpile/ir/*`, `transpile/index.ts`, the two consumers.
  - Accept: G, S, T; a grep finds no `transpile/ir/codes` import.
  - Depends: 1.2.1.
  - Done 2026-10-07 (step 1.2). `lower/diagnostics/codes.ts` (the registry: `LowerCodeKind`, `LOWER_CODES`,
    `LOWER_CODE_PREFIXES`, `lowerCodeKind`), `lower/diagnostics/diagnostic.ts` (`LowerDiagnostic`, `LoweredPou`, `lowerDiagnostic`)
    and `codes.test.ts` beside them (it now reads every source file under `lower/`, recursively — `lower/` gets folders in 1.6).
    `ir/` no longer knows lowering's results; `lower/index.ts` exports both files, so the transpile barrel's surface is unchanged
    (`LOWER_CODES`, `LOWER_CODE_PREFIXES`, `lowerCodeKind`, `lowerDiagnostic`). The deep-path consumers use the barrel:
    `test/corpus/corpus.test.ts`, `test/conformance/fixtures.test.ts`. The stale header reads `codes.test.ts` (not
    `lower-codes.test.ts`) and no longer counts the families ("five" was stale: there are six); the note that belongs to
    `pointer-root-input` stands above it, not above `pointer-foreign`. Grep: no `transpile/ir/codes` import. S identical; T: the
    `codes.test.ts` titles moved with the file.
- [x] 1.2.3 `ir/walk.ts` rebuilt on an exhaustive `childrenOf`.
  - What: `childrenOf(node)` as a switch over node kinds; `forEachExpr`, `forEachStmt`, `somePlace`, `holdsCall`, `mapPlaces`,
    `blocksOf`, `exitsAfter`, `loopUses`.
  - Where: `transpile/ir/walk.ts`, `walk.test.ts`.
  - Accept: G, S; `walk.test.ts` checks totality over every node kind and that the new `holdsCall` equals the old reflective one on
    every lowered fixture's IR.
  - Depends: 1.2.1.
  - Done 2026-10-07 (step 1.2). `ir/walk.ts`: `childrenOf(node)` an exhaustive switch over the 21 node kinds plus a place
    (`never` in the default: a new kind is a compile error; an unknown one at run time throws by name); `forEachExpr`,
    `forEachStmt`, `somePlace`, `holdsCall`, `mapPlaces` (typed, innermost first), `blocksOf`, `exitsAfter`, `loopUses` on it.
    Only `holdsCall` is on the ir barrel (the public surface keeps exactly its names; the walks are imported by path). Two
    callers of `holdsCall` passed a possibly-undefined node (`lower/calls.ts` 1273, `lower/statements.ts` 400 — the reflective
    walk answered false for `undefined`), now guarded explicitly; `movedInOut`'s `input` is typed `readonly IrStmt[]`. The
    emitter's `hasStatementAfterReturn`/`nestedBlocks` and the other walkers move onto it in 1.7.4. Tests: `ir/walk.test.ts` 7
    (totality: one node of every kind and exactly its children; the walks), `test/conformance/ir-walk.test.ts` (the new
    `holdsCall` equals the old reflective one — kept there as the oracle — on every expression, statement and body of every
    lowered fixture; 2.6 s; it lives under `test/` because `src/` may not import the fixtures, rule 6). S identical.
- [x] 1.2.4 `ir/faults.ts`.
  - What: fault kinds plus message texts. The interpreter's literals (interp.ts 117, 185, 193; values.ts 40, 203, 241) and the emitter's
    panic texts (emit.ts 640, 1266 and others) import them; strings byte-identical.
  - Where: `transpile/ir/faults.ts`, interp, emit.
  - Accept: G, S.
  - Depends: 1.2.1.
  - Done 2026-10-07 (step 1.2). `ir/faults.ts`: `FaultKind` and `FAULT_TEXT` (null dereference, no instance, division by
    zero, division overflow, logarithm of zero, zero to a negative power), `indexOutOfBounds`, `characterOutOfRange`, and
    `rustFaultLiteral` for a `panic!`. The interpreter's literals (`interp.ts` null dereference ×2, index out of bounds, no
    instance; `values.ts` LN, EXPT, character ×2, division by zero ×2, division overflow) and the emitter's panics (`emit.ts` no
    instance, null dereference in `select`, `iec_deref`, `iec_log`, `iec_pow`, `iec_div`) read them; byte-identical (S `rust`
    and `outputs` identical). The prelude's `IecString` panic keeps its Rust format string (`runtime/string.ts`, 1.5.11). Not on
    the ir barrel (kept off the public surface).
- [x] 1.2.5 `ir/path.ts`: the IDE path grammar; `Runner.get` and `rustAccess` both parse through it.
  - Where: `transpile/ir/path.ts`, `path.test.ts`, `interp/interp.ts`, `emit/rust/emit.ts`.
  - Accept: G, S; `path.test.ts`.
  - Depends: 1.2.1.
  - Done 2026-10-07 (step 1.2). `ir/path.ts`: `parsePath` (names unquoted, one index segment per dimension) and
    `namesVariable(declared, segment)` (a quoted declaration named with or without its backticks, through `syntax` `sameName`).
    `interp/interp.ts` `resolvePath` (Runner.get/set) and `emit/rust/emit.ts` `rustAccess` both walk its segments; 1.1.1's
    interim `unquoted`/`pathNames` in interp are gone, and so is `rustAccess`'s own `bare`. Tests: `ir/path.test.ts` 3. S
    identical.
  - Step 1.2 end (also the end of this agent's run, steps 1.0-1.2): `bun typecheck` clean; `bun run lint` green (layering, size
    13 ceilings — lowered to today's counts: emit.ts 1366, interp.ts 538, values.ts 639, lower.ts 857 — citations 645 missing,
    warning); `bun test src scripts` 2050 tests, 0 fail; `bun test test/frontend` 45/45 after re-pointing three rule-inventory
    entries (`test/frontend/rules.ts` LB8, M3 ×2: `types/types.test.ts` → `types/infer/expr.test.ts`, 1.1.11); `bun test
    test/conformance` 6168 pass, 389 todo, 0 fail (308 s); `bun run test:corpus` green; `rate:fixtures` regenerated — no change
    to `map.generated.ts`; S (`snapshot:transpile check`, all layers) "✓ identical" after each of 1.1a, 1.1b and 1.2 (161-169 s);
    `bun run check` (repo root) 18 passed. One red outside the touched code: `test/libraries/standard.test.ts` "a TON transpiled
    from the repo runs in Rust exactly as the interpreter runs it" times out at 5 s — measured: lowering, emission, `rustAccess`
    and the interpreter take 30 ms together, the build is a rustc-cache HIT (`VOLT_RUSTC_TRACE`: `cached: true`) and the
    emitted Rust is S-identical, so the 6.5 s is spent restoring and spawning the cached exe on this machine; passes with a
    longer timeout. Left for the gate's full run to confirm (not raised: a timeout is a bug to root-cause).
  - Gate 1.0-1.2 (2026-10-07). The review's three findings, each failing test first:
    - `lower/constants.ts` (medium, fixed): 1.1.10's switch of `convertedConstant`/`isConstantCallee` to the project's
      target was not neutral (an FB VAR initializer `DINT_TO___XINT(5)` lowered where the body refuses `expr-call`;
      `5 + __XINT_TO_DINT(5)` folded statically to 10). Reverted to `undefined`, owned by 6.B.5 (written there and under
      1.1.10); `src/transpile/lower/constants.test.ts` 2 tests, both red before the revert.
    - the TON timeout (low, fixed in the cache, not the test): `test/conformance/support/rustc-cache.ts` `prune` stat-ed every
      entry once per process — 5.7 s at 17,199 entries (3.8 GB), on the critical path of a file's first build even on a HIT.
      The size now comes from a LEDGER (`.cache/rustc/.ledger`, `<key> <bytes>` appended per store; a key counted once; an
      eviction only overstates it); only a missing ledger or one past the cap pays the walk, which rewrites it. Tests:
      `rustc-cache.test.ts` "pruning reads the size ledger" 3 (the first red before: a 2 MB entry under a 10-byte ledger was
      pruned). `test/libraries/standard.test.ts` green (4.7 s for the file; the first run after the change paid the one walk
      that wrote the ledger).
    - a VAR initializer LEADING with a platform conversion (`d : LINT := __XINT_TO_DINT(5);`) is refused "';' expected
      instead of '__XINT_TO_DINT'" (low, pre-existing): `parse/initializer.ts` `isUnknownSystemName` refuses any `__`
      identifier leading an initializer (`cc_decl_init_dunder_unknown`, measured for a name neither vendor has). Whether
      CODESYS takes a platform conversion there is not recorded (TY11's fixtures convert in a body), so the fix needs a
      recording first. Niche: accepted loss (0 occurrences in the corpora — no `__U?X(INT|WORD)_TO_` / `_TO___U?X…` anywhere
      in the six projects). Not worked on.
    Numbers: `bun typecheck` clean; `bun run lint` green (layering 3 known, size 13 ceilings + 17 functions warned,
    citations 652 missing, warning); FULL `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset) 8468 pass, 35 skip, 432
    todo, 0 fail, 8935 tests in 224 files, 566 s; S (`snapshot:transpile check`, ir/rust/outputs/edge) ✓ identical, 5357
    fixtures, 158 s; `rate:fixtures` regenerated — `map.generated.ts` unchanged (edge agree 3046, disagree 0, not-run 179);
    `bun run check` (repo root) 18 passed. Committed one commit per step: 1.0 (the tooling, its ceilings as of 1.0), 1.1 (the
    front-end homes and tests), 1.2 (the `ir/` split and EVERY transpile-side edit of 1.1 and 1.2 — they share files, so
    1.1's switches in `src/transpile/` ride with 1.2), plus this gate's fixes with 1.2.
### 1.3 `semantics/`

- [x] 1.3.1 Move `ir/values.ts` and `ir/evaluate.ts` to `semantics/` as they are.
  - What: update the imports in interp and `lower/storage.ts`; `values.ts`'s self-import of the ir barrel becomes direct imports.
  - Where: `transpile/semantics/*`, importers.
  - Accept: G, S; lint shows `lower → semantics` and `interp → semantics` allowed and a planted `emit → semantics` rejected.
  - Depends: 1.0.1, 1.2.4.
  - Done 2026-10-07 (step 1.3a, with 1.3.2-1.3.5 — one move straight into the split files, so no interim
    `semantics/values.ts`). `ir/values.ts`, `ir/evaluate.ts` and `ir/values.test.ts` are gone; `semantics/index.ts` is the
    barrel; `interp/interp.ts`, `lower/pointers.ts` and `lower/storage.ts` (both `constantValue`) import it; every semantics
    file imports `ir/` by the barrel or `ir/faults.js` directly (no self-import). `interp/lreal-text.test.ts` reads the
    barrel until 1.3.6 moves it. Lint: `lower → semantics` and `interp → semantics` green on the real tree; an
    `import "../../semantics/index.js"` planted in `emit/rust/index.ts` fails "transpile/emit must not import
    transpile/semantics" (reverted; `scripts/check-layering.test.ts` keeps its planted case). `scripts/check-size.ts`: the
    `ir/values.ts` ceiling removed, `interp/interp.ts` lowered 538 → 528. Citations of the two old files re-pointed to the
    file that now holds the fact in `src/` comments, fixture comments, `fixtures.test.ts` and `support/evidence.ts`; NOT in
    `emit/rust/prelude.ts`'s Rust text (its "(ir/values.ts charAt / setChar)" line is EMITTED — changing it moved 168
    fixtures' S `rust` layer; 1.5.11 re-points it when `runtime/string.ts` takes the text with its snapshot) nor in
    `support/transpile-confidence.ts`'s LEAN text "ir/evaluate.ts" (it is rendered into `map.generated.ts`; 1.9.3).
- [x] 1.3.2 Split `semantics/values.ts`.
  - What: into `value.ts`, `store.ts`, `convert.ts`, `text.ts`, `parse.ts`, `string.ts`, `arith.ts`, `math.ts`, `instantiate.ts` per
    design.md §4.5; delete the orphan docs at 106 and 309-313.
  - Where: `transpile/semantics/*`.
  - Accept: G, S.
  - Depends: 1.3.1.
  - Done 2026-10-07 (step 1.3a). `value.ts` (`Val`, `num`, `bool`, `copy`), `store.ts` (`fit`, `lowest`/`highest`/`inWidth`),
    `convert.ts` (`coerce`, `toSingle`), `parse.ts` (`parseReal`, `parseInteger` — `coerce`'s two regex reads, verbatim),
    `text.ts` (`civilDate`, `calendarText`, `longCalendarText`, `timeText`, `ltimeText`, `durationText`, `lrealText`, private
    `pad`, `ladder`, `trim`), `string.ts` (`charAt`, `setChar`, `visible`, `held` — exported, `fit` cuts through it), `arith.ts`
    (`compared`, `eq`, `ord`, `arith`, `logic`), `math.ts` (`MATH`, `logarithm`, `expt` and its exact-power helpers),
    `instantiate.ts`. Deviation from §4.5: `elemName` and `isInt` sit in `convert.ts`, private — §4.5 puts them in `store.ts`, but
    only `coerce`'s STRING → integer refusal reads them and `fit` never did. The orphan docs: "A TIME's text — mirrored by the
    emitter's `iec_time_text`" (stacked above `civilDate`) is now `timeText`'s doc, and the conversion doc stacked above
    `elemName` is now `coerce`'s — each kept on the function it describes rather than deleted. `ir/values.test.ts` split by
    subject: `semantics/convert.test.ts` (the three `coerce` tests) and `semantics/math.test.ts` (the three EXPT tests), titles
    kept. Largest file `math.ts` 164 lines.
- [x] 1.3.3 Split `semantics/evaluate.ts`.
  - What: into `builtins.ts`, `operators.ts` (`binaryValue` typed `IrBinOp`), `fold.ts` (with private `evaluate`) and `faults.ts`
    (`LoweringBug`, `IecFault`); `widthOf` already left in 1.1.6.
  - Where: `transpile/semantics/*`.
  - Accept: G, S.
  - Depends: 1.3.2.
  - Done 2026-10-07 (step 1.3a). `builtins.ts` (`selectedArg`, `builtinValue`, the private shift/rotate `widthOf` that throws a
    `LoweringBug` around `types` `widthOf`), `operators.ts` (`unaryValue`, `binaryValue(op: IrBinOp, …)`), `fold.ts`
    (`constantValue`, private `evaluate`), `faults.ts` (`LoweringBug`; `IecFault(kind)`, a `RangeError` whose message is
    `FAULT_TEXT[kind]`). `IecFault` is thrown at the five fixed-text faults of `semantics/` (LN/LOG of zero, EXPT zero to a
    negative power, integer and REAL division by zero, division overflow) — same class chain and message, so S's `throws <msg>`
    and the `toThrow(RangeError)` tests are unchanged. Still plain `RangeError`: the two parametric texts
    (`characterOutOfRange` in `string.ts`, `indexOutOfBounds` in interp) and interp's null-dereference/no-instance throws; and
    `constantValue` still answers "not constant" on any non-`LoweringBug` throw — narrowing it to `IecFault` is 6.A.9's change.
- [x] 1.3.4 One convert, const and short-circuit rule (lean 10.3).
  - What: `convertValue`, `constValue` and `shortCircuit` are exported; `interp.ts` 172-173, 196-197 and 208-209 call them.
  - Where: `semantics/convert.ts`, `semantics/arith.ts`, `interp/interp.ts`.
  - Accept: G, S.
  - Depends: 1.3.3.
  - Done 2026-10-07 (step 1.3a). `convertValue(v, to, from)` = `fit(coerce(…), to)` and `constValue(value, type)` = `fit` in
    `convert.ts`; `shortCircuit(op, left, right)` in `arith.ts` is a COMBINATOR over operand functions of a context `A`
    (`(a: A) => boolean`), so the interpreter builds it once per node from its compiled `Run<Val>` operands (no closure per
    evaluation) and the fold calls it on `() => l, () => r`. Both `fold.ts` `evaluate` and interp's `compileExpr` (const,
    convert, and_then/or_else) call the three.
- [x] 1.3.5 `storeAs(value, type)` replaces the four interpreter ternaries (81, 108, 161, 354).
  - Where: `semantics/value.ts`, `interp/interp.ts`.
  - Accept: G, S.
  - Depends: 1.3.4.
  - Done 2026-10-07 (step 1.3a). `semantics/value.ts` `storeAs` (a composite copied, else `fit`); EIGHT ternaries today, all
    replaced: `invoke`'s input store, `bind`'s copy cell, `write` (plain and walked), `compileWrite`'s three roots, `Runner.set`.
  - Step 1.3a end: `bun typecheck` clean; `bun run lint` green (layering 3 known; size 12 ceilings, 17 functions warned — the
    two semantics ones are `builtinValue` 86 and `coerce` 85; citations warning); `bun test src/transpile` 342 pass, 0 fail;
    S (`snapshot:transpile check`, ir/rust/outputs/edge) ✓ identical, 5357 fixtures, 149 s.
- [x] 1.3.6 The first case table.
  - What: `semantics/cases.ts` (the `Case` contract, design.md P3); `semantics/text.cases.ts` from `lreal-text.test.ts`'s data;
    `interp/lreal-text.test.ts` becomes `semantics/text.test.ts`.
  - Where: `transpile/semantics/cases.ts`, `text.cases.ts`, `text.test.ts`.
  - Accept: G, T.
  - Depends: 1.3.2.
  - Done 2026-10-07 (step 1.3b). `semantics/cases.ts`: `Case<I, O>` (`name`, `input`, `expected`, `recording?`) and
    `CaseRecording` (`fixture`, `variable`). `semantics/text.cases.ts`: `LREAL_TEXT_CASES`, the 25 `lrealText` cells keyed by the
    rule each group shows — the four keys are the four test titles of `lreal-text.test.ts`, so `semantics/text.test.ts` runs one
    test per key and T keeps every title. No case names a recording yet: the cells are the `fmt_lreal_*` measurements, but the
    fixture of each value is not stated in the old test; 1.5.15 attaches them where it checks recordings.
    `interp/lreal-text.test.ts` is gone.
- [x] 1.3.7 Split `coerce`.
  - What: into `toBool`, `toReal`, `realToInt`, `toText`, `fromText` (the last calling `parse.ts`), with `coerce` a dispatcher over them;
    no rule changes (RC 47's single rounding is 6.19).
  - Where: `semantics/convert.ts`, `semantics/parse.ts`.
  - Accept: G, S.
  - Depends: 1.3.4.
  - Done 2026-10-07 (step 1.3b). `coerce` is a 12-line dispatcher (non-elementary, → STRING, STRING →, → BOOL, BOOL → 1/0,
    → REAL, REAL → integer/TIME, else the value); `toText(v, to, from)`, `fromText(text, to)` (on the visible string; REAL →
    `parseReal`, an integer → `parseInteger`, anything else refused by name), `toBool`, `toReal(n, to)` (`toSingle` for a REAL
    target), `realToInt(n, to)` with `I64_MIN`/`I32_MIN` now module constants (were rebuilt per call). Each rule's comment moved
    with it. S identical.
- [x] 1.3.8 `semantics/numeric.cases.ts` with the 192 REAL→int cells.
  - What: one case per recorded cell of `fixtures/conversions/real-to-integer-ladder.ts` (and `real-to-integer.ts`), each naming its
    recording; `semantics/convert.test.ts` runs them against `realToInt`.
  - Where: `semantics/numeric.cases.ts`, `semantics/convert.test.ts`.
  - Accept: G; 192 cases green; the case count is written here.
  - Depends: 1.3.6, 1.3.7.
  - Done 2026-10-07 (step 1.3b). `REAL_TO_INT_CASES`: 192 cases — 120 `r2i_*` (REAL and LREAL × the 12 integer and bit-string
    destinations × above_max, below_min, nan, pos_inf, neg_inf) + 72 `r2ilad_*` (INT, DINT, LINT × 12 rungs × both signs). Each
    names its fixture and `inst.out`; `input` is `{ from, to, value }` with `value` the number the fixture's `v` holds (a REAL's
    in single precision), `expected` the recorded `out` as a bigint (every recording `<DEST>#<decimal>`, its type the
    destination — checked while writing the table). Written ONCE by a single-use generator from the fixture sources and
    `codesys.run.json` (deleted after; the twin harness holds the table to the recordings from 1.5.15). `convert.test.ts`
    "REAL -> integer: every recorded cell of the 192": `fit(realToInt(value, to), to)` equals the recording for all 192 — green.
  - Step 1.3b end: `bun typecheck` clean; `bun run lint` green (size 16 functions warned — `coerce` left the list;
    citations warning); `bun test src/transpile` 343 pass, 0 fail (one new title, the 192-cell test); S ✓ identical (5357
    fixtures).

### 1.4 `interp/` and `pipeline/`

- [x] 1.4.1 Split `interp/interp.ts` into `machine.ts`, `frame.ts`, `calls.ts` and `runner.ts`.
  - What: one frame builder for invoke and FB call (the key list at 88/260 once). `resolvePath` on `ir/path` plus `frame.locate`, its
    VAR_STAT handling moved into `locate`. Inline `import()` types become named imports; the orphan comment at 41 is deleted; the barrel
    no longer re-exports `Val`.
  - Where: `transpile/interp/*`.
  - Accept: G, S.
  - Depends: 1.3.5, 1.2.5.
  - Done 2026-10-07 (step 1.4). `interp/interp.ts` is gone. `frame.ts` (184): `Cell`, `Located`, the abstract `Frame` (the
    frame's state; `bind`, `writeBack`, `locate` — now public —, `read`, `write`; `expr` abstract) and `compileRead`/
    `compileWrite`. `machine.ts` (230): `Signal`, `LoopGuardError`, `Machine extends Frame` (`expr`, `block`, `enterFrame` —
    a body on a fresh frame) and the closure compiler (`compiledExpr`, `compiledBlock`, `compileExpr`, `compileBlock`,
    `compileStmt`). `calls.ts` (62): `invoke`, `call` and the ONE frame builder `enter` (lent instances bound, the instance's
    field keys — the key list once —, the body run, the copies written back); each caller binds its own in-outs where its
    evaluation order puts them (an invoke before it locates its instance, an FB call after), so no evaluation moved.
    `runner.ts` (108): `RunOptions`, `Runner`, `resolvePath`, `shown`, `run`. `resolvePath` now turns the IDE path (`ir/path`
    `parsePath`) into a `Place` — slot or global root, a field step per name, an index step per segment (a LINT constant, the
    dimension's lower bound and length) — and lands it with `Frame.locate`: no second walker. Deviations: (a) the VAR_STAT
    redirect stays in `resolvePath` (a field of the FB's layout that is a static restarts the place at its global) — `locate`
    walks `Place`s, which lowering already resolves statics into, so it has no static to handle; (b) `LoopGuardError` sits in
    `machine.ts`, where the loop throws it, not `runner.ts` (§4.9) — `runner.ts` imports `machine.ts`, so the other way is an
    import cycle; (c) a path index outside its dimension now throws `indexOutOfBounds` (the old walk read `undefined`, or planted
    a stray key on a `set`) — no harness path does it (S identical). The inline `import()` types are named imports; the stacked
    "first line of `bind`'s doc" is `bind`'s own doc; the orphan comment is gone; the interpreter's header doc (and its
    `ponytail:` note) heads `machine.ts`. `interp/index.ts` exports `LoopGuardError`, `run`, `Runner`, `RunOptions` — no `Val`
    (no consumer imported it). Ceiling `interp/interp.ts` removed. S ✓ identical (5357 fixtures, 161 s).
- [x] 1.4.2 `pipeline/index.ts`.
  - What: `load` moves unchanged (same signature and return) from `transpile/index.ts:58-66`; `lowerAndEmit` is added; the barrel
    re-exports both. Tests that call lowerSource+emitRust in a pair use `lowerAndEmit`.
  - Where: `transpile/pipeline/index.ts`, `transpile/index.ts`, `index.test.ts`, test callers.
  - Accept: G, S.
  - Depends: 1.4.1.
  - Done 2026-10-07 (step 1.4). `pipeline/index.ts`: `load` (same signature, same throw text) and `lowerAndEmit(source, name?,
    libraries) -> { pou, emitted }` over one private `lowered` (the refusal throw, once). `transpile/index.ts` ends with
    `export { load, lowerAndEmit } from "./pipeline/index.js"`. `index.test.ts`: `lowerAndEmit` added to the surface (the one
    deliberate edit). Callers switched: the one pair that only lowers and emits — `emit.test.ts` "every emitted statement line
    maps back to an ST span". Not switched, each because the pair does more than `lowerAndEmit` returns: every other
    `emit.test.ts` pair asserts `diagnostics` (or passes `loopGuard`), `snapshot.test.ts` emits twice with two options, the
    library tests lower through their own project helpers, and the conformance/scripts callers hold an already-lowered `pou`.
- [x] 1.4.3 Split `interp/interp.test.ts` into `pipeline/{arith,control,calls,aggregates,pointers,time,strings}.test.ts`.
  - What: the charAt/setChar unit cases (1164-1222) go to `semantics/string.test.ts`.
  - Where: `transpile/pipeline/*.test.ts`, `semantics/string.test.ts`.
  - Accept: G, T.
  - Depends: 1.4.2.
  - Done 2026-10-07 (step 1.4). Each test moved verbatim with the comment above it, under its describe's own title (so every
    `describe › title` line stays): `arith` 18 core tests + "a CONSTANT from an overflowing expression" + "MAX / MIN / LIMIT on a
    NaN and a signed zero" (340 lines); `control` 10 + "SEL / MUX / LIMIT with side-effecting arguments" + "no iteration cap"
    (256); `calls` 11 (359); `aggregates` 6 (124); `pointers` 4 (130); `time` 4 (94); `strings` the STRING describe's five
    store/literal/conversion tests (44). `semantics/string.test.ts` (42): the STRING describe's five `s[i]` tests — end to end
    through `load`, as they were (the cases are interpreter runs of `charAt`/`setChar`, not unit calls; rewriting them would
    change tests). Ceiling `interp/interp.test.ts` removed. T (`suite-snapshot --dirs src/transpile`): 343 titles, every
    pre-step title present, the one new title 1.3.8's.
  - Step 1.4 end: `bun typecheck` clean; `bun run lint` green (size 10 ceilings); `bun test src/transpile scripts` 377 pass, 0
    fail.
  - Gate 1.3a-1.5b (2026-10-07), the review's findings on 1.3 and 1.4 (each failing test first; the gate's numbers under
    1.5.10):
    - `semantics/numeric.cases.ts` was held to nothing (1.3.8; low, fixed): its header claimed the twin harness checks it,
      but 1.5.15 is not built, and `convert.test.ts` called `realToInt` directly (skipping `coerce`'s routing, ignoring
      `input.from`). New `test/conformance/numeric-cases.test.ts` (under `test/` — rule 6 keeps `src/` off the recordings)
      reads `codesys.run.json` for each case's named fixture: the recorded `inst.out` must be `<to>#<expected>` and the
      recorded `inst.v` the case's `input.value` (`Math.fround` for a REAL) — 192 checked, 0 bad today; red when one cell of
      the table is changed (tried: `r2i_real_to_byte_above_max` 252 → 253 fails it). `convert.test.ts` now runs
      `fit(coerce(value, to, from), to)`; `realToInt` lost its `export` (its one outside reader is gone); the header says
      what holds the table until 1.5.15 takes the check over.
    - 1.4.1's out-of-range path throw was swallowed by two harnesses (low, fixed): `backends.test.ts` `interpreterOutcome`
      `continue`d on a throwing `runner.get` and `compareRust`/the sweep then skipped a path with no interpreter value — the
      place silently left the comparison. A throwing read is now the value `unreadable: <message>` (compared like any other,
      so a Rust value there is a divergence) and a Rust-printed path with no interpreter answer is a divergence, not a
      `continue`. Test "a place the interpreter cannot read is an answer to compare…" (red before: `undefined`).
      `transpile-confidence.ts` `interpOutcome`: the seed `runner.set` sits OUTSIDE the fault catch, so a refused seed throws
      as the harness error it is instead of reading as the program faulting; test "an edge seed the interpreter refuses
      throws…" (red with the set back inside the catch). S `edge` identical — no harness path reached either.
    - Stale citations (low, fixed): `lower/storage.ts`'s comment on `constantValue` (now `semantics/fold.ts`, not `ir/`),
      `check-coverage-six.ts`'s "coerce() has a catch-all" (it now refuses by name, `fromText`). The fixture note in
      `oop/lifecycle.ts` is 1.5's (under 1.5.10). Left as listed before: `prelude.ts`'s emitted Rust text (1.5.11) and
      `transpile-confidence.ts`'s LEAN text "ir/evaluate.ts" (1.9.3).
    - `IecFault` only partly applied (1.3.3; low, fixed): interp's three fixed-text faults — the null dereference in
      `frame.ts` `locate` and in `machine.ts` `select`, the no-instance in `dispatch` — throw `IecFault` now (same class
      chain and message). Tests: `pipeline/pointers.test.ts` "a null dereference is an IecFault" 2 (one-target pointer
      through the guarded place, several-target pointer through `select`), `pipeline/calls.test.ts` "a call through a null
      interface is an IecFault" — all three red before (`RangeError`). `new RangeError(FAULT_TEXT` no longer appears; the
      two parametric texts (`indexOutOfBounds`, `characterOutOfRange`) stay plain `RangeError`s.

### 1.5 `emit/rust/`

- [x] 1.5.1 `Printer` methods become module functions `(p: Printer, …)` inside emit.ts (mechanical `this`→`p`).
  - Where: `emit/rust/emit.ts`.
  - Accept: G, S.
  - Depends: 1.2.1.
  - Done 2026-10-07 (step 1.5a). `Printer` keeps only its state (constructor and fields, the `private`s dropped so the
    functions reach them); its 18 methods are module functions `(p: Printer, …)`: `globalsArg`, `initOf`, `globalsParams`,
    `inFrame`, `lendMut`, `lend`, `copiesBack`, `lentCopies`, `guarded`, `guardLine`, `place`, `movedOut`, `push`, `code`,
    `negated`, `expr`, `block`, `stmt` (the three getters `globalsArg`, `globalsParams`, `code` included). Mechanical, by script:
    `this.` → `p.`, `p.m(` → `m(p, `; first the parameters that would shadow it renamed (`place(p: Place)`/`movedOut(p: Place)`/
    `select`'s `read = (p: Place)` → `at`; `lendMut`/`guarded`/`guardLine`'s `place` → `target`) and the free `initOf` named
    `initOfValue` (the method took its name). S `ir,rust` identical.
- [x] 1.5.2 Split the giant functions in place.
  - What: design.md §4.0: `expr` (574-842) into one function per node kind, `stmt` (850-988) per statement kind, `emitRust`
    (1158-1323) into struct/init/scan/routine/runtime assembly functions — still in emit.ts.
  - Where: `emit/rust/emit.ts`.
  - Accept: G, S; no function in emit.ts over 80 lines.
  - Depends: 1.5.1.
  - Done 2026-10-07 (step 1.5a). `expr` is a dispatch over `exprInvoke`, `exprDispatch`, `exprSelect`, `exprLoad`, `exprConvert`,
    `exprBuiltin`, `exprUnary`, `exprBinary` (const and fresh stay one-line arms); `stmt` over `stmtAssign`, `stmtIf`,
    `stmtSwitch`, `stmtLoop`, `stmtBreak`, `stmtContinue`, `stmtCall` (return, eval inline) — each arm's comments moved with it.
    `exprBuiltin` was itself 89 lines: it is the name → printer table `BUILTINS` (a `Record<IrBuiltinName, BuiltinPrinter>`, so
    a builtin without a printer is a compile error; the runtime throw by name stays for a name the type does not know) with the
    shared printers `maxMin`, `shift`, `rotate`, `logarithm`, `math` — the table 1.5.7 asks for, built here so the builtins are
    split once. `emitRust` (now 19 lines) over `printerFor`, `storageOf`, `printStruct` (one block for all four structs —
    `Globals`, `Programs`, each layout, the POU — byte-identical, its `members` callback printing inside the `impl`),
    `printLayout`, `printCall`, `printPou`, `appendRuntime`, `withPrelude`. No function in emit.ts over 80 lines (the size
    warning list fell 16 → 13).
- [x] 1.5.3 `names.ts`.
  - What: `snake`, `RUST_KEYWORDS`, `RESERVED_FN_NAMES`, `fieldNames` (with its stranded doc from 133-137), `rustName`, `baseFnName`,
    `routineFnNames`, `globalsParams`/`globalsArgs`. The four `g`/`prg` renderings go through one builder only where the text is
    identical; the ones that differ are listed here (7.7.5's input). `tmp(purpose, n)` produces the existing `__` spellings exactly; the
    unprefixed `t`, `program` and `v` stay (7.8.10).
  - Where: `emit/rust/names.ts`, `names.test.ts`.
  - Accept: G, S.
  - Depends: 1.5.2.
  - Done 2026-10-07 (step 1.5a). `emit/rust/names.ts`: `GlobalsUse`, `tmp`, `rustName`, `snake`, `RUST_KEYWORDS`, `fieldNames`
    (its stranded doc — stacked above `hasStatementAfterReturn` — now on it), `globalsArgs`, `globalsParams` (both over a
    `GlobalsUse`, which `Printer` satisfies), `RESERVED_FN_NAMES`, `baseFnName`, `routineFnNames`. The four `g`/`prg`
    renderings: `globalsArg`, `globalsParams`, `emitRust`'s `reserved` and the `init`/`scan` headers' `", g: &mut Globals"`
    chain — ALL four print identical text, so all go through `globalsArgs`/`globalsParams` (`reserved` = `globalsArgs`, the
    headers = `globalsParams` joined with `, `); none differs. `tmp(purpose, n?)` = `__<purpose>[_<n>]`; every `__` temporary
    goes through it (`arg`, `copy`, `lent`, `guard` numbered; `program`, `result`, `back`, `rot`, `mod_l`, `mod_r`, `bit_v`,
    `bit_w`); the unprefixed `t` (TRUNC), `program` (the call statement's move-out) and `v` (an aggregate's `initOf`) stay.
    `emit/rust/index.ts` re-exports `fieldNames`, `rustName`, `snake` from it (surface unchanged). Tests: `names.test.ts` 2
    (`tmp`'s spellings; the args/params lists for all four combinations). S `ir,rust` identical.
- [x] 1.5.4 `types.ts`.
  - What: `rustType`, `inoutType`, `genericList`, `isCopy`, `stringType`, `isString`, `isReal32` on `types/predicates` (the three
    string spellings and six real spellings collapse only where identical; the rest listed here).
  - Where: `emit/rust/types.ts`.
  - Accept: G, S.
  - Depends: 1.5.3, 1.1.5.
  - Done 2026-10-07 (step 1.5a). `emit/rust/types.ts`: `emittedFamily` (§4.9), `rustType`, `inoutType`, `genericList`,
    `stringType`, `isString`, `stringPath` (here, not `place.ts` as §4.6 says: `values.ts` `literal` prints through it, and a
    type's constructor path is a type rendering — in `place.ts` it would make the values leaf depend on the place printer),
    `isReal32`, `isCopy`. Collapsed (identical answers): real — `isReal32` = `floatBits(t) === 32`, `literal`'s REAL-overflow
    test → `isReal32`, `exprUnary`'s and `exprBinary`'s local `isReal` and `negated`'s `overReals` → `types` `isReal`, `abs`'s
    `t?.family === "real"` → `isReal` (the sixth, MAX/MIN/LIMIT, already asked `isReal`); string — `inoutType`'s and
    `stmtAssign`'s `elementary && family === "string"` → `stringKind(t) !== undefined`. Not collapsed: `isString` and
    `stringType` read the type's NAME (`STRING`/`WSTRING`), which equals `stringKind` only if every string Type is named its
    kind — not verified (1.1.5's list); `emittedFamily`'s BIT-as-bool decision and the convert arm's family comparisons are
    RC 31's (6.9). `index.ts` re-exports `rustType` from here. S `ir,rust` identical.
- [x] 1.5.5 `values.ts`.
  - What: `literal`, `shortestF32`, `byteString`, `unitsLiteral`, and both `initOf` functions (the free one is folded in by 5.4).
  - Where: `emit/rust/values.ts`.
  - Accept: G, S.
  - Depends: 1.5.4.
  - Done 2026-10-07 (step 1.5a). `emit/rust/values.ts`: `Layouts` (the program's layouts with their fields' Rust names),
    `initOfValue` (the free `initOf`), `byteString`, `unitsLiteral`, `shortestF32`, `literal`, `initOf(layouts, type, init)` —
    the aggregate one takes the layouts, not the printer (it read nothing else of it), so the leaf imports only `names.ts`
    and `types.ts`; callers pass `p.layouts`.
  - Step 1.5a end: `bun typecheck` clean; `bun run lint` green (emit.ts ceiling lowered 1366 → 1152; `emit.test.ts` back at
    969 — its three imports are one from `./index.js`); `bun test src/transpile scripts` 379 pass, 0 fail; S (all layers) ✓
    identical, 5357 fixtures, 159 s.
- [x] 1.5.6 `printer.ts` and `place.ts`.
  - What: the Printer state, `Frame`, `inFrame`, `push`, `withUri(uri, fn)` (the two save/restore copies at 1046/1098 and 1219), the
    guards, lend and copy-back helpers; `place`, `movedOut`, `stringPath` (the stale stacked doc at 535-539 is deleted).
  - Where: `emit/rust/printer.ts`, `place.ts`.
  - Accept: G, S.
  - Depends: 1.5.5.
  - Done 2026-10-07 (step 1.5b; 1.5.6-1.5.10 were one split of emit.ts by a plan — each declaration moved verbatim with its
    doc, every module's imports rebuilt from what it uses, and a declaration exported only when another module uses it).
    `printer.ts` (117): `Printer`, `Frame`, `inFrame`, `withUri`, `push`, `code`, `lendMut`, `lend`, `copiesBack`,
    `lentCopies`, `guarded`, `guardLine`. `withUri(p, uri, run)` replaces both save/restore copies: `printRoutine` (now
    `withUri` around a private `printRoutineIn`) and the FB `call()` body. `place.ts` (71): `place`, `movedOut` — its stale
    first doc deleted, its current one kept. `stringPath` is in `types.ts` (1.5.4's note).
- [x] 1.5.7 `expr.ts`, `convert.ts` and `builtins.ts`.
  - What: the builtins as a name→printer table; `unparen`/`unparenHead`, `WRAPPING`, `INFIX`, `INVERSE`, `negated` in `expr.ts`;
    `castTo`, `fromF64` in `convert.ts`; `RUST_MATH` in `builtins.ts`.
  - Where: `emit/rust/expr.ts`, `convert.ts`, `builtins.ts`.
  - Accept: G, S.
  - Depends: 1.5.6.
  - Done 2026-10-07 (step 1.5b). `expr.ts` (180): `unparen`, `unparenHead`, `WRAPPING`, `INFIX`, `INVERSE`, `negated`, the
    `expr` dispatch, `exprLoad`, `exprUnary`, `exprBinary` (const and fresh inline). `convert.ts` (79): `castTo`, `fromF64`,
    `exprConvert`. `builtins.ts` (123): `RUST_MATH`, `exprBuiltin` and the name → printer table `BUILTINS` built in 1.5.2.
- [x] 1.5.8 `calls.ts`.
  - What: invoke, dispatch, select, the call statement, and one `callArguments` where the two builders print identical text (the
    difference, if any, listed here). The program move-out stays two spellings until 7.8.10.
  - Where: `emit/rust/calls.ts`.
  - Accept: G, S.
  - Depends: 1.5.7.
  - Done 2026-10-07 (step 1.5b). `calls.ts` (113): `exprInvoke`, `callArguments`, `exprDispatch`, `exprSelect`, `stmtCall`.
    `callArguments(p, inputs, inouts, params, lent, slots)` is the one builder: the invoke's and the FB call's argument lists
    print identical text — `g`/`prg`, the inputs (none for an FB call: its inputs are stores before the line), each in-out
    through `lend`, each lent instance through `lendMut` — so there is no difference to list. The program move-out stays two
    spellings (`__program`/`__result` in `exprInvoke`, `program` in `stmtCall`) until 7.8.10.
- [x] 1.5.9 `stmt.ts` and `loops.ts`.
  - What: `block`, the statement arms; loop/break/continue. `hasStatementAfterReturn` and `nestedBlocks` go to `ir/walk.ts`
    (`exitsAfter`, `blocksOf`) with today's behaviour.
  - Where: `emit/rust/stmt.ts`, `loops.ts`, `ir/walk.ts`.
  - Accept: G, S.
  - Depends: 1.5.8, 1.2.3.
  - Done 2026-10-07 (step 1.5b). `stmt.ts` (99): `block`, the `stmt` dispatch (return, eval inline), `stmtAssign`, `stmtIf`,
    `stmtSwitch`. `loops.ts` (55): `stmtLoop`, `stmtBreak`, `stmtContinue`. `hasStatementAfterReturn` and `nestedBlocks` are
    deleted: 1.2.3's `ir/walk.ts` `exitsAfter` and `blocksOf` are the same two functions (same arms, same early returns), so
    `printRoutine` asks `exitsAfter`; `walk.test.ts` already covers both. (The loop labels still come from the printer's own
    `loops` stack; `ir/walk.ts` `loopUses` replaces it in 2.8.)
- [x] 1.5.10 `routine.ts`, `structs.ts` and `module.ts`.
  - What: `printRoutine`; `printStruct` reproducing all four blocks byte-identically, `defaultImpl`; `emitRust`, `Emitted`. The stray blank
    line at 1099 and the misplaced iec_div comment (1268-1270) are fixed in the move (neither reaches the output).
  - Where: `emit/rust/routine.ts`, `structs.ts`, `module.ts`.
  - Accept: G, S.
  - Depends: 1.5.9.
  - Done 2026-10-07 (step 1.5b). `routine.ts` (106): `printRoutine`, `printRoutineIn`, `bodyParams` (the one parameter
    builder after `g`/`prg` and the inputs: each in-out's `inoutType`, then each lent instance — a routine and an FB's `call()`
    printed the same text through two copies), `printCall` (the FB's `call()`, §2.6's "FB call()"). `structs.ts` (50):
    `defaultImpl`, `printStruct` (1.5.2's one block for `Globals`, `Programs`, each layout and the POU). `module.ts` (200):
    the emitter's header doc, `Emitted`, `EmitOptions`, `emitRust`, `storageOf`, `printerFor`, `printLayout`, `printPou`,
    `appendRuntime` (the inline helpers until 1.5.11), `withPrelude`. The stray blank line closing `printRoutine` is gone; the
    iec_div comment ("The emitted twin of `arith`'s zero-divisor check…") now stands above the `iec_div` block. `emit.ts`
    (52) keeps only `rustAccess` (1.5.12 moves it) — its ceiling is removed (a file under 400 lines is a stale entry).
    `emit/rust/index.ts` exports `emitRust`, `Emitted`, `EmitOptions` from `module.ts`, `rustAccess` from `emit.ts`,
    `fieldNames`, `rustName`, `snake` from `names.ts`, `rustType` from `types.ts` — the transpile surface unchanged
    (`index.test.ts` green, no edit). Re-pointed: `prelude.ts`'s doc (not its Rust text) and
    `fixtures/conversions/real-to-integer.ts`'s comment (`emit/rust/convert.ts`).
    Also in this step (export hygiene, no behaviour): names exported but used only in their own file lose `export` —
    `RUST_KEYWORDS`, `RESERVED_FN_NAMES` (names.ts), `initOfValue`, `byteString`, `unitsLiteral`, `shortestF32` (values.ts),
    `Signal` (interp/machine.ts, step 1.4's file), `toText`, `fromText` (semantics/convert.ts, step 1.3b's file).
  - Step 1.5b end: `bun typecheck` clean; `bun run lint` green (size 9 ceilings, 13 functions warned — none in `emit/rust`;
    every `emit/rust` file ≤ 200 lines but `emit.test.ts`); `bun test src/transpile scripts` 379 pass, 0 fail; S (all layers)
    ✓ identical, 5357 fixtures, 163 s.
  - Gate 1.3a-1.5b (2026-10-07). The review's four findings were all low and all fixed, each failing test first — the
    three on 1.3/1.4 are written under 1.4 (Step 1.4 end); the one on 1.5: `oop/lifecycle.ts`'s task-29 fixture note cited
    `emit/rust/emit.ts baseFnName`, now `emit/rust/names.ts` (no output change; `map.generated.ts` unchanged).
    Numbers: `bun typecheck` clean; `bun run lint` green (layering 3 known; size 9 ceilings, 13 functions warned; citations
    553 missing, warning); targeted `bun test src/transpile scripts` + the two new conformance tests 395 pass, 0 fail; FULL
    `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset) 8477 pass, 35 skip, 432 todo, 0 fail, 8944 tests in 234 files,
    570 s; S (`snapshot:transpile check`, ir/rust/outputs/edge) ✓ identical, 5357 fixtures, 159 s; `rate:fixtures`
    regenerated — `map.generated.ts` unchanged (edge agree 3046, disagree 0, not-run 179); `bun run check` (repo root) 18
    passed. Committed in two commits, not five: 1.3a, 1.3b and 1.4 share files (`interp/interp.ts` is edited by 1.3 and
    split by 1.4; `semantics/convert.ts` by 1.3a and 1.3b), as do 1.5a and 1.5b (`emit/rust/emit.ts`), and no intermediate
    tree of either was kept — so one commit is 1.3a+1.3b+1.4 (with this gate's 1.3/1.4 fixes), the other 1.5a+1.5b (with
    the lifecycle note and the 1.5 ticks). 1.5b's export hygiene in `interp/machine.ts` and `semantics/convert.ts` rides
    with the first (its files).
- [x] 1.5.11 `runtime/`.
  - What: `prelude.ts` splits into `runtime/string.ts`, `text.ts`, `parse.ts`, `numeric.ts` (iec_max/min); the inline helpers at emit.ts
    1264-1301 go into `numeric.ts` and `pointer.ts`. `runtime/index.ts` is a registry with `runtimeText(id)` that reproduces TODAY's
    gating exactly (the string blob on `IecStr`, plus per-helper sniffing). The source-map shift uses the registry's line count; the map's
    `size` exclusion counts exactly the lines the string prelude had (design.md §8). `prelude.ts` is deleted; the two deep
    `STRING_PRELUDE` consumers (`fixtures.test.ts:80`, `support/transpile-confidence.ts:24`) import `runtimeText("string")` in the
    same commit — no re-export shim.
  - Where: `emit/rust/runtime/*`, `module.ts`, the two consumers.
  - Accept: G, S, M identical (size median unchanged).
  - Depends: 1.5.10.
  - Done 2026-10-07 (step 1.5c). `emit/rust/runtime/`: `string.ts` (`IEC_STR`, the string type), `numeric.ts` (`IEC_MAX_MIN`
    — MAX/MIN over a string, which rides in the string blob — and the inline helpers `IEC_R2I64`, `IEC_R2I32`, `IEC_FMAX`,
    `IEC_FMIN`, `IEC_LOG`, `IEC_POW`, `IEC_DIV`), `text.ts` (`TEXT`), `parse.ts` (`PARSE`), `pointer.ts` (`IEC_DEREF`) — each the
    prelude's or `appendRuntime`'s text cut verbatim. `runtime/index.ts`: the registry `{ id, deps, rust, usedBy }`,
    `runtimeText(id)` (a helper's text then its deps'), `usedIn(id, code)` (phase 1's sniffing) and `INLINE` (the eight helpers
    appended after the code, in today's order). Today's gating exactly: `string` = `IEC_STR` + deps `iec_max_min`, `text`,
    `parse` (the old blob byte for byte), in front of a program naming `IecStr`/`IecWString`; each `INLINE` helper after the code
    when the code (as it stands after the ones before it) calls it. `module.ts` `appendRuntime` is the loop over `INLINE`;
    `withPrelude` shifts the source map by `runtimeText("string")`'s line count. `prelude.ts` deleted; the two deep consumers
    (`fixtures.test.ts`, `support/transpile-confidence.ts`) import `runtimeText` from `emit/rust/runtime/index.js` (no shim;
    there is no `support/README` to list the deep path in — the import carries a comment instead). Tests:
    `runtime/index.test.ts` 3 (the blob's parts and order, its sniffing, each INLINE helper defines its fn and is asked for by
    its call only). S (all layers) ✓ identical, 5357 fixtures, 151 s. M: the `size` exclusion reads the same blob
    (`preludeLines` = `runtimeText("string")`'s lines), so the map is unchanged by construction (rate:fixtures at the step end).
- [x] 1.5.12 `rustAccess` to `test/conformance/support/rust-access.ts`; the barrel narrowed.
  - What: `emit/rust/index.ts` exports only `emitRust`, `Emitted`, `rustType`; the transpile barrel drops `fieldNames`, `snake`,
    `rustAccess`, `sameName`, `holdsCall`, `peelArray`, `elementOf`, `isBit`, `defaultValueOf` (one deliberate `index.test.ts` edit per
    name). Consumers changed in the same commit: `fixtures.test.ts:47`, `backends.test.ts:31`, `support/transpile-confidence.ts:23`,
    `test/libraries/{standard,stringutils,util}.test.ts` (design.md §2.1.1 table).
  - Where: `emit/rust/index.ts`, `transpile/index.ts`, `index.test.ts`, `test/conformance/support/rust-access.ts`, the consumers.
  - Accept: G, S; `index.test.ts` lists exactly design.md §2.1.1.
  - Depends: 1.5.11, 1.4.2.
  - Done 2026-10-07 (step 1.5c). `rustAccess` → `test/conformance/support/rust-access.ts` (verbatim; imports `fieldNames` from
    `emit/rust/names.js`, `parsePath`/`namesVariable` from `ir/path.js` — test support may deep-import src). `emit/rust/index.ts`
    exports `emitRust`, `type Emitted`, `rustType` only (`EmitOptions` stays `module.ts`'s, `rustName` leaves with `fieldNames`
    and `snake`); `ir/index.ts` no longer re-exports `holdsCall` (its four `lower/` importers take it from `ir/walk.js`).
    `index.test.ts`: five deliberate removals — `fieldNames`, `holdsCall`, `rustAccess`, `rustName`, `snake`. NOT removed:
    `LoopGuardError` (a harness's loop guard, used by `backends.test.ts` and `transpile-confidence.ts`) and `lowerDiagnostic`,
    which design.md §2.1.1 does not list but no task removes either — so `index.test.ts` lists §2.1.1 plus those two (1.7.20's
    dead-export pass is where `lowerDiagnostic`'s place is decided). Consumers re-pointed in the same tree:
    `fixtures.test.ts`, `backends.test.ts`, `support/transpile-confidence.ts`, `support/transpile-confidence.test.ts`,
    `test/libraries/{standard,stringutils,util}.test.ts`. S ✓ identical (with 1.5.11's run).
- [x] 1.5.13 Split `emit.test.ts` per design.md §4.6.
  - What: text shapes → `names/values/expr/stmt/calls/loops.test.ts`; the compile suite (497-690) → `test/conformance/emit-build.test.ts`;
    the VAR_TEMP reset describe (800) → `values.test.ts`; the cap describe (398) stays (in `loops.test.ts`) until 2.3. The temporary lint
    exception from 1.0.1 is removed.
  - Where: `emit/rust/*.test.ts`, `test/conformance/emit-build.test.ts`, `scripts/check-layering.ts`.
  - Accept: G, T.
  - Depends: 1.5.12.
  - Done 2026-10-07 (step 1.5c). `emit.test.ts` (969) split by a plan, each test verbatim with its comments and inside a
    describe of its old name: `names.test.ts` (keyword/snake fields, hidden slot, snake_case, generated bindings, routine
    names; the 1.5.3 tests kept), `values.test.ts` (zero init, negative constant, VAR_TEMP reset), `types.test.ts` (the IEC
    mapping, TIME/LTIME), `expr.test.ts` (array-index parentheses, REAL loop test negated, enum/THIS^, BOOL AND/OR, MOD/NOT,
    negation), `place.test.ts` (pointer, string cursor), `calls.test.ts` (FB call, VAR_IN_OUT through a reference, a
    PROGRAM's METHOD), `routine.test.ts` (METHOD/FUNCTION), `module.test.ts` (Globals/Programs, the flat struct, integer wrap,
    source map), `builtins.test.ts` (LIMIT, REAL MAX/MIN/LIMIT RC 28, LIMIT/MUX order RC 41, math/ABS, EXPT, bit operations),
    `convert.test.ts` (conversions, BIT as BOOL RC 31, LTIME_TO_STRING RC 32), `loops.test.ts` (CONTINUE, three loop forms,
    "no iteration cap", FOR limit of another type), `stmt.test.ts` (CASE) — every file ≤ 164 lines. The compile suite,
    "no iteration cap, compiled", LREAL tie (RC 33) and LDT/LDATE/LTOD (RC 12) → `test/conformance/emit-build.test.ts`
    (354). No `src/` test imports `test/` any more: `KNOWN_TRANSPILE_VIOLATIONS` is empty. T: `bun scripts/suite-snapshot.ts
    --compare` (before: `--dirs src/transpile/emit/rust`; after: `+ test/conformance/emit-build.test.ts`) ✓ identical, 57 tests.
- [x] 1.5.14 Delete `emit.ts`; lower the ceilings.
  - Where: `emit/rust/`, `scripts/check-size.ts`.
  - Accept: G, S; `emit.ts` and `emit.test.ts` are gone; every `emit/rust/**` file is 400 lines or less and off the ceiling list.
  - Depends: 1.5.13.
  - Done 2026-10-07 (step 1.5c). `emit.ts` deleted (empty once 1.5.12 moved `rustAccess`); `emit.test.ts` deleted (1.5.13).
    `check-size.ts`: the `emit/rust/emit.test.ts` ceiling removed; every `emit/rust/**` file ≤ 200 lines, none on the list
    (the list: 8 ceilings, all `lower/`). `lower/lower.ts` 857 → 849 (its symbols import on one line, after `holdsCall` took a
    line of its own). S ✓ identical, 5357 fixtures, 166 s.
- [x] 1.5.15 The twin harness.
  - What: `test/conformance/runtime-twins.test.ts` per design.md §8, running `text.cases.ts` against `runtime/text.ts` and
    `numeric.cases.ts` against `runtime/numeric.ts`; a case naming a recording is also checked against it. Divergences found today
    (e.g. RC 32/33 cells) are marked expected failures with their RC.
  - Where: `test/conformance/runtime-twins.test.ts`.
  - Accept: G; every case either passes or is an expected failure naming its RC.
  - Depends: 1.5.11, 1.3.8.
  - Done 2026-10-07 (step 1.5c). `test/conformance/runtime-twins.test.ts`: per table one Rust program — the runtime snippet
    (`runtimeText`) plus a generated `main` printing every case — built through `support/rustc-cache.ts` `buildRust`, each
    line required to equal the case's `expected`; floats passed by their bits (`f64::from_bits`), a REAL case through
    `f32::from_bits(..) as f64` as the emitter widens it; REAL → integer printed as `exprConvert` prints it (the destination's
    register half, then `as` its Rust type). Tables run: `LREAL_TEXT_CASES` (25; the step reported 26 — the table holds 9+5+8+3) + `LREAL_TIE_CASES` (7, new in
    `text.cases.ts`, recorded `tr_33_fmt_lreal_tie`) against `iec_lreal_text`; `LONG_CALENDAR_TEXT_CASES` (11, new,
    recorded `tr_12_fmt_long_dates`) against `iec_ldt/ldate/ltod_text`; `REAL_TO_INT_CASES` (192) against `iec_r2i32`/
    `iec_r2i64`. Recordings: every case naming one is held to `codesys.run.json` — the REAL → integer check moved here from
    `test/conformance/numeric-cases.test.ts` (deleted; same test title), and the new text cells are checked likewise.
    `text.test.ts` runs the two new tables against `semantics/text.ts` (+2 tests). Every case passes on both sides — no
    divergence to mark (RC 32/33 were fixed upstream before this change). 5 tests, 0 fail.
  - Step 1.5c end: `bun typecheck` clean; `bun run lint` green (layering 1 known — the frontend's, transpile's list empty;
    size 8 ceilings, 13 functions warned; citations 595 missing, warning — up from 553 because `emit.ts`/`emit.test.ts`/
    `prelude.ts` no longer exist: 62 authored NOTES and LEAN texts cite `emit.ts:NNN` lines of 2026-09-29, left for 1.9.3
    rather than re-pointed by guess); targeted `bun test src/transpile scripts` + `emit-build`, `runtime-twins`, `backends`,
    `transpile-confidence.test`, `test/libraries` 430 pass, 0 fail; S ✓ identical (5357 fixtures, 166 s).
  - Gate 1.5c-1.6d (2026-10-07), the two findings on 1.5c — both low, both fixed, failing test first:
    (1) `LREAL_TEXT_CASES` named no recording, so the twin harness never held it to CODESYS — 1.3.6's deferral ("1.5.15
    attaches them") had been dropped. Each cell now names its `fmt_lreal_<slug>` fixture (`inst.out`), 24 of 25; the -0
    cell names none, by name and with the reason: `fmt_lreal_negative_zero` computes `0.0 - seed * 0.0`, which IEEE 754
    rounds to +0 (its `v` is `LREAL#0`), so no fixture ever ran a negative zero — the cell is `unrecorded(...)`, and a test
    pins that it is the only unrecorded text case. (2) the tie (tr_33) and long-calendar (tr_12) cases checked only
    `expected`: `CaseRecording` now carries `input` (the variable holding the input the fixture ran — `inst.v`,
    `inst.v<i>`; required, so the REAL → integer cells state theirs too) and the harness holds every recorded case's input:
    an LREAL input by `Object.is` against the recorded `LREAL#…`, a long-calendar input by rendering it as the monitor
    shows it (u64 read signed, the floored day — LDATE `1715-6-13` where LDATE_TO_STRING prints `1715-06-14` — unpadded
    fields, nine fraction digits when not zero) against `inst.v<i>`. Red first (4 fail: the -0 pin and three missing
    `recording.input`s), green after; every recorded text and input agrees with the table — no data changed.
    `runtime-twins.test.ts` 8 tests (was 5), 0 fail.

### 1.6 `lower/` (split giant functions in place first, then move leaves first; each file moves with its tests from 1.8.1)

- [x] 1.6.1 Split `lowerInvoke` in place.
  - What: design.md §4.0: the ANY binding, the cursor binding, the form-2 borrowed binding, output bindings, the program move-in/out and
    argument binding become named functions in calls.ts with explicit parameters.
  - Where: `lower/calls.ts`.
  - Accept: G, S; `lowerInvoke` is 80 lines or less.
  - Depends: 1.2.2.
  - Done 2026-10-07 (step 1.6a). `lowerInvoke` 341 → 26 lines over `InvokeBindings` (the routine, the instance, the inputs,
    the in-outs, the order they are written in, the ANY places) and `callHolds` (its held places): `invokeTarget` (which
    routine on which instance, or the interface dispatch) with `memberTarget` (`inst.M(…)`, the PROGRAM move-in/out checks),
    `positionalArguments`, `bindArgument` (one named argument) over `bindOutputArgument` (output bindings),
    `bindAnyArgument` (the ANY binding), `bindCursorArgument` (the cursor binding), `bindBorrowedArgument` (the form-2
    borrowed binding); then `bindOpenBounds`, `defaultInputs`, `bindInstanceInOuts`, `bindAnyTargets`,
    `bindUnconnectedOutputs` and `bindWhereWritten` (the freezes). Each returns `true | undefined` (undefined = refused,
    the diagnostic already pushed), so the body reads as the sequence it is; every comment moved with its code.
- [x] 1.6.2 Split `lowerCallStatement` and `lowerSuperCall` in place (input stores, in-out binding, open bounds, output copy).
  - Where: `lower/calls.ts`.
  - Accept: G, S; each 80 lines or less.
  - Depends: 1.6.1.
  - Done 2026-10-07 (step 1.6a). `lowerSuperCall` 21 lines over `superArguments` (input stores and in-out binding),
    `passOnDerivedInOuts`, `superOpenBounds`; `lowerCallStatement` 129 → 23 over `routineCallStatement` (a routine called
    as a statement — `null` when it calls an instance), `calledInstance` (the instance, its layout, the PROGRAM checks),
    `fbArguments` (in-out binding) over `fbInputStore` (input stores) and `fbOutputCopy` (output copy); `storeOpenBounds`
    and `movedInOut` unchanged.
- [x] 1.6.3 Split `lowerExpr` in place, one function per arm.
  - Where: `lower/expressions.ts`.
  - Accept: G, S; the dispatch is 80 lines or less.
  - Depends: 1.2.2.
  - Done 2026-10-07 (step 1.6a). `lowerExpr` 271 → a 23-line dispatch over `lowerLiteral`, `lowerName`, `lowerDeref`,
    `lowerUnary` (56), `lowerBinary` (over `pointerNullCompare`, `stringCompare` with `isStringValue`, and `arithmetic` —
    duration scaling, constant retyping, the meet, the REAL fold), `lowerMember` (over `anyDiSize` — the ANY `.diSize`
    read — and `partialAccess`); `call` stays `lowerBuiltin`.
- [x] 1.6.4 Split `lowerStmt` in place, one function per arm.
  - Where: `lower/statements.ts`.
  - Accept: G, S.
  - Depends: 1.2.2.
  - Done 2026-10-07 (step 1.6a). `lowerStmt` 192 → a 50-line dispatch (the `__TRY` note stays beside `default` until 1.6.16
    moves it) over `lowerAssign` (over `storeChar`, `lowerLatch`, `storeValue`), `lowerIf`, `lowerCase`, `lowerWhile`,
    `lowerRepeat`, `lowerExit`; `lowerFor` unchanged.
- [x] 1.6.5 Split `lowerBuiltin` in place, one function per builtin group.
  - Where: `lower/builtins.ts`.
  - Accept: G, S.
  - Depends: 1.2.2.
  - Done 2026-10-07 (step 1.6a). `lowerBuiltin` 177 → 29 lines over `lowerSystemCall` (SIZEOF, MOVE, `__POUNAME`,
    `__QUERYINTERFACE`, LOWER_BOUND/UPPER_BOUND, `__ISVALIDREF`), `lowerClock` (TIME(), LTIME()), the conversion names, the
    routine call, and `lowerValueFunction` (TRUNC, ABS, unary math) over `lowerShift`, `lowerMux`, `lowerExpt`,
    `lowerSelection` (MAX/MIN/LIMIT/SEL).
  - Step 1.6a end: `bun typecheck` clean; `bun run lint` green — the size ratchet's ceilings RAISED for the four files the
    splits grew (`lower/calls.ts` 1657 → 1803, `builtins.ts` 490 → 521, `statements.ts` 437 → 471, `expressions.ts` new at
    443; a split in place adds signatures and docs, and each file is dissolved by 1.6.14-1.6.18 — the reason is written on
    `CEILINGS`); functions over 80 lines 13 → 8 (`lowerInvoke`, `lowerExpr`, `lowerStmt`, `lowerBuiltin`,
    `lowerCallStatement` off the list); `bun test src/transpile scripts` 382 pass, 0 fail; S ✓ identical, 5357 fixtures,
    155 s.
- [x] 1.6.6 `initStep`'s closures become module functions taking `lw` (design.md §4.1 list).
  - Where: `lower/lower.ts`.
  - Accept: G, S; no closure over `lw` is left inside `initStep`.
  - Depends: 1.2.2.
  - Done 2026-10-07 (step 1.6b). `initStep` 383 → 60 lines; no closure over `lw` is left in it. Its shared state is one
    record, `InitStep` (the lowering, the span, the root's symbol and project-tree application, the `globalArguments` set,
    the `fbInitHeld` and `known` memos, the four statement lists `out`/`fbInitCalls`/`reapplied`/`slotCalls`, and
    `declaredInits`), handed to module functions: `initMethod(lw, fb)`, `pathFields(lw, fb)`, `fbInits(fb)`,
    `holdsFbInit(st, t)`, `ownProgram(st, place)`, `recordedArgument(st, …)`, `writesGlobal(lw, node, seen)`,
    `declaredArgs(lw, owner, name)`, `reaches(st, t)`, `unreached(st, where)`, and `visit(st, …)` (203 → 17) over
    `programFbInitsQuiet`, `callFbInits` (37) with `fbInitInput` (69, one FB_Init input incl. `rootsOwn`), `instancePaths`,
    `slotMethodCall`, `visitFields` (53, the field initializers interleaved, `layoutFields`) and `initializeUpTo` (its
    `from` cursor an explicit `{ from }`). `type Fb` is module-level. Every comment moved with its code.
- [x] 1.6.7 `lowerUnit`'s and `lowerSource`'s closures become module functions.
  - Where: `lower/lower.ts`.
  - Accept: G, S.
  - Depends: 1.6.6.
  - Done 2026-10-07 (step 1.6b). `lowerUnit` 95 → 35 lines over `ownMembers(unit, scope)`, `runsAsInstance(unit, scope)`
    (the old `asInstance`), `open(lowering, unit)` (the PROGRAM's ARRAY[*] in-out), `programBody` (a PROGRAM lowered as its
    own frame) and `slotRefusal` (shared address, reversed array, unrepresentable slot); `lowerSource` 45 → 21 over
    `lowerOnBase` (bind, lower, unbind); `lowerPrepared`'s `runnable` closure is `isRunnable`.
- [x] 1.6.8 `core/build.ts`.
  - What: `cast`, `binaryOf` (convert.ts 102-109) and `ZERO_SPAN` (lowering.ts 372; the inline re-spelling at lower.ts 766 is deleted).
  - Where: `lower/core/build.ts`.
  - Accept: G, S.
  - Depends: 1.6.7.
  - Done 2026-10-07 (step 1.6b). `lower/core/build.ts`: `cast`, `binaryOf` (from `convert.ts`), `ZERO_SPAN` (from
    `lowering.ts`, now with a doc and `= {`); `lowerPrepared`'s inline re-spelling of it deleted. `load`/`constOf` are not
    built (no task here names them; 1.7's consolidations). Moved by a tool (`mover.ts`, scratch): each declaration cut with
    its attached comments, a checker resolving which outer names it reads, every importer re-pointed, an import statement
    rewritten only when its names change — run for 1.6.8-1.6.10.
- [x] 1.6.9 `builtins/arity.ts`, a leaf.
  - What: `BUILTIN_ARITY`, `isConstantCallee`, `oneArgument`, which breaks the constants↔builtins import cycle.
  - Where: `lower/builtins/arity.ts`.
  - Accept: G, S; no cycle reported.
  - Depends: 1.6.8.
  - Done 2026-10-07 (step 1.6b). `lower/builtins/arity.ts`: `BUILTIN_ARITY` (builtins.ts), `isConstantCallee`
    (constants.ts) and `oneArgument(call)` — new, the one-positional-argument test four sites spelled out (MOVE and the three
    conversion checks in `lowerConversion`; `__ISVALIDREF` and SIZEOF test something else and keep their own). It imports no
    `lower/` file; `constants.ts` no longer imports `builtins.ts` (the cycle is gone). Rule 4b gains `LOWER_LEAF_FILES`
    (`builtins/arity.ts`): a leaf file of a non-leaf folder, open to the leaves, importing no `lower/` folder itself —
    design.md §2.4 makes arity "a leaf" that `values/fold.ts` asks, which the folder table alone would refuse.
    `scripts/check-layering.test.ts` +1 (the open edge clean, arity → core and values → builtins/builtins.ts named).
- [x] 1.6.10 `values/`.
  - What: `constants.ts` → `values/literals.ts` (incl. `inTicks`, `TEMPORAL_LITERAL_KINDS`), `values/fold.ts` (incl. `enumValueOf`),
    `values/enums.ts` (the orphan calendarOf doc at 249-254 fixed); `convert.ts` → `values/convert.ts`, `LINT_MAX` and
    `integerFoldType` → `fold.ts`, `stored` → `types/width` (1.1.6); `meetOperands` not yet (1.7.15).
  - Where: `lower/values/*`.
  - Accept: G, S.
  - Depends: 1.6.9, 1.1.6, 1.1.12.
  - Done 2026-10-07 (step 1.6b). `lower/values/`: `literals.ts` (`stringLiteralText`, `durationOf`, `TEMPORAL_LITERAL_KINDS`,
    `calendarOf` — its orphan doc, stacked above `TEMPORAL_LITERAL_KINDS`, now on it — `typedRealOf`, `inTicks`,
    `contextLiteralType`), `fold.ts` (`foldConstant`, `foldsToConstant`, `convertedConstant`, `enumValueOf`, `LINT_MAX`,
    `integerFoldType`), `enums.ts` (`enumStorage`, `enumeratorValue`, `enumConstant`), `convert.ts` (`convert`, `retype`,
    `adopt`, `valueAs`, `stored`, and — until their tasks move them — `beside`/`ownIntegerType` (1.7.15) and
    `refuseImplicitString` (1.6.16)). `stored` stays a `values/convert.ts` function: its core has been `types/width`
    `wrapToWidth` since 1.1.6, its guards are its callers' until 6.B.2, and `types/` cannot name `IrValue`. `constants.ts` and
    `convert.ts` deleted; `constants.test.ts` → `values/fold.test.ts`; `test/frontend/literal-agreement.ts` re-pointed.
    Known rule-4b edges (listed, each with its task): `values/*` → `lower/lowering.ts` (the `Lowering` type, until 1.6.21),
    `values/enums.ts` → `storage.ts` (`withStringCapacity`, deleted by 3.3).
  - Step 1.6b end: `bun typecheck` clean; `bun run lint` green (layering 6 known; size 9 ceilings — `lower/lower.ts`
    raised 849 → 986 by the module functions, `pointers.ts` 543 and `storage.ts` 657 by an import line each, `builtins.ts`
    lowered to 504, `expressions.ts` to 442; functions over 80 lines 8 → 5); `bun test src/transpile scripts` 383 pass,
    `test/frontend/literal-agreement.test.ts` pass; S ✓ identical, 5357 fixtures, 168 s.
- [x] 1.6.11 `storage/`.
  - What: `storage.ts` → `layout.ts`, `declare.ts`, `statics.ts`, `addresses.ts` (+ `addressSharedByInstances` from lower.ts); the init
    parts → `init/initial-values.ts` (incl. `runnableInit`) and `init/temp-resets.ts`; `bytes.ts`, `unions.ts` → `storage/`; `sizeOf`,
    `adrDifference` → `builtins/sizeof.ts`; `rootType` → `places/path.ts`; `foldedCall` → `values/fold.ts`; storage's `holdsCall` →
    `core/ast-walk.ts` `exprHoldsCall`. The duplicate doc at 300 is deleted.
  - Where: `lower/storage/*`, `lower/init/*`, `lower/builtins/sizeof.ts`, `lower/places/path.ts`, `lower/core/ast-walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.10.
  - Done 2026-10-07 (step 1.6c; 1.6.11-1.6.15 moved by the 1.6.8 tool, declaration by declaration with their docs).
    `storage/layout.ts` (`INSTANCE_STORAGE`, `withStringCapacity`, `storageOf`, `buildLayout`, `holdsInstance`),
    `storage/declare.ts` (`declareVars`, `constantSlot`, `declareInOuts`, `declareOpenBounds`), `storage/statics.ts`
    (`declareStatics`), `storage/addresses.ts` (`parseAddress` … `bindAddress`, + `addressSharedByInstances` from lower.ts),
    `storage/bytes.ts` (`byteSize`, `fieldBytes`, `byteOffset`, `alignUp`), `storage/unions.ts` (all of unions.ts);
    `init/initial-values.ts` (`runnableInit`, `scalarInit`, `aggregateInit`, `elementDefaults`, `aliasInit`),
    `init/temp-resets.ts` (`tempResets` — the name `resetTemps` is 1.7.17's, with its one call site); `builtins/sizeof.ts`
    (`sizeOf`, `adrDifference`); `places/path.ts` (`rootType`); `values/fold.ts` (`foldedCall`); `core/ast-walk.ts`
    (`exprHoldsCall`, storage's `holdsCall` renamed — its only callers were in storage.ts). The duplicate doc above
    `addressClash` is one doc. `storage.ts`, `bytes.ts`, `unions.ts` deleted. Known rule-4b edge (listed):
    `values/fold.ts` → `expressions/expressions.ts` — design.md §2.4 puts `foldedCall` in `values/fold.ts`, and it lowers the
    initializer through `lowerExpr`; the placement and rule 4b disagree (for the gate). Citations to the deleted files in
    `src/` and fixture comments re-pointed (`init-sequence.ts`, `lowering.ts`, `storage/addresses.ts`, `values/fold.ts`,
    `fixtures/declarations/addresses.ts`, `fixtures/memory/memory-model.ts`); `diagnostics/codes.ts`'s `layout-` note
    still names `storage.ts` — it is registry data, not a comment.
- [x] 1.6.12 `places/`.
  - What: `places.ts` → `places.ts` (+`Indexed`), `names.ts` (precedence as it is; `ownMember`, `methodOf` from calls.ts), `self.ts`
    (`selfFb`, `thisPlace`, `instancePlace` from calls.ts), `globals.ts`, `bounds.ts` (+`openDims`/`boundName` from lowering.ts),
    `path.ts`; `throughReference` → `pointers/deref.ts` (created here, completed in 1.6.13).
  - Where: `lower/places/*`.
  - Accept: G, S.
  - Depends: 1.6.11.
  - Done 2026-10-07 (step 1.6c). `places/places.ts` (`lowerPlace`, `Indexed`, `lowerAccess`, `bitPlace`), `places/names.ts`
    (`namePlace` — the name precedence, extracted in place from `lowerPlace`'s tail, unchanged — with `ownMember` and
    `methodOf` from calls.ts), `places/self.ts` (`selfFb`, `thisPlace`, `instancePlace` from calls.ts), `places/globals.ts`
    (`globalPlace`, `declareGlobal`, `qualifiedGlobal`, `listVariableShadows`), `places/bounds.ts` (`boundOf`,
    `refuseOpenArray`, + `openDims`/`boundName` from lowering.ts); `throughReference` → `pointers/deref.ts`. `places.ts`
    deleted. (`holding`'s doc, stacked above `instancePlace`'s, moved onto `holding` first.)
- [x] 1.6.13 `pointers/`.
  - What: `pointers.ts` → `state.ts` (+`PointerTarget`, `Cursor` and the pointer maps from lowering.ts), `address.ts`, `store.ts`,
    `deref.ts` (+`storeThrough` from statements.ts, `describePointer`, `unsuppliedInput`, `nullDeref`), `cursor.ts`, `borrowed.ts`
    (`borrowedInOut`); `through`, `refuseConstantWrite`, `loadValue` → `places/access-guards.ts`; `sameStorage`, `sameTarget` →
    `places/path.ts`.
  - Where: `lower/pointers/*`, `lower/places/*`.
  - Accept: G, S.
  - Depends: 1.6.12.
  - Done 2026-10-07 (step 1.6c). `pointers/state.ts` (`PointerTarget`, `Cursor` from lowering.ts; `pointerKey`,
    `recordTarget`, `ELEMENT_TAG_BIAS` — to `core/tags.ts` in 1.7.19), `pointers/address.ts` (`addressOf`, `pointerValue`),
    `pointers/store.ts` (`storePointer`, `bindReference`), `pointers/deref.ts` (`pointeePlace`, `pointerArms`,
    `selectThrough`, `nullDeref`, `describePointer`, `unsuppliedInput`, + `storeThrough` from statements.ts),
    `pointers/cursor.ts` (`charsOf`, `cursorOf`, `cursorChar`, `charsThrough`, `cursorStringChar`, `cursorCharAt`,
    `cursorString`), `pointers/borrowed.ts` (`borrowedInOut`); `through`, `refuseConstantWrite`, `loadValue` →
    `places/access-guards.ts`; `sameStorage`, `sameTarget` → `places/path.ts`. `pointers.ts` deleted. NOT moved: the pointer
    MAPS (`boundPointers`, `anyInputs`, `anyTargets`, `borrowedPointers`, `cursors`) are fields of the `Lowering` class and
    `Shared.pointers` — taking them out of the frame is 1.6.21's slimming of `Lowering` (its "holds the frame, bail, slots,
    modes and resolve only"); only their types moved.
- [x] 1.6.14 `expressions/`.
  - What: the dispatch, `operators.ts` (+`BIN_OPS`, `COMPARISONS`, `LIFTED`), `calendar.ts`, `partial-access.ts`; the `.diSize` read →
    a new `pointers/any.ts`.
  - Where: `lower/expressions/*`, `lower/pointers/any.ts`.
  - Accept: G, S.
  - Depends: 1.6.13, 1.6.3.
  - Done 2026-10-07 (step 1.6c). `expressions/expressions.ts` (`lowerExpr` and its arms `lowerLiteral`, `lowerName`,
    `lowerDeref`, `lowerMember`), `expressions/operators.ts` (`BIN_OPS`, `COMPARISONS`, `LIFTED`, `lowerUnary`,
    `lowerBinary`, `pointerNullCompare`, `isStringValue`, `stringCompare`, `arithmetic`), `expressions/calendar.ts`
    (`calendarArithmetic`), `expressions/partial-access.ts` (`partialAccess`); the `.diSize` read (`anyDiSize`) →
    `pointers/any.ts` (new). `expressions.ts` deleted.
- [x] 1.6.15 `builtins/`.
  - What: `builtins.ts`, `value-functions.ts` (+`checkedBits`, `UNARY_MATH`), `system.ts`, `clock.ts` (+`CLOCK_KEY`), `conversions.ts`;
    `lower/index.ts` takes `CLOCK` from `clock.ts`.
  - Where: `lower/builtins/*`.
  - Accept: G, S.
  - Depends: 1.6.14, 1.6.5.
  - Done 2026-10-07 (step 1.6c). `builtins/builtins.ts` (`lowerBuiltin`, with the old file's header), `value-functions.ts`
    (`checkedBits`, `UNARY_MATH`, `lowerValueFunction`, `lowerShift`, `lowerMux`, `lowerExpt`, `lowerSelection`, and
    `meetOperands` until 1.7.15 makes it `values/promote.ts`), `system.ts` (`lowerSystemCall`), `clock.ts` (`CLOCK`,
    `CLOCK_KEY`, `lowerClock`), `conversions.ts` (`lowerConversion`, `DATE_PART`); `lower/index.ts` re-exports `CLOCK` from
    `builtins/clock.js`. `builtins.ts` deleted. Re-pointed: fixture comments `operators/selection.ts`,
    `grammar/type-expressions.ts`, `memory/memory-model.ts`, and `oop/lifecycle.ts`'s task-15 note (`lower/pointers/state.ts`).
  - Step 1.6c end: `bun typecheck` clean; `bun run lint` green (layering 7 known; size 5 ceilings — `storage.ts`,
    `builtins.ts`, `expressions.ts`, `pointers.ts` gone, `calls.ts` 1779, `lower.ts` 964, `statements.ts` 424, `interfaces.ts`
    481 (+1, an import line; dissolved by 1.6.17); every new `lower/*/` file ≤ 234 lines; citations 604 missing, warning);
    `bun test src/transpile scripts` 383 pass, 0 fail; S ✓ identical, 5357 fixtures, 177 s.
- [x] 1.6.16 `statements/`.
  - What: `statements.ts`, `assign.ts`, `loops.ts`, `case.ts`. The `__TRY` note (249-271) moves to docs/architecture.md; the empty banner
    at 348 is deleted.
  - Where: `lower/statements/*`, `docs/architecture.md`.
  - Accept: G, S.
  - Depends: 1.6.15, 1.6.4.
  - Done 2026-10-07 (step 1.6d; 1.6.16-1.6.20 moved by the 1.6.8 tool). `statements/statements.ts` (`lowerBlock`,
    `lowerStmt`, `lowerIf`), `statements/assign.ts` (`lowerChain`, `lowerAssign`, `storeChar`, `lowerLatch`, `storeValue`,
    `holdsOwnAddress`, + `refuseImplicitString` from `values/convert.ts`), `statements/loops.ts` (`loopBody`, `lowerFor`,
    `lowerWhile`, `lowerRepeat`, `lowerExit`), `statements/case.ts` (`lowerCase`); `anySize` (RC 17) → `pointers/any.ts`.
    The `__TRY` note is a paragraph of docs/architecture.md ("Backend — `transpile/`"), a one-line pointer left beside
    `default`; the empty "type helpers" banner deleted. `statements.ts` deleted.
- [x] 1.6.17 `interfaces/`.
  - What: `tags.ts` (the doc at 85-89 reattached to `interfaceKey`), `lend.ts` (`heldAt`, `instanceRelative`, `lendPlace`,
    `refusedLends`, per-callee lend), `dispatch.ts` (+`interfaceProperty`, `accessorCall`), `query.ts` (+`isQuery`), `state.ts`;
    `finishInterfaces`, `onEachTag`, `bodiesOf` and the lend driver → `entry/finish.ts`, which runs the bindings' dispatches too;
    `callsIn` → `ir/walk.ts`.
  - Where: `lower/interfaces/*`, `lower/entry/finish.ts`, `ir/walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.16.
  - Done 2026-10-07 (step 1.6d). First, in place: `interfaceKey`'s doc (stacked above `elementOfArray`'s) put on it, and
    `lendToCallees` split into the driver (the loop over `callsIn`) and `lendToCall` (one call's lend). Then:
    `interfaces/tags.ts` (`FbType`, `interfaceChain` — `core/chain.ts`'s in 1.7.3 — `implementsInterface`, `tagOf`,
    `elementOfArray`, `interfaceKey`, `heldBy`, `tagsOf`, `storeInterface`, `interfaceArgument`), `interfaces/lend.ts`
    (`heldAt`, `instanceRelative`, `lendPlace`, `refusedLends`, `lendToCall`), `interfaces/dispatch.ts` (`SymbolAst`,
    `dispatch`, `interfaceCall`, `interfaceProperty`, `accessorCall`, `interfacePropertyGet`/`Set`), `interfaces/query.ts`
    (`lowerQueryInterface`, `isQuery`, `queryInto`, `queryCondition`, `foreignWrite`); `entry/finish.ts`
    (`finishInterfaces`, `onEachTag`, `bodiesOf`, `lendToCallees` — the bindings' dispatches already run through
    `shared.dispatches` there); `callsIn` → `ir/walk.ts`. No `interfaces/state.ts`: the lends and the hoisted queries are
    `Lowering` fields, which 1.6.21 takes out of the frame. `interfaces.ts` deleted.
- [x] 1.6.18 `calls/`.
  - What: `routines.ts`, `facts.ts`, `variants.ts`, `parameters.ts`, `invoke.ts`, `fb-call.ts`, `outputs.ts`, `binding.ts`, `super.ts`
    (+`isSuper`), `property.ts`, `specialize.ts` (from specialize.ts), `last-binding.ts` (from bindings.ts), `reentrancy.ts`
    (+`touchesOf`), `namespace.ts`; the ANY, cursor and borrowed functions extracted in 1.6.1 → `pointers/{any,cursor,borrowed}.ts`;
    `FbType`, `RoutineSymbol` → `core/lowering.ts`. The orphan docs at 63-65, 364-368 and 948-949 are deleted. Every name of
    design.md §4.3 lands where it says.
  - Where: `lower/calls/*`, `lower/pointers/*`.
  - Accept: G, S; no `calls/*` file over 400 lines.
  - Depends: 1.6.17, 1.6.2.
  - Done 2026-10-07 (step 1.6d). `calls/routines.ts` (381: `once`, `routineLowering`, `keptVariables`, `declareOutputs`,
    `isBodylessLibrary`, `calledRoutine`, `baseBody`, `calledLayout`; calls.ts's header), `calls/facts.ts` (`routineFacts`),
    `calls/variants.ts` (`typeKey`), `calls/parameters.ts` (`inOutSections`, `prefixed`, `positionalParameters`,
    `positionalOf`), `calls/invoke.ts` (`InvokeBindings`, `callHolds`, `lowerInvoke`, `invokeTarget`, `memberTarget`,
    `positionalArguments`, `bindArgument`, `bindOpenBounds`, `defaultInputs`, `bindInstanceInOuts`), `calls/outputs.ts`
    (`bindOutputArgument`, `bindUnconnectedOutputs`, `fbOutputCopy`), `calls/fb-call.ts` (`lowerCallStatement`,
    `routineCallStatement`, `calledInstance`, `fbArguments`, `fbInputStore`, `storeOpenBounds`), `calls/binding.ts`
    (`holding`, `bindInOut`, `bindPlace`, `lendGuards`, `bindWhereWritten` — the freeze — `movedInOut`, `aliases`),
    `calls/super.ts` (`isSuper`, `lowerSuperCall` and its three parts), `calls/property.ts` (`propertyRoutine`,
    `propertyAccess`, `lowerPropertyGet`/`Set`), `calls/reentrancy.ts` (`programReentrant`, `touchesOf`, `inGlobals`,
    `reachesDispatch`, and `touchesOnlyItsOwn`/`writesOnlyLocals` until 1.7.4 makes them `ir/walk.ts` predicates),
    `calls/namespace.ts` (`namespaceOf`), `calls/specialize.ts` (specialize.ts and its header; `callsNothing`/`mapPlaces`
    kept for 1.7.4), `calls/last-binding.ts` (bindings.ts: `FIELD`, `DINT`, `registerWholeCopy`, `registerBodyCall`,
    `lastBinding`); the ANY, cursor and borrowed parts 1.6.1 extracted → `pointers/any.ts` (`anyInputsOf`, `ANY_TARGET`,
    `anyArgumentTypes`, `bindAnyArgument`, `bindAnyTargets`), `pointers/cursor.ts` (`cursorInputsOf`, `CURSOR`, `TEXT_OF`,
    `cursorArgumentTypes`, `CursorArgument`, `cursorArgument`, `pointedString`, `bindCursorArgument`),
    `pointers/borrowed.ts` (`borrowedInputsOf`, `BORROWED`, `borrowedPointerSlots`, `bindBorrowedArgument`); `adrArgument` →
    `pointers/address.ts` (`adrOperand` is 1.7.9's); `chainOf`, `chainNames` → `core/chain.ts`; `overridesCalled`,
    `reachedNames`, `borrowedPointerNames` → `core/ast-walk.ts`; `stringIdentity`, `staticPath`, specialize's `sameStep`/
    `suffixOf` and bindings' `placeKey`/`throughInstance`/`instanceKey` → `places/path.ts`; `FbType`, `RoutineSymbol` →
    `core/lowering.ts` (created with them; the `Lowering` frame joins in 1.6.21). Orphan docs: `anyArgumentTypes`'s
    (stacked on `positionalParameters`) put on it; "A binding that is the caller's place…" (no declaration) went with
    calls.ts. No `calls/*` file over 400 lines. `calls.ts`, `specialize.ts`, `bindings.ts` deleted; `calls.test.ts` stays
    for 1.8.1. Known rule-4b edges (listed, to 1.6.21): `core/chain.ts`, `core/ast-walk.ts` → `lower/lowering.ts`.
- [x] 1.6.19 `init/`.
  - What: `init-sequence.ts` → `init/sequence.ts`; `initStep` → `init/step.ts`, `fb-init.ts`, `instance-init.ts`, `attributes.ts`
    (+`INIT_ATTRIBUTE`); `ownProgram` → `calls/reentrancy.ts`; `writesGlobal` → `ir/walk.ts`; the init state → `init/state.ts`.
  - Where: `lower/init/*`.
  - Accept: G, S.
  - Depends: 1.6.18, 1.6.6.
  - Done 2026-10-07 (step 1.6d). `init/state.ts` (`Fb`, `InitStep` — the init step under construction; `pendingInits`/
    `initSequence` are `Lowering` fields, 1.6.21's), `init/attributes.ts` (`INIT_ATTRIBUTE`, `initMethod`, `pathFields`,
    `instancePaths`, `slotMethodCall`), `init/instance-init.ts` (`instanceInitRoutine`), `init/step.ts` (`initStep`, 79),
    `init/fb-init.ts` (355: `fbInits`, `holdsFbInit`, `recordedArgument`, `declaredArgs`, `reaches`, `unreached`, `visit`,
    `programFbInitsQuiet`, `callFbInits`, `fbInitInput`, `visitFields`, `initializeUpTo`, and `writesGlobal`),
    `init/sequence.ts` (init-sequence.ts: `buildInitSequence`, `lowerPendingInit`, `reads`, `readsInvoke`, `readsPlace`,
    `laterThan`); `ownProgram` → `calls/reentrancy.ts`; `chainNamesOf` → `core/chain.ts`; `readsLaterTemp` →
    `init/temp-resets.ts`; `insideInstance` → `places/path.ts` (`typeAlong` is 1.7.10's). NOT to `ir/walk.ts`:
    `writesGlobal` and `reads*` read the lowering's routine and layout tables, which `ir/` cannot name — an IR predicate
    over a resolver is 1.7.4's ("one IR walker"). `init-sequence.ts` deleted; `init-sequence.test.ts` →
    `init/sequence.test.ts`.
- [x] 1.6.20 `entry/` and `project/`.
  - What: the rest of `lower.ts` → `entry/lower-unit.ts`, `entry/lower-source.ts`, `entry/checks.ts`, `project/prepare.ts`
    (+`LoweringProject`, `AttributeLookup`), `project/library-base.ts`. `lower/index.ts` gets explicit exports; `lower.ts` is deleted.
  - Where: `lower/entry/*`, `lower/project/*`, `lower/index.ts`.
  - Accept: G, S.
  - Depends: 1.6.19.
  - Done 2026-10-07 (step 1.6d). `entry/lower-unit.ts` (`lowerUnit`, `ownMembers`, `runsAsInstance`, `open`,
    `programBody`, `slotRefusal`, `rootInstance`), `entry/lower-source.ts` (`lowerSource`, `lowerOnBase`, `isRunnable`,
    `lowerPrepared`), `entry/checks.ts` (`representable`, `reversedArray`), `project/prepare.ts` (`TRANSPILE_PARSE`,
    `LibraryFile`, `LoweringProject`, `prepareProject`, `attributeCache`, `attributesOf`, `ParsedFile`, `readFiles`, +
    `AttributeLookup` from lowering.ts), `project/library-base.ts` (`LibraryBase`, `libraryBase`). `lower/index.ts` has
    explicit exports (the same runtime surface — `index.test.ts` unchanged — and a doc naming the folders; the old header
    table went with `lower.ts`). `lower.ts` deleted. NOT moved: `conditions.ts` (§4.9's `project/conditions.ts`): calls/
    reads it too (`calledRoutine`, `propertyRoutine`), which "only entry imports project" refuses. Known rule-4b edges
    (listed, for the gate — design.md's placement vs rule 4b): `lowering.ts` → `project/prepare.ts` (`Shared.attributes`
    is an `AttributeLookup`), `project/prepare.ts` → `conditions.ts` (the exec oracle's target). Citations re-pointed in
    `src/` (`ir/stmt.ts`, `interp/calls.ts`, `emit/rust/calls.ts`, `lowering.ts`, `pointers/deref.ts`, `calls/fb-call.ts`,
    `calls/super.ts`, `entry/lower-unit.ts`, `diagnostics/codes.ts`'s comment) and fixtures (`grammar/literals.ts`,
    `oop/lifecycle.ts`'s task-16/22/23 notes); in `src/transpile` only `runtime/string.ts`'s Rust text (output) and
    `codes.ts`'s `layout-` registry note still cite a missing file.
  - Step 1.6d end (and the end of the 1.5c-1.6d run): `bun typecheck` clean; `bun run lint` green (layering 10 known —
    the frontend's one and nine rule-4b edges, each named with its task or as a design conflict for the gate; size 1
    ceiling left, `lower/lower.test.ts` (1.8.1), every other `src/transpile` file ≤ 400 lines — the largest
    `calls/routines.ts` 381, `init/fb-init.ts` 355; 5 functions over 80 lines, `lowerConversion`, `calledRoutine` and its
    closure, `declareVars`, `builtinValue`; citations 562 missing, warning); `bun test src/transpile scripts` 383 pass,
    0 fail; S ✓ identical, 5357 fixtures, 163 s. Run once at the end (VOLT_FIXTURES unset): `bun test test/conformance
    test/libraries` 6206 pass, 389 todo, 0 fail (6595 tests, 21 files, 339 s); `bun test test/frontend` 45 pass, 0 fail;
    `bun run rate:fixtures` — `map.generated.ts` unchanged (edge agree 3046, disagree 0, not-run 179); `bun run check`
    (repo root) 18 passed. `lower/` is now `index.ts`, `lowering.ts` (1.6.21), `conditions.ts` (see above) and the three
    test files 1.8.1 dissolves (`lower.test.ts`, `calls.test.ts`, `totality.test.ts`) beside the folders.
  - Gate 1.5c-1.6d (2026-10-07). The finding on 1.6d — low, structure only, fixed failing test first: `callsIn` moved
    verbatim into `ir/walk.ts` was still a skip-list walk (every own key but `type`/`of`/`span`/`lent`), against the file's
    own "every other walk over the IR is built on `childrenOf`". It is now `some` over `childrenOf`, collecting each
    `call`/`invoke` pre-order. Red first: `walk.test.ts` "callsIn … only what childrenOf names" (a key `childrenOf` does not
    name — a stray `extra` holding an invoke — is not walked; the old walk followed it). Equivalence on the real IR:
    `test/conformance/ir-walk.test.ts` keeps the old walk verbatim as an oracle and requires the same calls, same nodes,
    same order, on every body of every lowered fixture (green), and S is byte-identical. The two findings on 1.5c are
    written under 1.5.15.
    Numbers: `bun typecheck` clean; `bun run lint` green (layering 10 known; size 1 ceiling; citations 562 missing,
    warning); FULL `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset) 8491 pass, 35 skip, 432 todo, 0 fail, 8958 tests
    in 246 files, 540 s; S (`snapshot:transpile check`, ir/rust/outputs/edge) ✓ identical, 5357 fixtures, 168 s;
    `rate:fixtures` — `map.generated.ts` unchanged (edge agree 3046, disagree 0, not-run 179); `bun run check` (repo root)
    18 passed. Committed in two commits, not five: 1.5c stands alone (its tree rebuilt from the last commit — the
    `holdsCall` import of `lower/{calls,bindings,lower,statements}.ts` re-pointed to `ir/walk.js` in the old files, the
    `emit.test.ts` ceiling and layering entries removed — and typechecked and tested on its own), but 1.6a, 1.6b, 1.6c and
    1.6d share files (`lower/calls.ts` is split in place by 1.6a and dissolved by 1.6d; `lower.ts`, `storage.ts`,
    `lowering.ts` likewise) and no intermediate tree of them was kept — so the second commit is 1.6a-1.6d with this gate's
    `callsIn` fix.
- [x] 1.6.21 `core/lowering.ts` and `core/shared.ts` slimmed.
  - What: `Lowering` holds the frame, `bail`, slots, modes and `resolve` only; `Shared`, `newShared`, `PendingBody`, `CalledRoutine` →
    `core/shared.ts`; `tempPlace`/`temp` → `core/temps.ts`; `fail` → `calls/routines.ts`; `baseOf` → `core/chain.ts`. The `frame` getter
    and the empty banners (176-178, 364-368, 380) are deleted.
  - Where: `lower/core/*`.
  - Accept: G, S; `core/lowering.ts` is 250 lines or less.
  - Depends: 1.6.20.
  - Done 2026-10-08 (step 1.6e). `lower/lowering.ts` deleted. `core/lowering.ts` (157 lines): `FbType`, `RoutineSymbol`,
    `frameState` (a model's per-frame state, kept beside the `Lowering` by reference — a `WeakMap` created empty at first
    use, as the field it replaces was created empty with the frame) and the `Lowering` class: the slots (frame, in-outs,
    locals, `statics`), the modes (`routineMode`, `globalMode`, `globalPrefix`, `isRoot`, `selfType`, `codeOwner`,
    `frameContext`, `routineContext`, `displayName`, `arguments`, `conditional`, `loops`), `bail`, `inArgument`, `holds`,
    `inherit`, `declared`, `slot`, `resolve` and the `Shared` getters. `core/shared.ts`: `PendingBody`, `CalledRoutine`,
    `Shared` (layouts, bodies, routines, `routineLowerings`, attributes, globals, root, the dispatch queue, `libraryUnits`),
    `newShared`, and `sharedState` (the same per-POU-lowering). `core/temps.ts`: `temp`, `tempPlace` (functions of `lw`).
    `fail` → `calls/routines.ts` (private); `baseOf` → `core/chain.ts`; the `frame` getter (every `x.frame` → `x.slots`)
    and the empty banners deleted. MODEL STATE moved to its model, on `frameState`/`sharedState` (design.md §2.4 "model
    state is held by reference to each model's state.ts"; that is what makes `core/` a leaf — `Lowering` named
    `pointers/state.ts`'s `Cursor`, `Shared` its `PointerTarget`): `pointers/state.ts` `PointerFrame`/`pointerFrame`
    (`boundPointers`, `anyInputs`, `anyTargets`, `borrowedPointers`, `cursors`) and `pointerTargets` (was
    `shared.pointers`); `interfaces/state.ts` (NEW) `interfaceFrame` (`lends`, `hoistedQueries`) and `interfaceTables`
    (`instances`, `interfaces`); `init/state.ts` `PendingInit`, `InitFrame`/`initFrame` (`pendingInits`, `tempInits`,
    `initSequence`) and `pendingInitsOf`; `calls/reentrancy.ts` `touchedOf`; `calls/binding.ts` `shadowedInOutsOf`;
    `calls/last-binding.ts` `bindingRecords` (`bodyCalls`, `superRebinds`, `copiedWhole`); `storage/addresses.ts`
    `addressedOf`, `storage/unions.ts` `unionsOf`, `storage/layout.ts` `buildingOf`. `calls/facts.ts` `routineFacts` (the
    same mechanism, hand-written) is now `sharedState`; `interfaces/tags.ts`'s second `FbType` deleted (core's). Rule 4b:
    the five `→ lower/lowering.ts` entries are gone; `lowering.ts → project/prepare.ts` is now `core/shared.ts →
    project/prepare.ts` (`Shared.attributes` is an `AttributeLookup`; the design conflict reported at 1.6d, still open —
    the gate's to decide). New test `core/lowering.test.ts` (2: a frame's state is its own and kept; a POU's shared state
    is the same from every frame sharing it).
    Numbers: `bun typecheck` clean; `bun run lint` green (layering 5 known; size 1 ceiling; 5 functions over 80 —
    unchanged; citations 566 missing, warning — the four new ones are `lower/lowering.ts` cited by this tasks.md's own
    history); `bun test src/transpile scripts` 386 pass, 0 fail; S ✓ identical (5357 fixtures).

### 1.7 Consolidations (one home per concern; neutral by construction, proven by S)

- [x] 1.7.1 AST walkers into `core/ast-walk.ts`: `overridesCalled`, `borrowedPointerNames`, `reachedNames`, `exprHoldsCall`,
  `queryCondition`'s leading-query scan.
  - Where: `lower/core/ast-walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7a). `core/ast-walk.ts` is the one home of every AST walk in `lower/`: `exprHoldsCall`,
    `overridesCalled`, `reachedNames`, `borrowedPointerNames` (already there since 1.6.18) now take their children from
    one private `astChildren` (every own value but `span` — `overridesCalled` walked the span too, which holds only
    positions); `queryCondition`'s leading-query scan is `leadingOperand` (through parentheses, NOT and the left of
    AND_THEN/OR_ELSE). A grep finds no other `Object.entries`/`Object.values` walk over the AST in `lower/`. S ✓.
- [x] 1.7.2 One `oneArgument` check for the five builtin sites.
  - Where: `lower/builtins/arity.ts` and its callers.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7a). `builtins/arity.oneArgument(call, accepts)` is the one check; the five sites keep what
    they let through as a named option (`OneArgumentAccepts`, filed for 6.A.18's kind of change): `conversions.ts` the
    bare-conversion source (none) and the `to_string` enum check (`named`, `output`), `sizeof.ts` SIZEOF (`output`),
    `system.ts` `__ISVALIDREF` (`named`, `output`), `values/fold.ts` `convertedConstant` (`named`, `output`); `MOVE` and
    the three conversion arities used it already. New `builtins/arity.test.ts` (2). S ✓.
- [x] 1.7.3 One EXTENDS chain (lean 10.1, widened).
  - What: the 13 lowering sites (lower.ts 164-169, 179-188, 232, 247-252, 261, 326-335; calls.ts 93-102, 107-117, 635-640; bytes.ts
    81-83; interfaces.ts 47-70 incl. `interfaceChain`; storage.ts 77-87) use `core/chain.ts` over `symbols.extendsChain`. A site whose
    order or cycle handling differs keeps a documented parameter, listed here (6.B.3's input).
  - Where: `lower/core/chain.ts` and the sites.
  - Accept: G, S; a grep finds no hand-written EXTENDS walk in `lower/`.
  - Depends: 1.6.21, 1.1.2.
  - Done 2026-10-08 (step 1.7a). `core/chain.ts` holds every EXTENDS walk; the hand-written ones are gone (a grep for
    `for (let … extends` / `.baseScope` loops in `lower/` finds none; what remains reads ONE step — `layout.ts` the
    direct base, `bytes.ts` whether a struct extends, SUPER^'s `codeOwner.baseScope`). THE MECHANISMS DIFFER and each
    site keeps its own (6.B.3's input): BY THE BINDER'S LINK (`symbols.extendsChain`) — `chainNamesOf`, `scopeChain`
    (`init/attributes.initMethod`, `init/fb-init.fbInits`, `storage/bytes.byteSize`'s VAR_INST check); BY THE QUEUED
    BODIES (`lw.bodies`) — `bodyChain` (`chainOf`, `init/attributes.pathFields`,
    `storage/addresses.addressSharedByInstances`); BY NAME LOOKUP — `declaredChain` (`init/fb-init.declaredArgs`, every
    kind; `interfaces/tags.implementsInterface` with `limit` 32, its old depth cap), `pouChain`/`chainNames` (FB or
    PROGRAM, a repeated NAME ends it — `calls/routines.calledRoutine`'s in-out walk) and `interfaceChainOf` (was
    `interfaces/tags.interfaceChain`). Each walk now visits a unit once: `pathFields`, `addressSharedByInstances`,
    `declaredArgs`, `initMethod` and `fbInits` had no guard (on a cycle they did not end, so no answer depended on it).
    New `core/chain.test.ts` (3). S ✓.
- [x] 1.7.4 One IR walker.
  - What: `touchesOnlyItsOwn`, `writesOnlyLocals`, `reachesDispatch`, `writesGlobal`, `callsIn`, `callsNothing` (→ `!holdsCall`),
    `mapPlaces`, `exitsAfter`, `blocksOf` and the init-sequence read walk run on `ir/walk.childrenOf`. The init-sequence walk keeps its
    current skip set (select, freezes) as an explicit option (removed in 5.9).
  - Where: `transpile/ir/walk.ts` and callers.
  - Accept: G, S; a grep finds no reflective IR walk outside `ir/walk.ts`.
  - Depends: 1.2.3, 1.6.21.
  - Done 2026-10-08 (step 1.7a). On `ir/walk.ts` (`childrenOf`): `touchesOnlyItsOwn`, `writesOnlyLocals` (moved there
    from `calls/reentrancy.ts`), `callsNothing` → `!holdsCall` (deleted), specialize's reflective `mapPlaces` → walk's
    (deleted with its `isPlace`), `reachesDispatch` and `writesGlobal` on the exported `someNode` (each enters a called
    routine's or FB's body from the lowering's tables by calling `someNode` again — the IR walk is the walk's, the
    resolver the caller's), the init-sequence read walk → `findPlace(e, onPlace, initReadChildren)` (`readsInvoke`/
    `readsPlace` deleted; `reads(e, onPlace)` keeps the name). `initReadChildren` is the named option: a call's inputs,
    bindings (a copy's value only), then instance; no `select`, freeze or lent (removed in 5.9). `callsIn`, `blocksOf`,
    `exitsAfter` were already there. A grep finds no reflective IR walk outside `ir/walk.ts` (left: `core/ast-walk.ts` —
    AST; `init/fb-init.ts` iterating an `IrInit`'s fields — data; `interp/runner.ts` rendering a value). Equivalence on
    the real IR: `test/conformance/ir-walk.test.ts` keeps the four replaced walks verbatim as oracles and requires the same
    answer from `touchesOnlyItsOwn`/`writesOnlyLocals` on every body and statement, the same tree from `mapPlaces`, and
    the same place visit order from the read walk on every expression, of every lowered fixture (green). New
    `ir/walk.test.ts` cases (4). S ✓.
- [x] 1.7.5 `guardWrite(place, checks)`.
  - What: each store site passes its current check list explicitly (the per-site subsets listed here). Making them uniform is 6.A.18.
  - Where: `lower/places/access-guards.ts` and the store sites.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7a). `places/access-guards.guardWrite(lw, place, span, checks)` over `WriteCheck`
    (`open-array`, `interface`, `through-reference`, `union`, `constant`, applied in the listed order); `through` deleted.
    The per-site lists (6.A.18's input): `:=` into a place `open-array, constant`; into a reference's target `constant`;
    `s[i] :=` `constant`; a chain link `open-array` + FULL_WRITE; FULL_WRITE (`interface, through-reference, union,
    constant`) for a latch, an FB output (`calls/outputs.ts`), a non-CONSTANT in-out binding (`calls/binding.ts`), an ANY
    argument (`pointers/any.ts`); a FOR variable `union, constant`; an FB input stored into the instance `constant`. Not a
    store, so not on it: `pointers/address.ts`'s ADR refusal of a union member (its own message). S ✓.
    Step 1.7a end: `bun typecheck` clean; `bun run lint` green (layering 5 known; size 1 ceiling; 5 functions over 80;
    citations 569, warning); `bun test src/transpile scripts test/conformance/ir-walk.test.ts` 397 pass, 0 fail; S ✓
    identical (5357 fixtures).
- [x] 1.7.6 `core/nested.ts`.
  - What: one diagnostic drain replaces the 12 hand-written drains; one `declareGlobals` replaces places.ts 47-53, storage.ts 139-154 and
    calls.ts 228-229.
  - Where: `lower/core/nested.ts` and the sites.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7b). `core/nested.ts`: `drain(into, from, since)` — THE drain, a COPY (a routine's or body's
    own lowering is kept and asked again, so what it reported stays its own), true when there was anything — and
    `nested(lw, scope, mode, fn)`, a scratch lowering in its modes drained into `lw` once. The 14 hand-written drains are
    `drain` (`calls/routines.ts` ×5 — keptVariables, calledRoutine, baseBody, calledLayout and the owner's in-outs —,
    `calls/property.ts`, `calls/last-binding.ts`, `entry/finish.ts`, `interfaces/lend.ts`, `init/instance-init.ts`,
    `storage/layout.ts`, and the three `declareGlobals` replaced) or `nested` (declareOutputs, the owner's in-outs); the
    three that skip a drain into the root itself keep their `lw !== root` test at the site (`drain` has no implicit one:
    `instance-init.ts` drains a frame that may be the asker's own). `declareGlobals(into, scope, section, prefix)`
    replaces `places/globals.ts` `declareGlobal`'s body, `storage/statics.ts`'s and `keptVariables`' VAR_STAT (one
    scratch per section where it reused one — declarations in global mode write only the shared globals). DESIGN
    CONFLICT for the gate: design.md §2.4 puts `declareGlobals` in `core/nested.ts`, but it calls `declareVars`
    (`storage/`), which rule 4b forbids `core/`; it lives in `storage/declare.ts` beside `declareVars`. New
    `core/nested.test.ts` (2). S ✓.
- [x] 1.7.7 One body pipeline `bodyOf(unit)`, replacing the five copies (calls.ts 545/656, 687/698, 802/821, 1303/1313; lower.ts 71/113).
  - Where: `lower/calls/routines.ts`.
  - Accept: G, S.
  - Depends: 1.7.6.
  - Done 2026-10-08 (step 1.7b). `calls/routines.bodyOf(lw, unit, body, name, { library })` → `{ statements } |
    BodyRefusal` (`graphical-body`, `parse`, `call-library`, with the message): the five copies are gone — `calledRoutine`,
    `baseBody`, `calledLayout` (reported through `fail`), `calls/property.ts` and `entry/lower-unit.ts`. Each site
    reports the refusal its own way; the POU's own body is unnamed (its messages say "body"/"a body that is not ST is
    not lowered here", as before) and is not asked the library question (`library: false` — it never was), and its ST
    check still runs before anything is declared, its parse after the init sequence is built (order kept: a parse error
    beside a failing initializer still answers the initializer's). `isBodylessLibrary` is private. S ✓.
- [x] 1.7.8 One routine cache.
  - What: `instanceInitRoutine` and `specializeRoutine` go through `once`, which gains the lowering/failed states and the recursion guard.
  - Where: `lower/calls/routines.ts`, `init/instance-init.ts`, `calls/specialize.ts`.
  - Accept: G, S; a grep finds one writer of the routine cache.
  - Depends: 1.7.7.
  - Done 2026-10-08 (step 1.7b). `once(lw, name, span, build, { quiet })` is the one writer of `lw.routines` (a grep
    finds `routines.set` only there). `init/instance-init.ts`'s `__INIT` and `calls/specialize.ts`'s copies go through it
    with `quiet` — the two differences they had, kept by name: a failed one answers undefined without a second refusal
    (its builder reported), and it is never `lowering` while it builds (no recursion guard). `specializeRoutine` throws if
    its key were ever cached failed (it cannot be). New `calls/routines.test.ts` (2; 1.8.2 adds `calls.test.ts`'s
    routine tests to it). S ✓.
- [x] 1.7.9 One ADR recognizer `adrOperand`, replacing pointers.ts 96, calls.ts 337-343 and bytes.ts 173-174.
  - Where: `lower/pointers/address.ts` and the sites.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7b). `pointers/address.adrOperand(value, { parens })` (was `adrArgument`) replaces
    `pointerValue`'s inline test (its operand is never parenthesized there — `pointerValue` unwraps first) and
    `builtins/sizeof.adrDifference`'s `adrOf`, which recognizes the bare call only (`parens: false`, kept); the borrowed
    and cursor bindings call it by its new name. A grep finds `"ADR"` only in it. S ✓.
- [x] 1.7.10 One path walk and one field lookup.
  - What: `typeAlong` for the six type-along-path walks (incl. `insideInstance`), `fieldOf` for the ~15 upper-cased field lookups.
  - Where: `lower/places/path.ts` and the sites.
  - Accept: G, S; a grep finds no `toUpperCase()` field lookup outside `path.ts`.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7b). `places/path.ts`: `fieldIn(fields, name)`, `fieldIndex(fields, name)` and
    `fieldOf(lw, typeName, name)` — the one case-insensitive lookup — and `typeAlong(lw, root, path, rule, visit)`, the
    one walk of the types along a path (`visit` sees each step on the type it is taken on and may stop the walk with a
    value). THE RULES DIFFER and each walk keeps its own (`PathRule`): `throughInstance` and `insideInstance`
    (struct, sized), `storage/bytes.byteOffset` (struct, sized), `storage/unions.unionOf` (composite, any — an
    `ARRAY[*]`'s element too), `interfaces/tags.interfaceKey` (composite, sized). 21 field lookups now go through
    `fieldIn`/`fieldIndex`/`fieldOf` (`calls/fb-call.ts` ×4, `invoke.ts` ×3, `super.ts` ×2, `specialize.ts`,
    `last-binding.ts`, `init/attributes.ts`, `init/initial-values.ts`, `init/fb-init.ts` ×3, `places/places.ts`,
    `pointers/cursor.ts`, `storage/bytes.ts`, `storage/unions.ts` ×2). Not converted (not a field lookup): AST
    declaration matches on `name.text` (`init/fb-init.declaredArgs`, `places/globals.ts`, the interface method and
    property lookups), `storage/unions.ts`'s member comparison. New `places/path.test.ts` (3). S ✓.
    Step 1.7b end: `bun typecheck` clean; `bun run lint` green (layering 5 known; size 1 ceiling; 5 functions over 80, unchanged;
    citations 566, warning); `bun test src/transpile scripts
    test/conformance/ir-walk.test.ts` 404 pass, 0 fail; S ✓ identical (5357 fixtures).
- [x] 1.7.11 One place identity `staticKey`.
  - What: replaces `stringIdentity`, `staticPath`, `placeKey`, `instanceKey`, `suffixOf`/`sameStep`, `sameTarget`, `sameStorage`;
    `pointerKey` and `interfaceKey` are built on it. Any copy whose identity differs keeps it behind a named option, listed here (4.15's
    input).
  - Where: `lower/places/path.ts`, `pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`.
  - Accept: G, S.
  - Depends: 1.7.10.
  - Done 2026-10-08 (step 1.7c). `places/path.ts`: one static-step writer (`stepKey`/`staticSteps` over a named
    `StepWriting`) and on it `staticKey(place)` (was `stringIdentity`: root, slot, static path; the guard not part of it),
    `staticPath`, `sameStep`, `sameTarget`, `suffixOf`, `placeKey` (and `instanceKey` on it); `interfaces/tags.tagOf`'s
    inline static-path test is `staticPath`. THE WRITINGS DIFFER and each keeps its own (4.15's input): `KEY_STEP` (a
    field upper-cased, an index `[v]`) for `staticKey`/`placeKey`; `SUFFIX_STEP` (`_Name` in source casing, `_v`) for a
    specialized routine's name; `SAME_STEP` for `sameStep`/`sameTarget`, which compare an index by value AND type as `===`
    did; `placeKey` also keys the frame (`GLOBAL`/`frameContext`) and refuses a guard and a non-frame root. Not on it, and
    why: `pointers/state.pointerKey` keys a VARIABLE (a bare slot or THIS's field, never a path — a union member by its
    union, a pointer reached through one by that one); `interfaces/tags.interfaceKey` is `pointerKey`, else
    `FB:<type>.<field>` by the path's type (`typeAlong`); `sameStorage` compares TYPES, not places. New
    `places/path.test.ts` cases (2). S ✓.
- [x] 1.7.12 One `programReentrant`, used by the five inlined sites and the init step's two.
  - Where: `lower/calls/reentrancy.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7c). `calls/reentrancy.programReentrant(lw, callee, target, rule)` → `"touches" |
    "dispatch" | undefined` over a `Callee` (touched set, body; `routineCallee` reads a routine's by key) and a
    `programTarget(place)` (the global slot, and whether the call is INSIDE a program's instance). Its sites, with their
    rules (`ReentrancyRule`): the init step's FB_Init and slot-METHOD calls (both checks, always — the default);
    `calls/property.ts` (both; asked only inside); `calls/invoke.ts` (touched always, interface call inside);
    `calls/fb-call.ts` (both inside); `calledLayout`'s PROGRAM reaching its own instance (touched only). Each site keeps
    its own refusal text per reason. New `calls/reentrancy.test.ts` (2). S ✓.
- [x] 1.7.13 `reachesFbInit`: `holdsFbInit` and `reaches` merged (lean 10.1).
  - Where: `lower/init/fb-init.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7c). `init/fb-init.reachesFbInit(st, t, what)` is the one memoized deep walk (array
    elements, struct and FB fields; a type reached again while asked answers false); `what` = `"fb-init"` (was
    `holdsFbInit`, memo `fbInitHeld`) or `"init-step"` (was `reaches`, memo `known`), the type's own part in
    `ownInitWork`. Callers (`visit`, `callFbInits`, `init/step.ts`) ask by name. S ✓.
- [x] 1.7.14 Enum numbering and default in `types/enums.ts`.
  - What: `numberEnumerators` replaces `defaultOfValues` and `enumConstant`'s numbering; `enumDefaultValue` replaces the value part of
    `enumDefault`/`inlineEnumDefault`; `lower/values/enums.ts` keeps only `enumStorage`/`enumConstant` (IR). If 0.9 found an enum home
    in the front-end, use it.
  - Where: `types/enums.ts`, `types/enums.test.ts`, `types/index.ts`, `lower/values/enums.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.6.21, 1.1.14.
  - Done 2026-10-08 (step 1.7c). `frontend/types/enums.ts`: `numberEnumerators(values, valueOf, until?)` (the numbering:
    written values folded, unwritten the previous + 1, first 0; a written value that does not fold ends it,
    `unfolded`; `until` stops after that member, folding nothing past it) and `enumDefaultValue(values, init, valueOf)`
    (zero if a value, else the first, or the type-level `:= Name`); both on the types index. They replace the private
    `memberValues`/`defaultOfValues` (`enumDefault`, `inlineEnumDefault` and `strictEnum` now call them) and
    `lower/values/enums.enumConstant`'s own numbering (it numbers `until` the member asked, as it stopped there before, and
    refuses `enum-value` naming the member that does not fold). `lower/values/enums.ts` keeps `enumStorage`,
    `enumeratorValue` and `enumConstant` (IR) — its member-list lookup (by name in the project) is not the front-end's
    (by the scope's file), so it stays, for 5.3/H7. New `frontend/types/enums.test.ts` (3, red first). S ✓; G+LSP:
    see the step end.
- [x] 1.7.15 One operand meet `meet(lw, operands, context)`.
  - What: replaces expressions.ts 61-67/253-279, builtins.ts `meetOperands` and statements.ts 321-323; a context whose rule differs keeps
    it as a named context, listed here.
  - Where: `lower/values/promote.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7c). `values/promote.meet(lw, operands, context, span)` → `{ operands, type }`; the three
    contexts keep their rules by name (`MeetContext`): `binary` (literal beside a variable, all-constant integer fold, then
    `commonType`, refused when none, promoted when `lift` — `expressions/operators.ts` passes `LIFTED.has(op)`; the
    operands come back retyped), `builtin` (was `builtins/value-functions.meetOperands`, deleted: variables decide, a REAL
    constant widens, all-constant integers fold, an unholdable constant meets, promoted), `for-compare`
    (`statements/loops.ts`: `commonType`, unpromoted, unrefused). New `values/promote.test.ts` (4). S ✓.
    Step 1.7c end: `bun typecheck` clean; `bun run lint` green (layering 5 known; size 1 ceiling; 5 functions over 80;
    citations 558, warning); `bun test src/transpile src/frontend/types scripts test/conformance/ir-walk.test.ts` 546
    pass, 0 fail; S ✓ identical (5357 fixtures); `bun run test:corpus` (1.7.14's G+LSP) 19 pass, 1 skip, 0 fail; the
    build-conformance oracle and the LSP replay run in the end-of-run `test/conformance` (below, under 1.7.20).
- [x] 1.7.16 No fallback in the refusal kind.
  - What: `bail` calls `lowerCodeKind`; an unregistered code throws `LoweringBug`.
  - Where: `lower/core/lowering.ts`, `lower/diagnostics/codes.ts`.
  - Accept: G, S; `codes.test.ts` green, plus a test that an unregistered code throws.
  - Depends: 1.2.2, 1.6.21.
  - Done 2026-10-08 (step 1.7d). `diagnostics/codes.emittedKind(code)` — the kind of a code lowering EMITS, throwing
    `LoweringBug` (`semantics/faults.ts`) for an unregistered one; `Lowering.bail` and `lowerDiagnostic` use it, the
    `?? "unclassified"` is gone. `lowerCodeKind` stays the question "is this registered?" (undefined when not) that
    `codes.test.ts` and `fixtures.test.ts` ask. Red first: `codes.test.ts` "bail and lowerDiagnostic throw LoweringBug on a
    code the registry does not hold" (and a registered code and a templated family answer their kind). `codes.test.ts`
    5 pass; S ✓ (no fixture emits an unregistered code).
- [x] 1.7.17 One VAR_TEMP reset site `resetTemps(lw)`, called from the three places (lower.ts 117, calls.ts 821 and 1313 before the moves).
  - Where: `lower/init/temp-resets.ts`, `calls/routines.ts`, `entry/lower-unit.ts`.
  - Accept: G, S.
  - Depends: 1.7.7.
  - Done 2026-10-08 (step 1.7d). `init/temp-resets.resetTemps(lw, unit)` (was `tempResets(lw, sections, span)` and a
    `?? []` at each caller): the one reset site, called from the three bodies that run — `entry/lower-unit.ts` (the
    POU's), `calledLayout` (an FB's at its first call) and `baseBody` (a base's by `SUPER^()`). A refused reset still
    answers no statements and the body lowers on, its refusal reported (kept, documented at the one site). S ✓.
- [x] 1.7.18 Lowering's call parameter view in `calls/parameters.ts`.
  - What: `positionalParameters`, `inOutSections`, `prefixed`, `positionalOf` in one module; a differential test compares its parameter
    list with `types/infer/callee.resolveCallee` over every call in the lowered fixtures and writes the differences here (6.B.4's input).
  - Where: `lower/calls/parameters.ts`, `parameters.test.ts`.
  - Accept: G, S; the difference list is written here.
  - Depends: 1.6.21, 1.1.13.
  - Done 2026-10-08 (step 1.7d). `calls/parameters.ts` already held `positionalParameters`, `inOutSections`, `prefixed`,
    `positionalOf` (1.6.18). New `calls/parameters.test.ts` (2: the positional order; a chain's in-outs and a prefixed
    section) and the differential `test/conformance/call-parameters.test.ts`: over every call in every lowered fixture's
    POU, METHOD, ACTION and FUNCTION bodies whose callee `types/infer/callee.resolveCallee` resolves, lowering's positional
    order (`positionalParameters` over the callee's own sections) against the front-end's `positional`. Numbers
    (3225 lowered fixtures, 5512 calls): 1846 the front-end resolves no callee for (the builtins, conversions, ADR/SIZEOF…
    — lowering's own), 2824 FB-instance calls (front-end: the chain's VAR_INPUT + VAR_IN_OUT, base first; lowering binds
    NO argument of an FB call by position — `call-positional`), 842 direct calls compared. THE DIFFERENCES (6.B.4's
    input) — CORRECTED by the 1.6e+1.7d gate (review finding; the first list said lowering's order "counts VAR_OUTPUT — a
    positional argument can bind an output", which lowering never does): (1) a positional argument at or past a
    VAR_OUTPUT declared among the parameters — lowering REFUSES it (`call-positional` "counted across a VAR_OUTPUT",
    `calls/parameters.positionalBinding`), the front-end SKIPS the output and binds it to the next input
    (`types/infer/callee.ts` `POSITIONAL_SECTIONS`, "VAR_OUTPUT is never bound by position"). NEITHER rule is recorded:
    `callshape_positional_arguments` covers VAR_INPUT and VAR_IN_OUT only, and no fixture has such a call (0 of the 5357
    fixtures refuse with it; 0 of the lowered ones bind across an output — a lowered fixture cannot, lowering refuses
    it). So the LSP's rule is unrecorded too; 6.B.4 starts by recording a positional argument past a VAR_OUTPUT. 12
    compared calls of 7 routines declare an output among their parameters, none with a positional argument past it.
    (2) the FB-instance case above. The differential test now compares what each BINDS, argument by argument
    (`positionalBinding` — the rule `invoke.ts` binds by — against `positional[i]`): 554 positional arguments of the 842
    direct calls, all naming the same parameter and in-out mark, 0 across an output (counted and named when one
    appears); any other difference fails, and so does a fixture that throws or whose GVLs do not parse (named; the
    `catch { continue }` that dropped them is gone, here and in `ir-walk.test.ts`'s two walks — 0 throw today). Not
    covered: a PROPERTY accessor's body (not walked). S ✓.
- [x] 1.7.19 One tag encoding `core/tags.ts`.
  - What: `NO_TAG`, `tagOfIndex`, `indexOfTag`; the pointer, interface-instance and `__inout_binding` schemes number through it.
    Whether the schemes merge is 4.2/4.14.
  - Where: `lower/core/tags.ts`, `pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`.
  - Accept: G, S; a grep finds no `+ 1`/`- 1` tag arithmetic outside `core/tags.ts`.
  - Depends: 1.6.21.
  - Done 2026-10-08 (step 1.7d). `core/tags.ts`: `NO_TAG` (0), `tagOfIndex(k)` (k + 1), `indexOfTag(tag)`. The three
    schemes number through it: a pointer's targets (`pointers/state.recordTarget`, `pointers/deref.pointerArms`, the null
    `p := 0` in `pointers/address.pointerValue`), the interface instances (`interfaces/tags.tagOf`, an interface given
    `0`; read back in `dispatch.ts`, `lend.ts`, `query.ts`, `tags.tagsOf`) and the in-out binding tag
    (`calls/last-binding.ts`). A grep finds no `+ 1`/`- 1` tag arithmetic outside `core/tags.ts` (an element pointer's
    `ELEMENT_TAG_BIAS` is a scheme of its own, named there). New `core/tags.test.ts` (1). S ✓.
- [x] 1.7.20 Registries and surface in place.
  - What: the transpile barrel exports exactly design.md §2.1.1; `lower/index.ts` the lower row; the dead-export list of 1.0.4 is cleared
    (each name deleted, un-exported, or used).
  - Where: `transpile/index.ts`, `lower/index.ts`, `scripts/dead-exports.ts` output.
  - Accept: G, S; `dead-exports.ts --scope src/transpile` (filtered per design.md §8) prints nothing.
  - Depends: 1.7.1-1.7.19.
  - Done 2026-10-08 (step 1.7d). The transpile barrel names its exports one by one (`export type *` from `ir/`, the rest
    explicit): the runtime surface is §2.1.1's — `lowerPrepared` joined (exported from `entry/lower-source.ts`),
    `lowerDiagnostic` left (nothing outside lowering builds a refusal; `index.test.ts` edited deliberately) — plus,
    each named in the barrel with its consumer, `LoopGuardError` (task 27 came after the design; `backends.test.ts`, the
    confidence rating) and the type `LoweringProject` (`test/corpus/support/project.ts`). `lower/index.ts` is the lower
    row (+ `LoweringProject`): `LowerCodeKind` and `lowerDiagnostic` left it; `interp/index.ts` drops `RunOptions`. The
    dead-export list is cleared — `dead-exports.ts --scope src/transpile` prints "no finding". Of 1.0.4's 24 names, the
    ones 1.6/1.7 had not already removed or used, and the new ones this run's modules added, are un-exported (26):
    `GlobalsUse`, `RuntimeId`, `RuntimeHelper`, `OneArgumentAccepts`, `UNARY_MATH`, `Callee`, `ReentrancyRule`,
    `reachesDispatch`, `NestedMode`, `BIN_OPS`, `readsLaterTemp`, `SymbolAst`, `InterfaceFrame`, `InterfaceTables`,
    `WriteCheck`, `refuseConstantWrite`, `PathRule`, `bitPlace`, `pointerArms`, `nullDeref`, `lowerChain`, `addressBits`,
    `INSTANCE_STORAGE`, `inTicks`, `MeetContext`, `CaseRecording` (a type in an exported signature emits fine unexported
    under TS 7's declaration emit, checked). S ✓.
    Step 1.7d end, and the end of the 1.6e-1.7d run (VOLT_FIXTURES unset, each once): `bun typecheck` clean; `bun run
    lint` green (layering 5 known; size 1 ceiling; 5 functions over 80, unchanged; citations 551 missing, warning);
    `bun test src scripts test/conformance/ir-walk.test.ts test/conformance/call-parameters.test.ts` 2095 tests, 0 fail;
    S ✓ identical (5357 fixtures, 170 s); `bun test test/conformance test/libraries` 6211 pass, 389 todo, 0 fail (6600
    tests, 22 files, 309 s); `bun test test/frontend` 45 pass, 0 fail; `bun run rate:fixtures` — `map.generated.ts`
    unchanged (edge agree 3046, disagree 0, not-run 179); `bun run test:corpus` 19 pass, 1 skip (after 1.7c); `bun run
    check` (repo root) 18 passed.
  - GATE 1.6e+1.7d (2026-10-08). Review findings, all three fixed: (a) 1.7.18's difference list was wrong about
    lowering (it refuses a positional argument across a VAR_OUTPUT, never binds one) — corrected above; the rule is
    now one function `calls/parameters.positionalBinding`, read by `invoke.ts` and by the differential test, which
    compares what each side BINDS per argument (red first: `parameters.test.ts` "what a positional argument binds
    to"); (b) `call-parameters.test.ts` and `ir-walk.test.ts`'s two walks no longer drop a fixture that throws or
    whose GVLs do not parse — a throw fails the test, an unparsed GVL is named (0 of each today); (c)
    `diagnostics/diagnostic.ts`'s "Lowering is TOTAL — it never throws" now says it is total on its input and throws
    only `LoweringBug` on a bug of its own (an unregistered code, 1.7.16). Numbers (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES
    unset): `bun typecheck` clean; `bun run lint` green (layering 5 known; size 1 ceiling; 5 functions over 80,
    unchanged; citations 551 missing, warning); `dead-exports.ts --scope src/transpile` no finding; `bun test` 8527
    pass, 35 skip, 432 todo, 0 fail (8994 tests, 258 files, 574 s); S ✓ identical (5357 fixtures, 183 s); `bun run
    rate:fixtures` — `map.generated.ts` unchanged (edge agree 3046, disagree 0, not-run 179); `bun run test:corpus` 19
    pass, 1 skip, 0 fail; `bun run check` 18 passed. `call-parameters`: 3225 fixtures, 5512 calls, 842 direct, 554
    positional arguments compared, 0 differences, 0 across an output. ONE commit for 1.6e and 1.7d: they ran as one
    run in one tree (1.7d edits the files 1.6e moved — `core/lowering.ts`, `calls/*`, `init/*` …) and no 1.6e tree
    was kept, as with 1.6a-1.6d.

### 1.8 Tests and conformance support

- [x] 1.8.1 Split `lower/lower.test.ts` per design.md §5 (133 tests into about 36 colocated files).
  - Where: `lower/**/*.test.ts`.
  - Accept: G, T; `lower.test.ts` deleted.
  - Depends: 1.6.20.
  - Done 2026-10-08 (step 1.8a). `lower/lower.test.ts` (2645 lines, 170 tests counting the nested ones) dissolved by §5's
    two tables into 43 new colocated files and 5 existing ones (`calls/reentrancy`, `calls/routines`, `core/lowering`,
    `values/fold`, `values/promote`). Placements the tables leave open, decided here: 161 (VAR_STAT and VAR_TEMP in one
    test) → `storage/statics.test.ts` (one test cannot be in two files); 313, 335 and 789 → `calls/invoke.test.ts`;
    "lower — STRING (design §18)" split: the slot, initializer, escape, WSTRING and non-ASCII tests → `places/places.test.ts`,
    the compare, the Standard call and the `**`/`&` refusal → `builtins/conversions.test.ts`. A test that leaves its
    describe keeps it — the same describe, wrapping it in the new file — so every title is unchanged: "a FOR reads its
    limit and its step on every pass" in `statements/loops.test.ts` under "lower — total, never silently wrong" (the rest
    of that describe → `entry/totality.test.ts`), the RC 38 nested describe in `statements/assign.test.ts` under "lower —
    a STRING CURSOR …". The file-level helpers (`ir`, `wrap`, `INTERFACES`, `STANDARD_LEN`) are copied into each file
    that uses them (one-line helpers; a shared test module is not in the design). `check-size.ts`'s last ceiling is
    gone (`CEILINGS` is empty); the citations the move made stale in `src`/`test` re-pointed (`test/corpus/corpus.test.ts`,
    `fixtures/grammar/type-expressions.ts`). T (`--dirs src/transpile`): 380 before, 380 after, ✓ identical.
- [x] 1.8.2 Move the remaining lower tests: `calls.test.ts` → `calls/routines.test.ts` + `calls/binding.test.ts`;
  `init-sequence.test.ts` → `init/sequence.test.ts`; `totality.test.ts` → `entry/totality.test.ts`.
  - Where: `lower/**/*.test.ts`.
  - Accept: G, T.
  - Depends: 1.8.1.
  - Done 2026-10-08 (step 1.8a). `calls.test.ts` → "a type that contains itself" into `calls/routines.test.ts`, "what a
    call may bind" into `calls/binding.test.ts` (each with the helpers `st`, `T`, `codesFor`, `valueOf` it uses) and its
    one loose test (RC 42, an ANY input per array type) into `calls/specialize.test.ts` (what `specialize.ts` keys);
    `totality.test.ts` → `entry/totality.test.ts` (its doc and describe beside 1.8.1's). `init-sequence.test.ts` had
    already moved (`init/sequence.test.ts`). `lower/` holds no test file of its own now. T: as 1.8.1 (one run for both).
- [x] 1.8.3 Split `support/transpile-confidence.ts` (4032 lines).
  - What: into `support/transpile/{tier,correctness,lint-policy,shape,edge,row}.ts` and `support/notes/{lean,notes,render}.ts` with the
    authored tables as `notes.data.ts`, `lean.data.ts`; `rate-fixtures.ts` imports updated.
  - Where: `test/conformance/support/**`, `scripts/rate-fixtures.ts`.
  - Accept: G, M (identical map content except the type import path).
  - Depends: 0.6.
  - Done 2026-10-08 (step 1.8a). `support/transpile-confidence.ts` (3987 lines) → `support/transpile/tier.ts` (`tierOf`),
    `correctness.ts` (`correctnessOf`, `rejectionIsADefect`), `lint-policy.ts` (`ALLOWED`, `LINT_FLAGS`, `buildArgv`,
    `splitFindings`, `rendered`, `pedanticGroups`), `shape.ts` (`normalizeRustLine`, `shapeId`, `emissionShape`,
    `sizeRatio`, `preludeLines` — exported for `edge.ts`), `edge.ts` (the edge differential), `row.ts` (`divergesOf`,
    `printRow`, and the module's doc); `support/notes/lean.ts` (`ReviewItem`, `note`, `merged`), `lean.data.ts` (`LEAN`),
    `notes.data.ts` (`NOTES`), `notes.ts` (`assertNotes`, `RESTRUCTURE_TASKS` one `..` deeper, `taskIdsOf`,
    `noteTagProblems`, `notesByTask`, `deadNotes`, `notesOf`), `render.ts` (`renderNotes`). Every line of the old file is
    in exactly one new one (checked line by line; only imports, the `RUNS` path and the generated note's source path
    changed). `transpile-confidence.test.ts` → `transpile/correctness.test.ts`, `notes/notes.test.ts`,
    `transpile/edge.test.ts` (titles unchanged). Importers re-pointed: `fixtures.test.ts`, `backends.test.ts`,
    `support/snapshot.ts`, `snapshot.test.ts`, `rustc-cache.test.ts`, `scripts/rate-fixtures.ts`,
    `scripts/frontend-snapshot.ts`; `check-citations.ts` reads `support/notes/` only (its test plants `notes.data.ts`).
    M: `map.generated.ts` differs in three source-path texts only (header ×2, the NOTES section's "edit it there").
- [x] 1.8.4 `support/recordings.ts`, the one `codesys.run.json` reader (for fixtures.test.ts, evidence.ts and the correctness module).
  - Where: `test/conformance/support/recordings.ts` and the three readers.
  - Accept: G, M identical.
  - Depends: 1.8.3.
  - Done 2026-10-08 (step 1.8a). `support/recordings.ts` exports `RUNS` and `RunRecorded` (cycles, values, error,
    unreadable); `fixtures.test.ts`, `evidence.ts`, `transpile/correctness.ts` and `runtime-twins.test.ts` (a fourth
    reader since 1.5.15) read it — a grep finds one `JSON.parse` of `codesys.run.json` under `test/conformance`. Not
    moved: the three readers in `test/frontend` (`sources.ts`, `conversion-pairs.ts`, `bound-census.ts`), outside this
    task's list. M: identical (the run above).
- [x] 1.8.5 `support/display.ts`: `ideValue`, `asDisplayed`, `interpRender`, `rustRender`.
  - Where: `test/conformance/support/display.ts`.
  - Accept: G, S.
  - Depends: 1.8.4.
  - Done 2026-10-08 (step 1.8a). `support/display.ts`: `ideValue` and `asDisplayed` (from `fixtures.test.ts`'s "the
    vendor's display formats"), `interpRender` and `rustRender` (from `transpile/edge.ts`), and `seedable`/`Seedable`,
    which `interpRender` reads and the edge seeding shares (in `edge.ts` it would be a cycle). S ✓ identical (5357
    fixtures, 159 s).
  - Step 1.8a end: `bun typecheck` clean; `bun run lint` green (layering 5 known; size: 0 ceilings, 5 functions over 80,
    unchanged; citations 558 missing, warning — the rise from 551 is `tasks.md` history naming `lower.test.ts`,
    `transpile-confidence.ts` and the test files this step deleted, for 1.9.3); `bun test test/conformance/support scripts
    src/transpile` 502 pass, 0 fail; S ✓ identical; `bun run rate:fixtures` — only the three path texts (edge agree
    3046, disagree 0, not-run 179).
- [x] 1.8.6 `support/differential.ts`, used by `backends.test.ts` and the edge verdict.
  - Where: `test/conformance/support/differential.ts`, `backends.test.ts`, `support/transpile/edge.ts`.
  - Accept: G, S (edge layer identical).
  - Depends: 1.8.5.
  - Done 2026-10-08 (step 1.8b). `support/differential.ts`: `compareOutcomes(interpreter, rust, places, same)` over two
    `Outcome`s (`faulted`, `values`) answers the `Difference`s (a fault on one side, a place one side did not answer, a
    value) and the count compared — the rule both callers had in their own loops (`backends.test.ts` twice: the probes'
    `compareCase` and the sweep's lane). `backends.test.ts` reads the harness's printed lines into an `Outcome`
    (`rustOutcome`) and words the differences as before (`divergencesOf`, the transcendental ULP rule its `same`);
    `transpile/edge.ts` `compareEdge` compares each variant over the plan's paths (its `same` reads the Rust's NaN bits
    through `rustRender`; a plan path the interpreter left unanswered throws — `interpOutcome` answers every one). Every
    message is the text it was. `backends.test.ts` against HEAD's copy (run beside it): probes 29 places in 6, sweep 118
    of 5172 sampled, 168 places, 3 agreed faults — the same.
- [x] 1.8.7 Split `fixtures.test.ts` into `transpile-replay.test.ts`, `map.test.ts` and `lsp-replay.test.ts`.
  - What: the LSP replay binds through `lower/project/library-base.ts`; `project-libraries.ts` uses it too.
  - Where: `test/conformance/*.test.ts`, `support/project-libraries.ts`.
  - Accept: G+LSP, T, M identical.
  - Depends: 1.8.6, 1.6.20.
  - Done 2026-10-08 (step 1.8b). `fixtures.test.ts` (2319 lines) → `transpile-replay.test.ts` (the rating rows: its
    banner "the rating rows" through "no fixture the BUILD recording compiled was refused by the simulator", with the
    enum, clock and interpreter helpers only it reads), `map.test.ts` ("the table itself" and "ratchet one"),
    `lsp-replay.test.ts` ("ratchet two"); what more than one reads — `SELECTION`/`whole`, the build recordings
    (`BUILDS`, `RecordedDiagnostic`), the one lowering cache (`lowering`), `reproducible`, the rating index (`rated`) —
    in `support/fixture-suite.ts`, with the contract's doc ("one selection, three files"). Every line of the old file is
    in exactly one new one (imports aside; checked line by line). `partial-run.test.ts` runs the three files (its
    `SCOPED` list unchanged, green). Citations of the deleted file re-pointed to the file that holds what each says
    (src, scripts, fixtures, support, docs, `TESTING.md`, `test/README.md`) — except `rate-fixtures.ts`'s header text,
    which is written into `map.generated.ts` (M identical here; 1.9.3). NOT done as written: "the LSP replay binds
    through `lower/project/library-base.ts`". Since this task was written the replay moved to `support/replay.ts`
    (analysis-conformance 2.6), which swaps a fixture into a SYMBOL project bound from the libraries' declarations, the
    devices and the manifests (`build.bindFile`/`relink`), while `LibraryBase` binds a LOWERING project from the
    libraries' bodies — different contents, and rebinding the replay on it is a change of what the LSP is asked, not a
    move (G+LSP requires it unchanged). `project-libraries.ts` already builds `PROJECT_BASE` with `libraryBase`.
- [ ] 1.8.8 `libraries/index.ts` takes the manifest's `folder` instead of slicing the URI (l.70).
  - Where: `libraries/index.ts`.
  - Accept: G, S.
  - Depends: 1.6.20.
  - NOT done (step 1.8b), for the gate: not output-neutral as written. The manifest's `folder`
    (`frontend/library/manifest.ts:52`) is the folder's lower-cased NAME, not its path; `withImplementations` builds
    each body's uri as `<the manifest's directory, as written> + <element>.pou`, so a body added beside the
    declarations (or replacing one) would change the case of its uri — the uris lowering keys files by (S). The neutral
    alternatives both move the slice rather than remove it (a `LibraryManifest.dir` field in the front-end, or a
    `frontend/library/path.ts` helper). Default if the owner says nothing: add `dir` (the folder as written) to
    `LibraryManifest`, read it here; that is a front-end change outside this task's Where, so it waits for the gate.
  - Gate 1.8a+1.9 (2026-10-08): left open, unchanged — the review raised nothing on it, and the default is a front-end
    API change better done with an owner's yes than inside a gate; it blocks nothing in phase 2.
- [x] 1.8.9 The fold-agreement test (design.md P3a).
  - What: for every constant expression the lowered fixtures fold, `types/const/fold.constEval` (AST) and `semantics/fold.constantValue`
    (IR) give the same value and type; each disagreement found is an expected failure naming its RC or a new 6.A task.
  - Where: `test/conformance/fold-agreement.test.ts`.
  - Accept: G; the disagreement count is written here.
  - Depends: 1.8.4, 1.3.3.
  - Done 2026-10-08 (step 1.8b). `test/conformance/fold-agreement.test.ts`: each lowered fixture's own bodies (PLC_PRG,
    and the routines and layouts of units its own source declares) walked; each IR expression `constantValue` answers
    is matched by its exact span to the AST expression it was lowered from (the outermost IR node at that span that is
    not a `convert`), and that expression — when the front-end calls it a CONSTANT (`constancyOf`), not a literal, not
    a STRING — is folded by `constEval` in its unit's scope (the libraries bound as the LSP binds them, the fixture on
    top). Agreement = the same value, of the same kind, once the AST value is stored as the IR node's type holds it (an
    integer wrapped to the width, an integer into a REAL as that number, a REAL rounded to float32 — the IR node is typed
    by its context, the AST fold is not). 375 constant expressions compared; 24 disagree, all one cause, each an
    expected failure naming it (the test fails on an unnamed one, and on a named one that agrees): SIZEOF of a
    STRUCT, an FB instance, an ARRAY or a packed DUT, which the AST fold leaves unfolded (it has no layout) and the IR
    sizes — filed as 6.A.31 (not niche: 198 SIZEOF calls in the six corpora, most over a STRUCT). The disagreement count
    is 24.
  - CORRECTED by the 1.8a+1.9 gate (2026-10-08; review findings, red first). (a) The test skipped every expression the
    IR fold left unanswered BEFORE the constancy filter, so "375 compared" hid 45 the front-end calls constant: it now
    starts from `constancyOf` and counts one side answering nothing, or neither, as a disagreement. Of the 45: 23 were
    reads of a `VAR CONSTANT`, which lowering keeps as a `load` of its slot (as the vendor reads a non-replaced
    constant) — the IR's answer is now the IR fold with each load the front-end reads as a constant taken as its slot's
    `init` (`withConstantSlots`; never a parameter, never a direct address), and all 23 agree; 4 were a `VAR_EXTERNAL
    CONSTANT` (`xo3_value_functions_across_objects`), which the AST fold left valueless — FIXED in `types/const/fold.ts`
    (it folds to the global `externalGlobal` binds, when that is a constant; `fold.test.ts` red first); 1 was a BIT
    constant, `b : BIT := 1`, read by the AST fold as the integer it is written as and held by the IR as a BOOLEAN (the
    test stores it as `semantics/store.ts` `fit` does); 14 are `constancyOf` calling a read-only PARAMETER (`VAR_INPUT
    CONSTANT`, `VAR_IN_OUT CONSTANT`, expressions over one) or a direct address (`%MW30 + 1`) a CONSTANT — finding 3 of
    the review, below. (b) A KNOWN mark no longer compared at all now fails like one that agrees (a bogus mark fails it,
    checked). (c) The header said "the DEEPEST IR node"; it is the outermost non-`convert` one, as `irBySpan` does.
    Front-end finding 3 (`constancyOf` answers CONSTANT for a read-only parameter and a direct address, so a CASE label
    naming one gets no C0218): niche: accepted loss (0 occurrences in the corpora — no `VAR_INPUT CONSTANT` or
    `VAR_IN_OUT CONSTANT` section, no direct address in a CASE label, array bound or repeat count in the six), and not
    cheap: `constancyOf` is read both as "read-only" (C0018 a write, C0041 an in-out argument) and as "compile-time
    constant" (C0218, C0162), so it needs splitting, and the vendor's answer for such a CASE label is unmeasured. Its 14
    expressions are KNOWN marks with that reason. Numbers: 420 constant expressions compared, 38 disagree, 38 known
    (24 SIZEOF → 6.A.31, 14 niche).

### 1.9 Close the structure phase

- [x] 1.9.1 architecture.md's transpile section.
  - What: the folder map (design.md §2.0), the layer table (P2), the ownership rows (§2.8), the two folds (P3a); the `__TRY` note from 1.6.16.
  - Where: `docs/architecture.md`.
  - Accept: `check-citations` reports no missing path in it.
  - Depends: 1.8.7.
  - Done 2026-10-08 (step 1.9). `docs/architecture.md` "Backend — `transpile/`": the folder map (the tree as it is, every
    file named; `lower/conditions.ts` at the lower root with its reason; `calls/routine-frame.ts` from 1.9.4), the layer
    table (rules 3, 4, 4b, 6 as `check-layering.ts` enforces them, the known edges by name), the size ratchet, the two
    constant folds and their agreement test; the stale "only `ir/` is importable across folders" and `Lowering.cursors`
    lines replaced (`PointerFrame.cursors`). The ownership map gains §2.8's rows at their REAL homes (the EXTENDS chain is
    `frontend/symbols/extends`, not `scope-nav`; the folds' row names both). The `__TRY` note was already there (1.6.16).
    `check-citations` reports no missing path in it.
- [x] 1.9.2 data-model.md and scripts README.
  - What: data-model.md's `## types` section corrected (it still documents the deleted ResolvedType/InferredType and lacks `length`,
    `bounds`, `tickNs`, `mantissaBits`) and a `## transpile IR` section; `scripts/README.md` gains the snapshot, size and citation tools.
  - Where: `docs/data-model.md`, `scripts/README.md`.
  - Accept: `check-citations` reports no missing path in them.
  - Depends: 1.9.1.
  - Done 2026-10-08 (step 1.9). `docs/data-model.md`: `## frontend/types` already had the one `Type` (frontend-conformance
    removed `ResolvedType`/`InferredType`; they survive only in "Rebuild refinements", marked as built) and `length`,
    `bounds`; it gains `ElementaryType`'s `tickNs` and `mantissaBits` and a note on `length`/`bounds` as facts the
    resolver may leave absent. New `## transpile IR`: `IrValue`, `IrInit`, `IrPou`, `IrSlot`, `IrLayout`, `IrRoutine`,
    `Place`, `Access`, the `IrExpr` and `IrStmt` unions, `IrBinding`, `LoweredPou`, `LowerDiagnostic`, `FaultKind`, and the
    walk. `scripts/README.md` already listed the snapshot, size and citation tools (1.0); their rows are brought up to
    date (`CEILINGS` empty; the citation check strict, `PLANNED`, ticked tasks skipped). No missing path in either.
- [x] 1.9.3 Re-point every stale path citation.
  - What: every citation `check-citations` reports (src comments, fixture comments such as `oop/lifecycle.ts`, `memory/memory-model.ts`,
    `syntax/literal-value.ts:170`, the ~60 NOTES/LEAN texts such as 'emit.ts:517', 'expressions.ts:241-247', and the open openspec
    changes' tasks such as 'lower.test.ts:614') names its new file; `check-citations` becomes an error in lint.
  - Where: the cited files; `support/notes/*.data.ts`; `openspec/changes/*/tasks.md`; `scripts/check-citations.ts`.
  - Accept: G; M (only note texts change); `check-citations` reports 0.
  - Depends: 1.9.2.
  - Done 2026-10-08 (step 1.9). 574 missing citations at the start (after 1.8b) → 0; `check-citations --strict` is in
    `bun run lint`. Two rules, test-first (`check-citations.test.ts`, 2 new): (a) in a `tasks.md` a TICKED task's lines
    are its record and are not read — re-pointing "`emit.ts` deleted" would falsify it; this alone took 574 → 200;
    (b) `PLANNED`: the files open tasks will create, each named with its task (`semantics/string.cases.ts` 3.4,
    `semantics/memory.ts` 4.4, `semantics/builtins.test.ts` 6.7, `emit/rust/precedence.ts` 7.3.8, the network seam's
    `network-text/index.ts`, vendor-fact-probe's two scripts); a planned file that exists fails the check. Re-pointed:
    the 18 LEAN texts (`emit.ts:49` → `emit/rust/types.ts rustType`, `ir/evaluate.ts` → `semantics/fold.ts`, `lower/
    constants.ts` → `lower/values/fold.ts`, `lower/specialize.ts` → `lower/calls/specialize.ts`, the review's scratch
    normalizer → `support/transpile/shape.ts` …); every src and fixture comment (a live file by its path; a gone file —
    "it lived in X" — by its name without `.ts`; "see pragma-tests.ts for field docs" → `test/conformance/types.ts`);
    the open tasks' Where/What lines here and in lsp-transpile-review-gaps; the dated 2026-10-03 hand-off names its
    moved modules without `.ts` (42, with a note); `rate-fixtures.ts`'s header. M: `map.generated.ts` differs from HEAD
    only in note texts and the header's source paths (114 lines, edge agree 3046, disagree 0, not-run 179). One citation
    sat in the Rust the runtime carries (`runtime/string.ts`, a comment line of the string prelude: `ir/values.ts` →
    `semantics/string.ts`): S's rust layer moves by that one comment line in the 362 string-using fixtures — outputs and
    edge verdicts identical (see 1.9.4).
  - Gate 1.8a+1.9 review (2026-10-08). (a) Two re-pointed citations named a file that does not hold what they cite —
    fixed: `MEASURED_SILENT` is `transpile-replay.test.ts`'s (lsp-transpile-review-gaps' tasks, `fixtures/names/enums.ts`,
    `fixtures/types/arithmetic-results.ts`, `test/frontend/baseline.ts`), `standardLibrary` is `support/replay.ts`'s
    (`support/evidence.ts`). (b) A `PLANNED` file resolved by its bare name, so any `memory.ts` anywhere passed — fixed,
    red first (`check-citations.test.ts`): a planned file resolves only by a tail with its folder; the four bare
    `string.cases.ts` in this file's open tasks now say `semantics/string.cases.ts`. (c) OWNER DECISION, default taken:
    the ticked-task rule narrows this task's Accept ("every reported citation names its new file") to the lines outside
    ticked tasks — kept, because a ticked task's text is the record of what was done then (re-pointing "`emit.ts`
    deleted" would falsify it); if the owner wants ticked history re-pointed too, drop `recordLines` and re-point the
    374 lines it skips.
- [x] 1.9.4 Checkpoint review.
  - What: a fresh-implementation review of the new tree (memory: review at checkpoints); findings fixed or filed as tasks here.
  - Where: all of `src/transpile/**`.
  - Accept: the size ceiling list for `src/transpile/**` is empty and the >80-line function list is empty; S identical to 0.5; T
    identical to 0.5.
  - Depends: 1.9.3.
  - Done 2026-10-08 (step 1.9). Size: no ceiling (since 1.8.1) and no function over 80 lines — the five split in place,
    output-neutral: `semantics/builtins.ts` `builtinValue` (→ `bitValue`, `stringBuiltin`), `storage/declare.ts`
    `declareVars` (→ `declareOne`, `startValue`, `declareNames`), `builtins/conversions.ts` `lowerConversion` (→
    `boolConversion`, `textConversion`, `refusesEnumToString`, `stringConversion`, `numericConversion`, `tickConversion`;
    the REAL_TO_STRING sweep note kept whole beside them), `calls/routines.ts` `calledRoutine` and its closure (→ new
    `calls/routine-frame.ts`: `routineInputs`, `hiddenInOuts`, `instanceInOuts` — `routines.ts` would have passed 400
    lines). Review findings: (1) the five long functions — fixed above; (2) `conversions.ts` refused a wrong arity with
    the same `lw.bail` four times — one `arityRefusal`; (3) three of the five `KNOWN_TRANSPILE_VIOLATIONS` were "reported
    to the gate" with no owning task — filed as 6.B.6; (4) the lowering tests copy the one-line helpers `ir`/`wrap` into
    each file that uses them (1.8.1) — test-only, kept (a shared module is not in the design; noted, not filed).
    `dead-exports.ts --scope src/transpile`: no finding. S: `ir`, `outputs`, `edge` identical to 0.5; `rust` differs in
    exactly one line — the runtime prelude's comment 1.9.3 re-pointed — in the 362 fixtures that carry the string prelude
    (checked: with that comment reverted the `ir`+`rust` layers are identical). T: identical to 0.5 but for the tests this
    phase added on purpose (the fold-agreement test, 1.8.9; the two `check-citations` rules, 1.9.3).
  - Gate 1.8a+1.9 review (2026-10-08): S is not literally identical to 0.5 (the one emitted comment line above).
    OWNER DECISION, default taken: keep the re-pointed comment (a path that names a deleted file would fail the strict
    citation check, and a path-free rewording changes the same line) and leave 0.5 as it is; the rust layer's only
    difference is that line in the 362 string fixtures (re-checked at the gate: 362 differ, as before; the 200 the check
    prints all differ first in that line; the two fixtures the gate's VAR_EXTERNAL fold reaches, `xo3_*`, identical). Re-baselining 0.5's rust layer is the owner's call.
  - GATE 1.8a+1.9 (2026-10-08). Review: seven findings — five fixed (fold-agreement's blind spot, its stale-mark
    check and its header, 1.8.9; the two wrong citations and the bare `PLANNED` tail, 1.9.3), the front-end
    `constancyOf` one recorded as niche (1.8.9), two owner decisions with their defaults taken (ticked-task rule,
    1.9.3; S's comment line, above). The VAR_EXTERNAL CONSTANT fold moves the front-end fold census
    (`test/frontend/baselines/fold-dump.json`, rewritten): body folds 457 → 464 (codesys), 422 → 429 (twincat), does
    not fold 84 → 77, 81 → 74; its recorded-value comparison still 0 disagreements. Numbers (VOLT_REQUIRE_FULL=1,
    VOLT_FIXTURES unset): `bun typecheck` clean; `bun run lint` green (layering 5 known; size 0 ceilings; citations
    strict, 0 missing, 7 planned); `dead-exports.ts --scope src/transpile` no finding; `bun test` 8531 pass, 35 skip,
    432 todo, 0 fail (8998 tests, 303 files, 546 s); fold agreement 420 compared, 38 disagree, 38 known; S: 362
    fixtures differ from 0.5 by the one comment line (as recorded above), nothing else; `bun run rate:fixtures` —
    `map.generated.ts` differs from HEAD only as 1.9.3 records (114 lines; edge agree 3046, disagree 0, not-run 179);
    `bun run test:corpus` 19 pass, 1 skip, 0 fail; `bun run check` 18 passed. ONE commit for 1.8a, 1.8b and 1.9: they
    ran as one run in one tree (1.9.3 re-points citations in the files 1.8a/1.8b moved), as with 1.6a-1.6d.

## 2. Model 1: loops (RC 27, 35, 36, 39; RC 13's transpiler half; RC 13 guard)

- [x] 2.1 Measure.
  - What: (a) interpreter wall time on `tr_27_loop_cap_while_5000000` and `tr_27_loop_cap_for_1000001` with the cap disabled; (b) every
    test, recording and fixture that reaches `LOOP_CAP_MESSAGE`; (c) how the harness distinguishes a CODESYS stop (timeout) from a
    runaway; (d) record `for_counter_at_type_max` (INT counter to 32767 with an EXIT guard), `for_runtime_step_changed_in_body`
    (the body changes the step variable) and `for_runtime_step_same_type` (INT variable step on an INT counter).
  - Where: this file (numbers); fixtures in `test/conformance/fixtures/semantics/execution.ts`.
  - Accept: recordings committed (`record:exec`); the numbers written here.
  - Depends: 1.9.4.
  - Done (2026-10-08, at 7dcd537a00; a single-use scratch probe, deleted — nothing under `scripts/`). The cap is ALREADY gone:
    RC 27 landed in f052467157 (transpile-review 27) — `LOOP_ITERATION_CAP`/`LOOP_CAP_MESSAGE` were deleted from `ir/`, the
    interpreter and the Rust, and a harness opts in to a guard: `run(pou, { loopGuard })` throws `LoopGuardError` (a
    `RangeError`, not an `IecFault`), `emitRust(pou, { loopGuard })` prints `assert!(__guard_N <= …, "harness loop guard")`,
    both counting one body entry (after a head test) as one pass. So design §3.1 option (a) is what exists, under the names
    `loopGuard`/`LoopGuardError` rather than `loopBudget`/`HarnessBudget`; 2.2 decides the names and what of 2.3 is left.
    - (a) Interpreter wall time, NO guard, median of 5 (min–max), one scan: `tr_27_loop_cap_for_1000000` 215 ms (199–229),
      `_for_1000001` 214 ms (206–220), `_repeat_1000001` 141 ms (140–162), `_while_5000000` 662 ms (644–686) — ≈ 0.13–0.21
      µs per pass. Every recorded pass count runs in under a second; no cap is needed for speed.
    - (b) Who reaches a guard. `LOOP_CAP_MESSAGE`: nothing (deleted). Recordings with a pass count ≥ 1,000,000: only the four
      `tr_27_*` (1,000,000 / 1,000,001 / 1,000,001 / 5,000,000). Every fixture lowered (3,228 of 5,360 — the three 2.1 fixtures included; re-run at gate 2a, the first write-up's 3,226
      was a mid-step tree) and scanned with the
      guard at the OLD cap (1,000,000): 8 pass it — the three `tr_27` over 1,000,000 plus `cc4_loop_exit_constant`,
      `cc6_loop_cannot_exit`, `flw_for_byte_to_255`, `flw_for_int_down_to_min`, `flw_for_usint_by_two_to_255`; at the harness
      guard (`HARNESS_LOOP_GUARD` 10,000,000) only those five, all rated `unaskable` (their `execSkip`: the scan never ends in
      CODESYS either), ≈ 7–8 s each in the interpreter to reach it. Edge variants the interpreter's edge guard
      (`EDGE_INTERP_GUARD` 1,000,000) gives up on: 15 fixtures — the five above (all variants), the three `tr_27` over the old
      cap (11/11, 5/6, 5/6), `for_counter_at_type_max` 2/16, `for_limit_wider_than_counter_dint_var` 1/16, `_dint_expr` 2/16,
      `cc3_empty_and_noop`, `flw_empty_semicolon_body`, `stmt_while_empty_body`, `stmt_repeat_empty_body` 1/8–1/11 each (a seed
      that hands a loop a bound nobody arranged). Code that names the guard: `interp/{machine,runner,index}.ts`,
      `emit/rust/{loops,module,printer}.ts`, `index.ts` (+ `index.test.ts` lists `LoopGuardError`),
      `pipeline/control.test.ts` (the counting rule), `emit/rust/loops.test.ts`, `test/conformance/{backends,emit-build,
      transpile-replay}.test.ts`, `support/{snapshot,snapshot.test}.ts`, `support/transpile/edge.ts`,
      `scripts/{rate-fixtures,frontend-snapshot}.ts`. Map today: `clippy::manual_assert` 818 (lean 5.1 counted 1502 with the
      cap), `clippy::unreadable_literal` 2810 (the guard prints `10_000_000`, so none of it is the guard's).
    - (c) Stop vs runaway: the harness does NOT tell them apart — not by the recording, and not by its error text.
      (Corrected at gate 2a; the first write-up said the error text separates them, and it cannot.) A program that faults
      the simulator records one of TWO texts: `"The operation has timed out."` (27 recordings — 24 `confirmed`, 3
      `not-lowered` — thrown by the online calls `oa.start`/`read_value`) or `record-exec.py`'s 10 s done-flag poll text
      `"the done flag never rose … did not finish its cycles"` — the text a runaway would also get. One CONFIRMED fault
      already carries it: `arithedge_uint_div_by_zero` (a divide by zero), replayed through `compareFault` like the 24.
      `transpile-replay.test.ts`'s own comment says so ("a timeout or a done flag that never rose"). Every recording with an
      `error` on a `confirmed` fixture goes to `compareFault`, which runs `run()` with NO loop guard. The five runaway
      fixtures are kept out ONLY by their hand-written `execSkip` (`flow-rules.ts` ENDLESS and the cc batches): the recorder
      never runs them (no recording at all) and `evidence.ts` rates them `unaskable`. Gap for 2.2, larger than first
      reported: a disjointness check on the error text cannot be built (one confirmed fault already carries the runaway
      text), so nothing but `execSkip` stands between a runaway fixture and an unguarded `compareFault` — record one without
      it and the replay hangs. 2.2 decides the guard: `compareFault` running `run()` under the harness loop guard (a
      `LoopGuardError` is then NOT a refusal — it fails the case by name), so a runaway can no longer hang the suite whatever
      its recording says.
    - (d) Recorded (`record:exec`, CODESYS 3.5.21.40 simulation, one batch; `s`/`t` renamed after the first batch answered
      "Unexpected token 's' found" — CODESYS reads a lone `S` as the set operator):
      `for_counter_at_type_max` — cnt 32800, i = last = -32737: the INT counter WRAPS past 32767 and the loop never ends on
      its own (the EXIT guard stopped it), as `for_at_type_max` measured for SINT. A FOR to the type's maximum may NOT be
      printed as a Rust `for` range (`..=32767` would end) — lean 5.4/7.5.4 must keep the wrapping counter there.
      `for_runtime_step_changed_in_body` — cnt 4, last 16, i 25, stride 9: the step is RE-READ EVERY PASS (read once would be
      20 passes). `for_runtime_step_same_type` — up 4 (last 9, i 12), down 3 (last 2, j -2): an INT variable step on an INT
      counter is accepted and its sign picks the direction. So `statements/loops.test.ts` ("reads its limit and its step on
      every pass") and `places/bounds.test.ts` keep their premise, and lean 7.5.9 may NOT hoist the step (it may bind it once
      per pass). Note: `callshape_for_bounds_changed_in_body` (visits 2, lastIndex 4) already answered "limit AND step every
      pass" — design §3.1's "covers the limit only" understated it. All three rate `confirmed`, tier control, rust `vendor`,
      edge `agree` (`rate:fixtures`: confirmed 2806 → 2809, control 155/144 → 158/147, edge agree 3046 → 3049).
      `downStep` is written as a bare `-4`, the source the recording was made from (gate 2a restored it: the first write-up
      had edited it to `INT#-4` AFTER `record:exec` to dodge the capped type-census measure, which left the recording
      describing a text that was no longer the fixture's — the recorder keeps no source hash). A bare `-4` is a signed
      untyped number, UNKNOWN in the census until LT14, so it is registered where every earlier bare negative is: a
      `NEGATED_LITERAL_ROWS` entry in `test/frontend/baseline.ts` (`for_runtime_step_same_type`, 1 per vendor, "measured, not
      regressed"). The three fixtures move only COUNTS in
      `test/frontend/baselines` (rewritten with `VOLT_WRITE_BASELINE=1`; no finding, no ceiling): files 10714 → 10720,
      expressions +49 per vendor, literal UNKNOWN +16 per vendor, unrecorded-no-parse-error +3 per vendor (execution fixtures
      have no build recording, as the `tr_*` ones), recorded values 9099 → 9114. Tests: `test/conformance` 6195 pass,
      389 todo, 0 fail (full, before the `INT#-4` edit; VOLT_FIXTURES on the three after it: 0 fail); `test/frontend` 45
      pass, 0 fail.
  - [x] Gate 2a (2026-10-08). Four review findings, all fixed:
    - (c) was wrong — the error text does not separate a stop from a runaway (`arithedge_uint_div_by_zero`, a confirmed
      divide-by-zero fault, records the done-flag text). Rewritten above, with the larger gap handed to 2.2 (only `execSkip`
      keeps a runaway out of an unguarded `compareFault`). Tally of the recorded `error`s: timeout text 27 (24 confirmed,
      3 not-lowered), done-flag text 1 (confirmed), the five runaways no recording at all.
    - `downStep` back to the bare `-4` the recording was made from, registered as an LT14 "measured, not regressed" row
      (`baseline.ts` `NEGATED_LITERAL_ROWS`), not dodged. Baselines rewritten: type-dump expressions, literal UNKNOWN and
      signed-untyped UNKNOWN +1 per vendor (41228 → 41229 / 40242 → 40243, 8120 → 8121 / 8011 → 8012, 356 → 357 /
      354 → 355), literals stored 4640 → 4641; `ceilings.json` unchanged (the raise is the excepted row).
    - Edge variants the interpreter's loop guard gives up on are now COUNTED (`compareEdge` → `EdgeComparison.unanswered`;
      `edge.test.ts` red first): a row carries `edgeUnanswered: N`, the map header lists each partial `agree` with N/plan,
      and a plan with NO answered variant is `not-run` ("the interpreter's loop guard gives up on every variant") —
      an agreement on zero variants is not one. `transpile-replay.test.ts` holds the stored count to the computed one,
      `support/snapshot.ts` prints it. Map: edge agree 3049 → 3043, not-run 179 → 185 (the five runaways and
      `tr_27_loop_cap_for_1000001`, 9–11 of 9–11 unanswered); 10 partial agrees (`cc3_empty_and_noop` 1/8,
      `flw_empty_semicolon_body` 1/11, `for_counter_at_type_max` 2/16, `for_limit_wider_than_counter_dint_expr` 2/16,
      `_dint_var` 1/16, `for_runtime_step_same_type` 1/41 — missed by the first write-up's list —, `stmt_repeat_empty_body`
      and `stmt_while_empty_body` 1/8, `tr_27_loop_cap_repeat_1000001` and `_while_5000000` 5/6).
    - (b)'s scan re-run on the gate tree (a single-use scratch probe, deleted): 3,228 of 5,360 lowered (the three 2.1
      fixtures in), the same 8 fixtures reach the old 1,000,000 guard.
    - Numbers: typecheck clean; `bun run rate:fixtures` — confirmed 2809, refused 1989, not-lowered 389, lsp-gap 76,
      diverges 5, unaskable 92, control 158/147, shape 1719 over 3228 lowered, edge 3043 / 0 / 185; FULL `bun test`
      (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8538 pass, 35 skip, 432 todo, 0 fail (9005 tests, 303
      files, 675 s), fold agreement 420 compared, 38 disagree, 38 known; `bun run test:corpus` 19 pass, 1 skip, 0 fail;
      `bun run lint` exit 0; `bun run check` 18 passed.
- [ ] 2.2 Design "§3.1 Decision: loops".
  - What: the cap (option a or b), the counting rule, the step rule (refuse only a non-converting step, per 2.1's runtime-step
    recordings), literal vs typed limit, loop depth, labels by pre-scan, what stays refused (by code), and which of `places/bounds.test.ts` ("bounds from a POU's own constant …"),
    `statements/loops.test.ts` ("a FOR reads its limit and its step on every pass") and `emit/rust/loops.test.ts` ("a FOR whose limit is a different type") change and on which recording.
  - Where: `design.md`.
  - Accept: committed before any code.
  - Depends: 2.1.
- [ ] 2.3 The cap leaves the semantics (RC 27).
  - What: `ir/stmt.ts` loses `LOOP_ITERATION_CAP`/`LOOP_CAP_MESSAGE`; `interp/runner.ts` gains the `loopBudget` option raising
    `HarnessBudget`; `emit/rust/loops.ts` prints no counter (or a `cfg` guard, per 2.2). The cap describe (then in `loops.test.ts`) is
    deleted (premise contradicted by `tr_27`); `index.test.ts` loses the two names.
  - Where: `ir/stmt.ts`, `interp/machine.ts`, `interp/runner.ts`, `semantics/faults.ts`, `emit/rust/loops.ts`, tests.
  - Accept: F(`tr_27_loop_cap_for_1000000`, `_for_1000001`, `_repeat_1000001`, `_while_5000000`); a conformance boundary test at the old
    CAP and CAP+1 for FOR/WHILE/REPEAT in both backends; M (`manual_assert` and `unreadable_literal` fall).
  - Depends: 2.2.
- [ ] 2.4 FOR step (RC 35).
  - What: a folded constant step is wrapped to the counter width, its direction from the signed literal. A step whose type does not
    convert implicitly to the counter type (`types/compat.isAssignable`), or a folded step that does not fit, is refused with a
    registered code. A convertible runtime step keeps lowering, evaluated per 2.1's recording.
  - Where: `lower/statements/loops.ts`, `lower/diagnostics/codes.ts`.
  - Accept: F(`tr_35_for_byte_step_minus_one`, `tr_35_for_uint_step_minus_two`); `tr_35_for_byte_step_255` and
    `callshape_for_runtime_step` stay confirmed; `tr_35_for_byte_runtime_int_step` and `tr_35_for_sint_step_300` are refused by the
    transpiler (LSP half Filed); `loops.test.ts` and `bounds.test.ts` green (changed only as 2.2 says); M.
  - Depends: 2.3.
- [ ] 2.5 FOR literal limit in its own type (RC 36).
  - What: a literal limit is lowered without the counter as the expected type; the compare runs in the meet (`values/promote.ts`).
  - Where: `lower/statements/loops.ts`.
  - Accept: F(`tr_36_for_literal_limit_beyond_counter`) (n = 300, small = 44); src test; M.
  - Depends: 2.4.
- [ ] 2.6 A typed FOR limit wider than the counter is refused (RC 13's transpiler half).
  - What: a non-literal limit whose type does not convert implicitly to the counter type is refused with the implicit-conversion code.
  - Where: `lower/statements/loops.ts`.
  - Accept: `for_limit_wider_than_counter_dint_var`, `_dint_expr`, `_upper_bound` are refused by the transpiler (their `rust`/`tier`
    columns disappear; the LSP half is Filed); `for_limit_wider_than_counter_uint_n_minus_1` and the `5 TO -5 BY -1` fixture stay
    confirmed; src test red then green; M.
  - Depends: 2.5.
- [ ] 2.7 EXIT/CONTINUE outside a loop (RC 39).
  - What: a loop-depth counter beside `conditional`; a new code `stmt-exit-outside-loop`.
  - Where: `lower/statements/loops.ts`, `lower/core/lowering.ts`, `lower/diagnostics/codes.ts`.
  - Accept: `cc2_exit_outside_loop` is refused by the transpiler with the new code (it was edge `not-run`, rust `rejected`; its
    `rust`/`tier` columns disappear); src test red then green; M.
  - Depends: 2.3.
- [ ] 2.8 Labels from the IR pre-scan.
  - What: whether a loop needs `'loop_N`/`'body_N` comes from `ir/walk.loopUses`, not from rewriting printed lines (`loops.ts`, which
    rewrites the printed `'loop_N:`/`'body_N:` lines today); the printed text is unchanged.
  - Where: `emit/rust/loops.ts`, `ir/walk.ts`.
  - Accept: S-out and Rust identical (S on the rust layer).
  - Depends: 2.3.
- [ ] 2.9 RC 13 regression guard.
  - What: `emit/rust/loops.test.ts` compiles the UINT `n-1` loop.
  - Where: `emit/rust/loops.test.ts`.
  - Accept: G; `for_limit_wider_than_counter_uint_n_minus_1` and the negative-step fixture stay confirmed after 2.4-2.6 (the three typed
    wider limits are refused, per 2.6).
  - Depends: 2.6.
- [ ] 2.10 Model delta.
  - What: architecture.md's loop paragraph; the map delta written here.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 2.3-2.9.

## 3. Model 2: strings (RC 11, 34, 45; appendix string items)

- [ ] 3.1 Measure.
  - What: M1 (re-read `tr_45` cell by cell against RC 45's LIVE text; record `string_literal_nul_tail` if unresolved), M2
    (`string_assign_tail_narrow`, `string_assign_tail_wide`), M3 (WSTRING twins), M4 (`string_compare_tail`), M5
    (`string_conversion_result_capacity`, `concat_result_capacity`), M6 (interpreter time per representation on the `string_*` fixtures),
    M7 (how CODESYS prints a sizeless STRING in `codesys.build.json` messages, and every LSP message/hover that renders one).
  - Where: `test/conformance/fixtures/strings/string-edges.ts`; numbers here.
  - Accept: recordings committed; M1-M7 answered here.
  - Depends: 1.9.4.
- [ ] 3.2 Design "§3.2 Decision: strings".
  - What: the representation (a/b/c) in TS and Rust (incl. the `B = n+1` const parameter), literal NUL, assignment across capacities,
    comparison, conversion capacity, where the capacity default is applied (transpile-side, per type.ts:36-38 unless M7 contradicts), the
    commonType item per M7, the tests that change and why.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 3.1.
- [ ] 3.3 Every string Type the transpiler holds carries its capacity.
  - What: `core/lowering.resolve` applies `DEFAULT_STRING_LENGTH` to every sizeless STRING/WSTRING it returns; `withStringCapacity`
    (`storage/layout.ts`) is deleted; `types/resolve.ts` is unchanged. The appendix item "commonType treats a sizeless STRING as capacity
    0" is fixed in `types/arith/runtime.ts` or closed with M7 as the reason, per 3.2.
  - Where: `lower/core/lowering.ts`, `lower/storage/layout.ts`, `types/arith/runtime.ts` (if 3.2 says so).
  - Accept: G+LSP (LSP output byte-identical unless 3.2 names the change); S-out (list any Rust that printed capacities differently).
  - Depends: 3.2.
- [ ] 3.4 `semantics/string.ts` new model plus `semantics/string.cases.ts`; the interpreter runs it.
  - Where: `semantics/string.ts`, `semantics/string.cases.ts`, `string.test.ts`, `interp/frame.ts`.
  - Accept: `semantics/string.test.ts` green on the case table (`tr_34`, `tr_45`, `lib_prim_char_past_length`, M1-M5 cells).
  - Depends: 3.3.
- [ ] 3.5 `emit/rust/runtime/string.ts` new model.
  - Where: `emit/rust/runtime/string.ts`, `emit/rust/types.ts`, `values.ts`.
  - Accept: `runtime-twins.test.ts` runs `semantics/string.cases.ts` through rustc and matches.
  - Depends: 3.4.
- [ ] 3.6 Bytes behind the terminator (RC 34).
  - What: a store at or past `len` rescans; a same-capacity copy keeps the units.
  - Where: `semantics/string.ts`, `runtime/string.ts`, `lower/places/places.ts` (`s[i]`).
  - Accept: src pipeline test (right-to-left digit fill gives '4321'; 'abcdef' with `t[2]:=0; t[2]:=88` gives 'abXdef');
    `tr_34_lib_prim_char_behind` flips only at 4.12 (it needs POINTER TO BYTE).
  - Depends: 3.5.
- [ ] 3.7 `$00` in a literal (RC 45).
  - What: the literal valuation keeps the decoded units; `values/literals.stringLiteralText` builds a buffer whose `len` is the first 0,
    the bytes behind per M1. If frontend-conformance closed the decoding half (0.1), only the lowering half remains.
  - Where: `frontend/syntax/literal/value.ts`, `lower/values/literals.ts`.
  - Accept: F(`tr_45_string_embedded_nul`); G+LSP; M.
  - Depends: 3.6.
- [ ] 3.8 Conversions without the 80 cut (RC 11).
  - What: an operand keeps its own capacity; a wide result is sized by the source (M5).
  - Where: `lower/builtins/conversions.ts`.
  - Accept: F(`tr_11_string_conversion_beyond_80`), which now lowers; `xo3_string_wide_conversions` stays confirmed; M.
  - Depends: 3.6.
- [ ] 3.9 Tests that pinned the old model.
  - What: `pipeline/strings.test.ts`, `semantics/string.test.ts`, `builtins/conversions.test.ts`, `places/places.test.ts`,
    `builtins/value-functions.test.ts`, `pointers/cursor.test.ts`, `test/libraries/{standard,stringutils}.test.ts`: each changed
    expectation cites its recording.
  - Where: those files.
  - Accept: G; the diff lists every changed expectation with its recording.
  - Depends: 3.8.
- [ ] 3.10 Whole-string cursor store (appendix).
  - What: record `cursor_whole_store_capacity`; fix it or refuse it by name.
  - Where: `lower/pointers/cursor.ts`.
  - Accept: recorded; F or a named refusal; M.
  - Depends: 3.9.
- [ ] 3.11 StrReplaceA past LEN (appendix).
  - What: re-run `STRREPLACEA.fun` on the new model; fix the library body only if it is still wrong against its recording.
  - Where: `libraries/StringUtils/**`.
  - Accept: the `stringutils.test.ts` case green against the recorded value.
  - Depends: 3.9.
- [ ] 3.12 Model delta.
  - What: architecture.md's string paragraph; the map delta (string fixture sizes).
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 3.6-3.11.

## 4. Model 3: pointers and references (RC 14, 15, 16, 17, 18, 20, 26, 44)

- [ ] 4.0 RC 26: SIZEOF of an FB (the layout the arena option needs).
  - What: skip replaced scalar VAR CONSTANTs; add 8 bytes per implemented interface.
  - Where: `lower/storage/bytes.ts`, over `core/chain.implementsOf`.
  - Accept: F(`mem_fb_var_constant_scalar` 16, `mem_fb_implements_one` 24, `mem_fb_implements_two` 32); `mem_fb_var_constant_non_replaced`
    and `mem_fb_var_constant_struct` stay confirmed; M.
  - Depends: 1.9.4.
- [ ] 4.1 Measure.
  - What: the census starting from `transpile-st-to-rust/pointer-model.md` (re-run parse-based, diffed against 2026-09-20): every
    `indirect` fixture, every not-lowered pointer/any/interface/call-fb-inout row (`scripts/probe-lowering-refusals.ts`), every pointer
    `rejects` fixture, each with its predicted verdict under (a) tags, (b) arena, (d) per-pointer enum. A spike of (a), (b), (d) on the
    ten fixtures of design.md §3.3. New recordings: `pointer_to_dword_roundtrip`, `pointer_order_compare`, `adr_difference_two_arrays`,
    `pointer_byte_walk_struct_padding`, `pointer_step_past_end`.
  - Where: this file (census table, spike numbers); fixtures in `test/conformance/fixtures/memory/`.
  - Accept: the census table here; recordings committed.
  - Depends: 4.0.
- [ ] 4.2 Design "§3.3 Decision: pointers".
  - What: the decision by fixtures, then Rust cost, then LOC; whether the three tag schemes unify (and why not, if not); which `staticKey`
    options become removable; the refused list by code; which transpile-st-to-rust pointer tasks it supersedes (update 0.8's list); the
    rewrite of architecture.md's "pointers will become indices" paragraph.
  - Where: `design.md`; `openspec/changes/transpile-st-to-rust/tasks.md`.
  - Accept: committed.
  - Depends: 4.1.
- [ ] 4.3 IR for the decision.
  - What: `ir/expr.ts` changes (reinterpret / load-bytes / store-bytes nodes if (b); an enum-handle node if (d)); `ir/walk.ts` extended.
  - Where: `ir/expr.ts`, `ir/walk.ts`, `walk.test.ts`.
  - Accept: G; `walk.test.ts` totality green.
  - Depends: 4.2.
- [ ] 4.4 Both backends implement the representation.
  - What: `semantics/memory.ts` (if (b)), `interp/frame.ts`, `emit/rust/runtime/pointer.ts`, `emit/rust/types.ts`; lowering in
    `pointers/state.ts`, `address.ts`, `deref.ts`, `store.ts`.
  - Where: those files.
  - Accept: every currently confirmed `indirect` fixture stays confirmed; S-out on all non-pointer fixtures; M.
  - Depends: 4.3.
- [ ] 4.5 One below the first element (RC 44).
  - Where: `lower/pointers/state.ts`, `address.ts`.
  - Accept: F(`tr_44_pointer_step_below_first_element`) (lowers; isNull = FALSE); M.
  - Depends: 4.4.
- [ ] 4.6 S=/R= through a multi-target pointer (RC 14).
  - What: the latch goes inside each arm of `storeThrough`; independent of the decision.
  - Where: `lower/pointers/deref.ts`.
  - Accept: F(`tr_14_set_reset_through_multi_target_pointer`); src test; M.
  - Depends: 1.9.4.
- [ ] 4.7 An FB copy keeps its ADR(own member) address (RC 15).
  - What: modelled (foreign target / arena / enum) or refused by name.
  - Where: `lower/pointers/state.ts`, `statements/assign.ts`.
  - Accept: F(`tr_15_fb_copy_keeps_pointer_address`), or its refusal code in the design's refused list and the fixture rated accordingly; M.
  - Depends: 4.4.
- [ ] 4.8 An FB copy carries its in-out binding (RC 16).
  - Where: `lower/calls/last-binding.ts`, `entry/finish.ts`.
  - Accept: F(`tr_16_fb_copy_carries_inout_binding`) (first = 11, second = 100; no `_ => panic` reached); src test in `last-binding.test.ts`; M.
  - Depends: 4.4.
- [ ] 4.9 ANY pValue and the pointer's type (RC 17).
  - What: reinterpret under (b), or a `pointer-type` refusal plus arm pruning by constant diSize under (a)/(d).
  - Where: `lower/pointers/any.ts`.
  - Accept: F(`tr_17_any_pvalue_dint_via_real`, `_byte_via_sint`, `_uint_via_int`, `_dint_write_via_byte`) or their named refusal;
    `state_any_int_pointer_increment` still lowers; M.
  - Depends: 4.4.
- [ ] 4.10 `__QUERYINTERFACE` into a global (RC 18).
  - What: compute the foreign edge as `storeInterface` does and model it (CODESYS accepts: r1 = r2 = 1).
  - Where: `lower/interfaces/query.ts`.
  - Accept: F(`tr_18_queryinterface_into_global`); M.
  - Depends: 4.4.
- [ ] 4.11 Routine outputs copied out after the call (RC 20).
  - Where: `lower/calls/outputs.ts`, `calls/binding.ts` (freeze loop).
  - Accept: F(`tr_20_output_index_moved_by_callee`) (arr[1] = arr2[1] = 5); src test; the LSP false positive stays in
    `KNOWN_DIVERGENCES.codesys` and is Filed; the transpile-st-to-rust VAR_OUTPUT task is ticked "superseded by 4.11"; M.
  - Depends: 1.9.4.
- [ ] 4.12 Fixtures the pointer model unblocks.
  - What: `tr_34_lib_prim_char_behind` (RC 34; u = 'abcBC', lenU = 5) and, if the decision supports reinterpretation,
    `tr_28_minmax_limit_nan_signed_zero_{real,lreal}` now lower.
  - Where: per 4.2.
  - Accept: F(`tr_34_lib_prim_char_behind`); `tr_28_*` lower (their values are 6.7's) or stay refused by the code 4.2 names.
  - Depends: 4.4, 3.6.
- [ ] 4.13 Appendix pointer items, each recorded first, then fixed or refused by name.
  - What: (a) a target set read while growing (`pointers/state.ts`); (b) a null source copied into a multi-target pointer
    (`pointers/store.ts`); (c) `0 = p` recognition (`expressions/operators.ts`); (d) `r.3` on a REFERENCE (`places/places.ts`); (e) an ANY
    input given a REFERENCE TO failing E0308 (`pointers/any.ts`); (f) a GVL FB never callable through an interface (`interfaces/lend.ts`
    `lendPlace`).
  - Where: as listed.
  - Accept: each has a fixture plus F or a named refusal; M.
  - Depends: 4.4.
- [ ] 4.14 The three tag schemes per 4.2.
  - What: merged into one scheme, or each kept with the reason 4.2 recorded, all numbering through `core/tags.ts`; the
    transpile-st-to-rust `instanceRelative` task resolved or left with a reason.
  - Where: `lower/pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`, `core/tags.ts`.
  - Accept: S-out; design.md P1's "Tag encodings" row states the final home.
  - Depends: 4.4.
- [ ] 4.15 Remove the `staticKey` named options 1.7.11 listed, where the model made them unnecessary; the rest carry a reason.
  - Where: `lower/places/path.ts` and callers.
  - Accept: S-out; no option without a written reason.
  - Depends: 4.14.
- [ ] 4.16 Model delta.
  - What: architecture.md "Places, not references" rewritten per 4.2; the refused list in docs; the map delta.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 4.5-4.15.

## 5. Model 4: instance initialization (RC 22, 23, 24, 25; RC 30 closed upstream)

- [ ] 5.1 Measure.
  - What: record `init_extends_interleaving`, `init_struct_field_fb_init_scope`, `init_structured_after_fb_init` (or cite its existing
    recording), `init_gvl_program_slot_order`, `init_this_in_initializer`, `var_temp_dynamic_init_method`,
    `var_temp_dynamic_init_function`, and `var_temp_dynamic_aggregate_init` (a VAR_TEMP array and struct with a dynamic initializer).
  - Where: `test/conformance/fixtures/declarations/` and `oop/`; numbers here.
  - Accept: committed recordings.
  - Depends: 1.9.4.
- [ ] 5.2 Design "§3.4 Decision: initialization".
  - What: the one ordered walk, the static-versus-dynamic split, the VAR_TEMP reset form decided by `var_temp_dynamic_aggregate_init`,
    the lift of `init-reads-instance`, the IR doc corrections.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 5.1.
- [ ] 5.3 Element defaults (RC 25).
  - What: `types/defaults.typeDefault` covers enum (via `types/enums`), alias initializer, alias array and elements;
    `init/initial-values.ts` fills `IrInit` completely; `semantics/instantiate.ts` and `emit/rust/values.initOf` no longer call `typeZero`
    for an element.
  - Where: `types/defaults.ts`, `lower/init/initial-values.ts`, `semantics/instantiate.ts`, `emit/rust/values.ts`.
  - Accept: F(`array_element_type_default`); partial tails stay zero (r_alias_part2 = 0); G+LSP; M.
  - Depends: 5.2.
- [ ] 5.4 RC 30 verified in the new home; the free `initOf` folded in.
  - What: RC 30 was fixed upstream (e06405f97c: `fresh` prints the init-aware `initOf`). The free `initOf(t, IrValue)` becomes a case of
    the one `initOf(t, IrInit)`.
  - Where: `emit/rust/values.ts`, `expr.ts`.
  - Accept: `decl_temp_array_init_resets`, `decl_temp_struct_init_resets` stay confirmed, edge agree; S-out; one `initOf` left (grep).
  - Depends: 5.3.
- [ ] 5.5 A dynamic VAR_TEMP initializer runs on every call (RC 24).
  - Where: `lower/init/temp-resets.ts`, per 5.2's form.
  - Accept: F(`var_temp_dynamic_init`, `var_temp_dynamic_init_method`, `_function`, `var_temp_dynamic_aggregate_init`); M.
  - Depends: 5.4.
- [ ] 5.6 Field initializers before FB_Init (RC 22).
  - Where: `lower/init/step.ts`, `init/instance-init.ts`.
  - Accept: F(`tr_22_fb_init_reads_adr_field`, `tr_22_fb_init_reads_call_field`); `tr_22_fb_init_reads_this_field` passes if 5.2 lifts THIS,
    else stays not-lowered with its reason written here; the EXTENDS order per `init_extends_interleaving`; M.
  - Depends: 5.2.
- [ ] 5.7 Declaration-ordered interleaving (RC 23).
  - Where: `lower/init/step.ts`, `init/sequence.ts`, `init/fb-init.ts`.
  - Accept: F(`tr_23_fb_init_argument_from_pending_init` got = 4, `tr_23_fb_init_argument_from_pending_init_reversed` got = 0);
    `init-reads-instance` lifted where legal; `initseq_*` fixtures stay confirmed; M.
  - Depends: 5.6.
- [ ] 5.8 Appendix init items.
  - What: the scope of a STRUCT field's FB_Init arguments (per `init_struct_field_fb_init_scope`); `insideInstance` refusing
    `holder.started` while allowing `holder.Get()`, made consistent.
  - Where: `lower/init/fb-init.ts`, `init/sequence.ts`, `places/path.ts`.
  - Accept: fixtures plus F or a named refusal.
  - Depends: 5.7.
- [ ] 5.9 The init-sequence read walk no longer skips `select` and freezes (appendix).
  - What: drop the skip option kept in 1.7.4.
  - Where: `ir/walk.ts`, `lower/init/sequence.ts`.
  - Accept: a src test with a select or freeze read in an initializer; S-out.
  - Depends: 5.7.
- [ ] 5.10 Model delta.
  - What: `ir/program.ts` docs (`IrPou.init`, `IrFresh`) corrected; architecture.md initialization paragraph; the map delta.
  - Where: `ir/program.ts`, `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 5.3-5.9.

## 6. Remaining open root causes (one task each, in the new structure)

Each task: a src test red first, the fix, then F and M. A RC closed upstream or by frontend-conformance (0.1) becomes "verify in the
new home": its test and fixture stay green, nothing else. RC 26 is task 4.0; RC 30 is task 5.4.

- [ ] 6.1 RC 2.3: a CONSTANT reference lowers to its folded value.
  - Where: `lower/places/names.ts`, `values/fold.ts`, `types/const/fold.ts` (`asConstant`).
  - Accept: F(`named_const_expression_keeps`) (d2 = 128 and e = 258 read); `named_const_literal_wrap` stays confirmed; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.2 RC 6: an out-of-range literal keeps its own type.
  - Where: `types/literal.ts` `contextLiteralType` (range rule), `values/convert.adopt`, `values/promote.meet`.
  - Accept: F(`tr_6_literal_beyond_dint_neighbour`) (gNegLint TRUE, sumNegLint -2999999995, sumUdLint 5000000005, …);
    F(`lt_literal_negative_in_comparison_unsigned`) (`ui > -1` FALSE as CODESYS records it: an untyped negative literal beside
    an unsigned operand is not converted into the unsigned type — rule LT12; filed by 0a, see 0.2);
    `cc_literal_3e9_into_dint` stays confirmed; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.3 RC 12: LDT/LDATE/LTOD → STRING.
  - Where: `semantics/text.ts` + `text.cases.ts` (the 11 recorded cells, incl. the wrap past 2262), `runtime/text.ts`, `emit/rust/convert.ts`,
    `types/predicates.hasTextFormat` for the gate in `builtins/conversions.ts`.
  - Accept: F(`tr_12_fmt_long_dates`) (the Rust compiles); twin test green.
  - Depends: 1.9.4.
- [ ] 6.4 RC 19: a METHOD's in-out shadows a field or VAR_STAT.
  - Where: `lower/places/names.ts`.
  - Accept: F(`tr_19_method_inout_shadows_member`, `tr_19_method_inout_shadows_var_stat`) (res = v = 101).
  - Depends: 1.9.4.
- [ ] 6.5 RC 21: a FUNCTION keyed and scoped by symbol identity.
  - What: bare calls use `symbols/precedence.pickForAsker`; `resolveNamedType` requires an asker, its callers (entry/lower-unit,
    places/globals, storage/layout, storage/bytes, types/infer `enumValueType` — appendix) pass one.
  - Where: `lower/calls/variants.ts`, `calls/namespace.ts`, `types/resolve.ts`.
  - Accept: F(`tr_21_namespace_qualified_first`, `tr_21_namespace_bare_first`) (a = 1020, b = 3); G+LSP.
  - Depends: 1.9.4.
- [ ] 6.7 RC 28: MAX/MIN/LIMIT on REAL.
  - What: compare-select `IF a>b THEN a ELSE b` (MIN: `a<b`), LIMIT = MIN(MAX(mn, in), mx).
  - Where: `ir/expr.ts` contract, `semantics/builtins.ts` + `numeric.cases.ts`, `emit/rust/builtins.ts`.
  - Accept: `semantics/builtins.test.ts` on the recorded NaN and ±0 cells; twin test; F(`tr_28_minmax_limit_nan_signed_zero_{real,lreal}`)
    once 4.12 lowers them.
  - Depends: 1.9.4, 4.12.
- [ ] 6.8 RC 29 verified in the new home.
  - What: closed upstream (3dd773b9d7): `RESERVED_FN_NAMES` (new, call, scan, clone, to_owned, clone_into, into, try_into) in `names.ts`.
  - Where: `emit/rust/names.ts`, `names.test.ts`.
  - Accept: all eight `tr_29_method_named_{clone,to_owned,into,try_into}_{result,no_result}` stay confirmed, edge agree.
  - Depends: 1.9.4.
- [ ] 6.9 RC 31: BIT conversions decide bool-ness via `isBoolValued`.
  - Where: `emit/rust/convert.ts`.
  - Accept: F(`tr_31_bit_conversions`) (compiles; 'TRUE'; INT_TO_BIT(2) = TRUE).
  - Depends: 1.9.4.
- [ ] 6.10 RC 32: `iec_ltime_text(ns: u64)`, no `i64` cast for LTIME (the LDT/LDATE `as i64` stays, per RC 12).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: F(`tr_32_fmt_ltime_past_i64`); twin test.
  - Depends: 6.3.
- [ ] 6.11 RC 33: LREAL_TO_STRING rounds a tie half-up (17 exact digits).
  - Where: `runtime/text.ts`; the cells in `text.cases.ts`.
  - Accept: F(`tr_33_fmt_lreal_tie`); twin test.
  - Depends: 1.9.4.
- [ ] 6.12 RC 37: CASE labels out of type or inverted are refused (CODESYS refuses all four).
  - Where: `lower/statements/case.ts`.
  - Accept: `tr_37_case_label_wraps_300`, `_wraps_minus_212`, `tr_37_case_range_inverted`, `_beyond_type` refused by the transpiler; the
    LSP half is already met (all four rate `refused`; lsp-transpile-review-gaps 1.3, ticked by 0.7).
  - Depends: 1.9.4.
- [ ] 6.13 RC 38: implicit STRING↔WSTRING and non-string→STRING refused via `types/compat.classifyConversion`.
  - What: stores, chain links, stores through a REFERENCE (appendix), arguments and compares; LEN(WSTRING) (appendix).
  - Where: `lower/statements/assign.ts`, `expressions/operators.ts`, `calls/outputs.ts`, `calls/binding.ts`.
  - Accept: `string_wstring_mixing` and `uop_*` refused (rows lose tier and rust; the `uop_neg_real` edge disagreement gone);
    `standard_len_wstring_rejected` refused; any LSP half Filed; M.
  - Depends: 1.9.4.
- [ ] 6.14 RC 40: DATE/DT/TOD ± LTIME is refused.
  - Where: `types/arith/temporal.ts`, `lower/expressions/calendar.ts`.
  - Accept: `tr_40_date_plus_ltime`, `tr_40_dt_plus_ltime`, `tr_40_tod_minus_ltime`, `tr_40_ltime_plus_date` refused by the transpiler and the
    LSP (the lsp-gap closes); G+LSP.
  - Depends: 1.9.4.
- [ ] 6.15 RC 41: MUX/SEL evaluate only the selected input; LIMIT follows the recorded order.
  - Where: `ir/expr.ts` (evaluation contract per builtin), `semantics/builtins.ts`, `lower/builtins/value-functions.ts`, `emit/rust/builtins.ts`.
  - Accept: F(`tr_41_mux_side_effects`, `tr_41_sel_side_effects`, `tr_41_limit_evaluation_order`) (x = 4); both edge disagreements gone.
  - Depends: 1.9.4.
- [ ] 6.16 RC 42: `typeKey` keys arrays by element plus bounds, recursively.
  - Where: `lower/calls/variants.ts`.
  - Accept: F(`tr_42_any_array_variant_key`) (the Rust compiles).
  - Depends: 1.9.4.
- [ ] 6.17 RC 43: output bindings use `isAssignable`, on both paths.
  - Where: `lower/calls/outputs.ts`.
  - Accept: F(`tr_43_output_word_to_int` a = -1, `_word_to_udint` 65535, `_int_to_real` -3.0); `tr_43_output_dint_to_int` refused.
  - Depends: 4.11.
- [ ] 6.18 RC 46: EXPT.
  - What: a correctly rounded pow with C semantics for the edge cells, and a stop on 0 ** finite-negative in both backends. Measure first
    whether `1e19**8` needs an exact integer-exponent path.
  - Where: `semantics/math.ts` + `numeric.cases.ts`, `ir/faults.ts` (`exptDomain`), `runtime/numeric.ts` `iec_expt`, `emit/rust/builtins.ts`.
  - Accept: F(the seven diverging `tr_46_exptdom_*`); `_nan_pow_zero` and `_zero_pow_minus_inf` stay confirmed; `op_math_expt` and
    `expt_mixed_width` edge ULP agreement; twin test.
  - Depends: 1.9.4.
- [ ] 6.19 RC 47: int→REAL rounds once (the bigint rounded to 24 bits with a sticky bit).
  - Where: `semantics/convert.ts` `toReal`; the cell in `numeric.cases.ts`.
  - Accept: F(`tr_47_i2r_lint_to_real_double_round`); the edge disagreement gone.
  - Depends: 1.9.4.
- [ ] 6.20 RC 48: the vendor oracle only for discriminating recordings.
  - What: rate all-default recordings `compiles` (exempting `prim_default_*`), or give the `cc_` fixtures discriminating initializers and
    re-record — choose, and write the reason here. Also closes the appendix line "UDINT op DINT fixtures run only on zeros".
  - Where: `test/conformance/support/transpile/correctness.ts`, `fixtures/batches/check-coverage.ts`.
  - Accept: M (the 158 affected rows move as chosen).
  - Depends: 1.8.4.
- [ ] 6.21 The trig vendor-routine divergences stay named (design.md §7.2).
  - What: `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` keep their expected-failure marks, each with the x87 argument-reduction
    reason in `support/divergences.ts` and a pointer to `semantics/math.ts`.
  - Where: `test/conformance/support/divergences.ts`, `semantics/math.ts`.
  - Accept: G; the three marks carry the reason; 8.2 counts them as accepted.
  - Depends: 1.9.4.

### 6.A Appendix A and B items (LOW, unverified: record first, then fix, refuse, or close with the recording as the reason)

- [ ] 6.A.1 LTIME_TO_TIME / LDT_TO_DT sub-unit truncation.
  - Where: `lower/builtins/conversions.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
- [ ] 6.A.2 REAL intermediates rounded per step (`real-overflow.ts`).
  - Where: `semantics/arith.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
- [ ] 6.A.3 MIN MOD -1 (live run; Appendix B mod-min-by-minus-one).
  - Where: `semantics/arith.ts`, `runtime/numeric.ts`.
  - Accept: recording plus F or close; the answer written here (7.3.13 reads it).
  - Depends: 1.9.4.
- [ ] 6.A.4 SHL/SHR/ROL counts through BigInt.
  - Where: `semantics/builtins.ts`.
  - Accept: a src test with a count above 2^53; S-out.
  - Depends: 1.9.4.
- [ ] 6.A.5 `x := F(o => x)`: which write wins.
  - Where: `lower/calls/outputs.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
- [ ] 6.A.6 Const-generic in-out names colliding (`<x>_<n>`).
  - Where: `emit/rust/names.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
- [ ] 6.A.8 Exact refusal codes contradicting their prefix families.
  - Where: `lower/diagnostics/codes.ts`.
  - Accept: `codes.test.ts` asserts each code's kind agrees with its prefix or carries a written reason.
  - Depends: 1.2.2.
- [ ] 6.A.9 `constantValue` swallows non-LoweringBug throws.
  - Where: `semantics/fold.ts`.
  - Accept: a src test; S-out.
  - Depends: 1.3.3.
- [ ] 6.A.10 STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5'.
  - Where: `semantics/parse.ts`, `runtime/parse.ts`.
  - Accept: recording plus F; twin cells.
  - Depends: 3.5.
- [ ] 6.A.11 `overridesCalled` resolves SUPER^.M() against the frame.
  - Where: `lower/core/ast-walk.ts`, `calls/super.ts`.
  - Accept: a src test plus F.
  - Depends: 1.9.4.
- [ ] 6.A.12 A bare METHOD call with an unconnected VAR_OUTPUT in an FB body.
  - Where: `lower/calls/invoke.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
- [ ] 6.A.13 The stale `calledLayout` doc about VAR_TEMP.
  - Where: `lower/calls/routines.ts`.
  - Accept: doc fixed.
  - Depends: 1.6.18.
- [ ] 6.A.14 SHL/SHR of an untyped literal into a 64-bit destination.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
- [ ] 6.A.15 A huge repeat count builds every leaf before the size check.
  - Where: `lower/init/initial-values.ts`.
  - Accept: a src test (check first); S-out.
  - Depends: 1.9.4.
- [ ] 6.A.16 An X address bit index above 7.
  - Where: `lower/storage/addresses.ts`.
  - Accept: recording plus refusal.
  - Depends: 1.9.4.
- [ ] 6.A.17 GVL1.x / GVL2.x sharing one slot.
  - Where: `lower/places/globals.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
- [ ] 6.A.18 Uniform write guards.
  - What: every store applies the full `guardWrite` set, removing the per-site lists of 1.7.5; the differences recorded first.
  - Where: `lower/places/access-guards.ts`.
  - Accept: a src test per store kind; M.
  - Depends: 1.7.5, 1.9.4.
- [ ] 6.A.19 An FB body call stores its inputs before binding its in-outs.
  - Where: `lower/calls/fb-call.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
- [ ] 6.A.20 The const fold accepts `**`, `&` and REAL MOD.
  - What: remove them; `const/fold.test.ts` drops the `**` case (its premise is contradicted by the input contract).
  - Where: `types/const/fold.ts`.
  - Accept: G+LSP (or verified closed by frontend-conformance).
  - Depends: 1.9.4.
- [ ] 6.A.21 REAL_MAX_MAGNITUDE below f32::MAX, and the second constant in infer.
  - Where: `types/elementary.ts`, `types/infer/*`.
  - Accept: G+LSP; one constant.
  - Depends: 1.9.4.
- [ ] 6.A.22 Inferred STRING(N)/ARRAY[1..N] folded in project scope.
  - Where: `types/infer/expr.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.23 A negated or parenthesised real literal in SIN/SQRT infers UNKNOWN.
  - Where: `types/infer/expr.ts`, `types/literal.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.24 Member access does not walk EXTENDS.
  - Where: `types/infer/member.ts` on `lookupMember` / `extendsChain`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.25 Subrange bounds dropped.
  - Where: `types/resolve.ts`.
  - Accept: recording (`a : INT(3..9)`), then refuse the subrange by name or model it; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.A.26 Qualified `Lib.T` resolved by its bare name.
  - Where: `types/resolve.ts` (qualifiers).
  - Accept: G+LSP.
  - Depends: 6.5.
- [ ] 6.A.27 Unsigned counter with a negative constant step.
  - Where: `lower/statements/loops.ts`.
  - Accept: absorbed by 2.4; closed with a reference to it.
  - Depends: 2.4.
- [ ] 6.A.28 An unbound FB VAR_IN_OUT from a METHOD panics with the "interface" message.
  - Where: `ir/faults.ts` (its own kind), `lower/calls/last-binding.ts`, both backends.
  - Accept: a src test; both backends print the new message.
  - Depends: 1.2.4, 1.9.4.
- [ ] 6.A.29 A named DINT/LINT constant folds unbounded in an initializer but wraps at run time (`types/const/fold.ts`, Appendix A grouped).
  - What: record the case (a CONSTANT whose initializer overflows its declared width, used in another initializer and read at run time);
    fold it at its declared width in the initializer too, or close with the recording.
  - Where: `types/const/fold.ts`, `lower/values/fold.ts`.
  - Accept: recording plus F or close; G+LSP.
  - Depends: 6.1.
- [ ] 6.A.30 Appendix B rotate-in-promoted-width (an ANY-argument ordering bug, no recording).
  - What: record a live case (ROL/ROR with an ANY argument whose evaluation order matters); fix or close with the recording.
  - Where: `lower/builtins/value-functions.ts`, `semantics/builtins.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.

- [ ] 6.A.31 The AST fold sizes no STRUCT, FB instance, ARRAY or packed DUT (SIZEOF); the IR fold does.
  - What: found by the fold-agreement test (1.8.9): 24 SIZEOF expressions the front-end calls constant fold to nothing in
    `types/const/fold.constEval` and to the recorded size in `semantics/fold.constantValue` (lowering's layout model,
    `lower/storage/layout.ts`, `builtins/sizeof.ts`). The LSP then skips a check that needs the value (an array bound or a
    CASE label written as a SIZEOF). Give the front-end the layout facts it needs (the layout model's home, P1), or keep
    the AST fold silent with a written reason; either way each `KNOWN` entry in `fold-agreement.test.ts` goes.
  - Where: `types/const/fold.ts`, `types/infer/expr.ts` (`sizeofOperandBytes`), `lower/storage/layout.ts`.
  - Accept: the 24 marks removed (the test fails on a stale one); G+LSP.
  - Depends: 1.9.4.

(6.A.7, runtime helpers colliding with a user FUNCTION, needs the registry of 7.1.2 and is task 7.1.5.)

### 6.B Leftovers of the neutral consolidations (every parameter phase 1 kept has a removal task)

- [ ] 6.B.1 BIT-is-BOOL: the sites 1.1.5 did not switch.
  - What: each listed site uses `isBoolValued`, or keeps its own test with a written reason; RC 31's emitter site is 6.9.
  - Where: the sites listed under 1.1.5.
  - Accept: S-out; a grep finds no hand-written BIT/BOOL test outside `types/predicates.ts` without a reason.
  - Depends: 6.9.
- [ ] 6.B.2 The integer wrap: remove the per-caller family guards 1.1.6 listed.
  - What: `wrapToWidth` callers go through one `storeInteger(value, type)` rule, or keep a guard with a written reason.
  - Where: `types/width.ts`, `types/const/fold.ts`, `lower/values/convert.ts`, `semantics/store.ts`.
  - Accept: S-out; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.B.3 EXTENDS: remove the documented parameters 1.7.3 listed.
  - What: each site uses the default chain, or the parameter stays with the recorded fixture that needs it.
  - Where: `lower/core/chain.ts` and its callers.
  - Accept: S-out.
  - Depends: 1.9.4.
- [ ] 6.B.4 Lowering's parameter view delegates to `types/infer/callee`.
  - What: for every difference 1.7.18 wrote down, either the two agree (lowering delegates) or the difference is a recorded CODESYS fact
    and stays with its reason.
  - Where: `lower/calls/parameters.ts`, `types/infer/callee.ts`.
  - Accept: S-out; G+LSP; the differential test of 1.7.18 reports only reasoned differences.
  - Depends: 1.9.4.
- [ ] 6.B.5 Lowering's NOT, duration-scaling and platform-conversion rules read the front-end (hand-off H4, split from 1.1.8
  and 1.1.10: not output-neutral).
  - What: `NOT` of a signed integer (`lower/values` / today `lower/expressions/operators.ts`) types as `types/arith/operators`
    `notResultType` — the unsigned INTEGER of the width (`NOT sint` USINT, recorded `uop_not_*`) where lowering stamps the bit
    string (BYTE): the same value, a different IR type (S's `ir` layer moves; S-out must not). Duration × / ÷ integer (today
    `lower/expressions/operators.ts`) converts through `types/arith/temporal` `durationScaleConversion`: a 64-bit integer beside a
    TIME is the INTEGER there (AR18) where lowering converts it to TIME — a value change, so its fixtures are named first and
    recorded if missing (with 6.14). The platform conversion rewrite (today `lower/builtins/builtins.ts`: `__U?X…_TO_` replaced
    through `PLATFORM_ALIASES`, then `parseConversionName(…, undefined)`) becomes `parseConversionName(name, targetOf(project))`:
    measured by 1.1.10, that also reads the platform side on the RIGHT (`DINT_TO___UXINT`), so `ty_dint_to_uxint` starts
    lowering and `ty_xint_to_dint_result_type`'s refusal moves from `expr-call` to `assign-string` — both rate today as
    not-lowered/refused, so the change is decided against their recordings, not taken as a structure move. The constant
    folder (`lower/values/fold.ts` `convertedConstant`, `isConstantCallee`, today `undefined`) switches in the SAME step as the
    body, so an initializer and a body never answer differently (gate 1.0-1.2; `lower/values/fold.test.ts` pins today's refusal and
    is rewritten with the recorded answer — a TY11 conversion in a VAR initializer is recorded first).
  - Where: `lower/expressions/operators.ts`, `lower/builtins/conversions.ts` (after 1.6.14, 1.6.15), `lower/values/fold.ts`, `types/arith/*`.
  - Accept: S-out for NOT; for duration scaling and the platform names F(each fixture whose answer changes) or the recording
    that shows none does; G+LSP.
  - Depends: 1.9.4, 6.14.
- [ ] 6.B.6 The three rule-4b edges the design placed against its own rule (checkpoint review 1.9.4).
  - What: each `KNOWN_TRANSPILE_VIOLATIONS` entry reported to the gate rather than owned by a task gets a home that keeps
    the leaves acyclic, or design.md P2's rule 4b is amended for it with the reason: `core/shared.ts` reads
    `project/prepare.ts` `AttributeLookup` (§4.2's placement); `project/prepare.ts` reads `lower/conditions.ts` (§4.9 moves it into
    `project/`, which would make `calls/` import `project/`); `values/fold.ts` `foldedCall` lowers through
    `expressions/expressions.ts` (§2.4's placement). The fourth entry (`values/enums.ts` → `storage/layout.ts`) is 3.3's.
  - Where: `lower/core/shared.ts`, `lower/project/prepare.ts`, `lower/conditions.ts`, `lower/values/fold.ts`,
    `scripts/check-layering.ts` (`KNOWN_TRANSPILE_VIOLATIONS`), design.md P2.
  - Accept: G, S; the three entries gone from the list (or the rule amended in design.md and the lint together).
  - Depends: 1.9.4.

## 7. Lean groups (same program output, less Rust: every step S-out + M)

Each sub-task names its notes, deleted from the authored table when resolved. The counts come from 0.6's tags; the keyword
pre-classification gave group 1 ≈ 11 notes / 576 rows, 2 ≈ 179/5178, 3 ≈ 129/751, 4 ≈ 135/1404, 5 ≈ 38/1201, 6 ≈ 62/391, 7 ≈ 86/575,
8 ≈ 29/186, 9 ≈ 72/549.

### 7.10 Transpiler source cleanup (leftovers after 1.7)

- [ ] 7.10.1 Verify lean 10.1 (EXTENDS, holdsFbInit/reaches), 10.3 (convertValue) and 10.4 (every orphan doc named in the maps,
  incl. the old `infer` module's :258, deleted by 1.1.13) are dissolved.
  - Where: `src/transpile/**`, `src/types/**`.
  - Accept: a grep list is empty.
  - Depends: 1.9.4.
- [ ] 7.10.2 One typed const fold (lean 10.2).
  - What: `foldBigInt` and `foldNumber` merge into one width-carrying fold, sharing the identifier resolver between `constancyOf` and `fold`.
  - Where: `types/const/fold.ts`, `types/const/constancy.ts`.
  - Accept: G+LSP; S-out; `fold-agreement.test.ts` unchanged or better.
  - Depends: 6.1, 6.A.20, 6.A.29.
- [ ] 7.10.3 The `transpile/index.ts` doc carries the rule only (no numbers or taxonomy copy); `emit/rust/index.ts`'s temp list is
  generated from `names.ts` purposes.
  - Where: `transpile/index.ts`, `emit/rust/index.ts`, `names.ts`.
  - Accept: G.
  - Depends: 1.9.4.
- [ ] 7.10.4 `dead-exports.ts --scope src/transpile` (filtered, design.md §8) finds nothing.
  - Where: `src/transpile/**`.
  - Accept: G; empty list.
  - Depends: 7.10.1.

### 7.1 Prelude on demand (lean 1; dead_code 5658, uninlined_format_args 4192, format_push_string 1048, many_single_char_names 527)

- [ ] 7.1.1 The registry has real dependencies.
  - What: the IecStr core, each `iec_*_text`, `iec_parse_*` and `iec_max/min` become separate entries with `deps`.
  - Where: `emit/rust/runtime/index.ts`, `runtime/*.ts`.
  - Accept: G, S (still today's gating).
  - Depends: 1.5.11.
- [ ] 7.1.2 The printer records `use(id)`; `module.ts` appends the dependency closure; the `code.includes` sniffing (six sites) is deleted.
  - Where: `emit/rust/printer.ts`, `module.ts`, `runtime/index.ts`.
  - Accept: S-out; M (dead_code excused count falls; the target is 0 excused by runtime code).
  - Depends: 7.1.1.
- [ ] 7.1.3 ALLOWED `dead_code`: its reason narrowed to "fixture variables", its excused count recorded.
  - Where: `test/conformance/support/transpile/lint-policy.ts`.
  - Accept: M.
  - Depends: 7.1.2.
- [ ] 7.1.4 Redefine the map's `size`.
  - What: "emitted Rust lines per ST line, runtime-registry lines not counted" (design.md §8); re-baseline in this commit with the old and
    new median both written here; every later size delta uses the new definition.
  - Where: `test/conformance/support/transpile/row.ts` (size), `scripts/rate-fixtures.ts`, the map header text.
  - Accept: M (only `size` values and the header definition change; both medians recorded).
  - Depends: 7.1.2.
- [ ] 7.1.5 Runtime helpers colliding with a user FUNCTION (`iec_div`, …; Appendix A, was 6.A.7).
  - What: reserve the registry's ids in `names.ts` (a user FUNCTION named like a helper gets a suffixed fn) or namespace the helpers.
  - Where: `emit/rust/names.ts`, `runtime/index.ts`.
  - Accept: a src test with a user FUNCTION `iec_div` plus a fix; S-out.
  - Depends: 7.1.2.

### 7.9 Prelude helpers (lean 9)

- [ ] 7.9.1 `iec_r2i64/32`: `let c = v.round();`, the NaN and ≥2^63 returns merged, the redundant `is_nan()` in `contains` dropped.
  - Notes: 02a72c2e83, 693c14b0bd, b7286c7932, de283d0ef6, 0ab1e9c511, 5383e1c9ac, 6f8ef8f0bd, f44fb59407, fe6af35845, c5844eabe9.
  - Where: `emit/rust/runtime/numeric.ts`.
  - Accept: twin test on `numeric.cases.ts` (the 192 cells of 1.3.8); S-out; M.
  - Depends: 7.1.2, 1.5.15.
- [ ] 7.9.2 An `iec_trunc_i32` helper replaces the TRUNC inlined 38 times.
  - Where: `runtime/numeric.ts`, `emit/rust/builtins.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.1.2.
- [ ] 7.9.3 `iec_deref` as `assert!`/`assert_ne!` (note dd94ff18a2); one guard per statement for a single-target pointer (notes
  01ef1b756d, e496034f7b, 1fa78ccf62).
  - Where: `runtime/pointer.ts`, `emit/rust/printer.ts` guards.
  - Accept: S-out, M.
  - Depends: 7.1.2, 4.16.
- [ ] 7.9.4 `iec_*_text` write into IecStr with no String allocation (clears `uninlined_format_args`, `format_push_string` in the runtime).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: twin test on `text.cases.ts`, S-out, M.
  - Depends: 6.3, 6.10, 6.11, 3.5.
- [ ] 7.9.5 Runtime lint hygiene: `many_single_char_names`, `return_self_not_must_use`, `bool_to_int_with_if`, `must_use` on the IecStr methods.
  - Where: `emit/rust/runtime/*.ts`.
  - Accept: M (pedantic count attributed to runtime reaches 0).
  - Depends: 7.9.4.

### 7.2 Constants folded in lowering, in one place (lean 2)

- [ ] 7.2.1 Negation of a constant folds to a typed literal (lean 2.1): done by RC 7; verify and delete the remaining notes.
  - Where: `lower/expressions/operators.ts`.
  - Accept: M (notes deleted).
  - Depends: 0.6.
- [ ] 7.2.2 An all-constant integer or real expression prints as its folded literal.
  - Notes: 63d29bd1a0, 57a8f5a4c8, 09eeda28bb, 24588decbd, 58988cbee9.
  - Where: `lower/values/fold.ts` via `semantics/fold`; `expressions/operators.ts`.
  - Accept: S-out, M.
  - Depends: 6.2.
- [ ] 7.2.3 A constant array index prints as a usize literal, the lower bound subtracted at lowering; the index offset printed one way.
  - Notes: 3d737b5821, 7886e7bd17, 03b3e8b80c, 2506fd8442, 4e213fd264, 6a2b5f2826, eb533b340b; 5dcbae07c6, 7918d10820, d8a5dd49a9.
  - Where: `lower/places/places.ts`, `emit/rust/place.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.4 Constant ADR tags and constant cursor or pointer offsets fold.
  - Notes: 41d2232599, 0c7c4434c4.
  - Where: `lower/pointers/address.ts`, `pointers/cursor.ts`.
  - Accept: S-out, M.
  - Depends: 4.16, 7.2.2.
- [ ] 7.2.5 A constant shift or rotate count prints bare; partial access skips `>> 0` (lean 2.4).
  - Notes: 346e81a0f2, 5228723708, de956f2a12, fdfbae2680.
  - Where: `lower/builtins/value-functions.ts`, `expressions/partial-access.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.6 MOD and real `/` by a nonzero constant other than -1 print plain `%` and `/` (lean 2.5), decided in lowering (an IR flag
  "divisor proven nonzero").
  - Also: the whole-days truncation `count - count MOD day` lowers as `count / day * day` (one read of `count`; review item
    shapes10_2, owned here by 0b).
  - Notes: 015dcb3b7f, 054b93382f, c7f76e08cf, 61a75e7b4b, 32a9e6d2e3, 49387a9ebf, 7812f5a53d.
  - Where: `lower/expressions/operators.ts`, `ir/expr.ts`, `emit/rust/expr.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.7 Fold MAX, MIN, LIMIT, SEL and MUX of all-constant arguments, and TRUNC of a constant; literal arms typed at the result type (lean 2.6).
  - Notes: 7402369985, 779b38c9e9, 8cd84736a1, 96b55e688b, ef06033fe1.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M (`unnecessary_min_or_max` falls).
  - Depends: 6.15, 6.7.
- [ ] 7.2.8 No literal suffix at typed positions (field initializers, `Self {}`).
  - Notes: 1707972c33, 06bb3a6005, e8954e2b0d, 90c445f7cb, 870b70e195, afa5d14dd9, a29db6178b.
  - Where: `emit/rust/values.ts`, `structs.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.9 Negative-literal parentheses only at receiver positions.
  - Notes: 65df8e0418, ec9a760059, b501abe431, 159ca60812, 12e93440b3, c35f240db9, 6f9ae8fd3a, 5c40a4e5a8, 682fffc71e.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.10 A constant cast prints as a typed literal (`castTo` of a const).
  - Notes: 14a38342eb, 9d8cd15435, 9fb47c3123.
  - Where: `emit/rust/convert.ts`, `values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.11 Digit separators for large literals (`unreadable_literal` 3681 minus the loop-cap share).
  - Notes: 4bf3f61062, 093ad5cc7a.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 2.3.
- [ ] 7.2.12 An f32 literal printed from its rounded value.
  - Notes: 74845f98c6.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.2.13 Remove the `keep` items of the notes attached to group-2 constructs (1307e33bbf, 6a98109119, a497507b30, 1d7709a031,
  4a6baf16b3, 687428cc81, 496b8acb56, as tagged in 0.6): a note whose every item is `keep` is deleted; the items another task owns
  stay under it (1307e33bbf 7.3.5, 1d7709a031 7.2.5 + 7.3.1, a497507b30 7.2.5, 4a6baf16b3 7.2.2, 496b8acb56 7.6.6 — owned since 0b).
  - Where: `support/notes/notes.data.ts`.
  - Accept: M (no `keep` item left in these notes; 7.11.1's count falls by the notes that held only `keep`).
  - Depends: 0.6.
- [ ] 7.2.14 A runtime array index without the `(i as i64) as usize` hop.
  - What: the index is converted once from its own type to `usize` after the lower-bound subtraction in its own width, where the value
    range allows it (lowering decides; the interpreter unchanged).
  - Notes: the 7 runtime-index notes tagged here by 0.6.
  - Where: `lower/places/places.ts`, `emit/rust/place.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.3.

### 7.3 One emission per construct: narrow arithmetic and precedence (lean 3; cast_possible_truncation 5666, cast_sign_loss 4361, cast_lossless 4359)

- [ ] 7.3.1 The narrow-arithmetic rule in lowering.
  - What: add, sub, mul, neg, and, or, xor, min and max on T-typed operands stored straight back into T are lowered as a narrow T node
    (value-identical: truncation is a ring homomorphism); the interpreter runs the same node. DIV/MOD, mixed-sign meets, shifts and wider
    stores stay promoted (lean 3.5).
  - Notes: 0153115496, 4979768984, 4c9f4e33f4, 964296462a, 7ef1346b85, c9cd63632c, e6ef5a4585, 7c881bc819, 41d2269c05, 8ccaa880cd,
    2ea589a8a1, 4fb4aff790, 6713eb5cc0, 6b14b17ba7, 8d8ff2c804.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out; the edge differential identical over every arith fixture; M.
  - Depends: 7.2.2, 1.9.4.
- [ ] 7.3.2 The FOR step and the body statement print the same construct one way.
  - Notes: 4979768984, 46c17ef7d3.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1, 2.4.
- [ ] 7.3.3 Same-typed comparisons (or a literal that fits) compare in the operands' own type.
  - Notes: beb0779c8f.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.4 ABS of an unsigned operand is the identity.
  - Notes: 6a41bda0a0.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.5 A lossless widening prints `T::from(x)`; `as` only for truncating or reinterpreting casts.
  - Notes: 181d22eae0, 3aa4ff5b30, 638ea949bb, 8b69355dc1, 76275cc107.
  - Where: `emit/rust/convert.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.6 REAL SQRT in f32 (proven identical).
  - Notes: c2d750a62a, 428230e030.
  - Where: `emit/rust/builtins.ts`.
  - Accept: twin cells plus S-out.
  - Depends: 1.9.4.
- [ ] 7.3.7 REAL MAX/MIN with an untyped real literal needs no f64 round-trip.
  - Notes: 5c9bb13706.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M.
  - Depends: 6.7.
- [ ] 7.3.8 A precedence-aware printer: delete `unparen`/`unparenHead` and the literal-paren special case.
  - Notes: b7bf67b59d, c8ac3c10c1, f474d0ca12.
  - Where: `emit/rust/expr.ts`, new `emit/rust/precedence.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.3.9 Cast-chain simplification (u16→i32→u16).
  - Notes: e9a5cabd36.
  - Where: `lower/values/convert.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.10 TIME/DATE→LTIME widening multiplies without wrapping.
  - Notes: 6b4f1bb990, c2729b1a2a.
  - Where: `lower/builtins/conversions.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.11 Keep promotion where it is needed: guard tests pin DIV (MIN/-1 measured), mixed sign, shifts and wider stores as promoted.
  - Where: `lower/values/promote.test.ts`.
  - Accept: G.
  - Depends: 7.3.1.
- [ ] 7.3.12 REAL math other than SQRT in f32, where proven.
  - What: for each of EXP, LN, LOG, SIN, COS, TAN, ASIN, ACOS, ATAN on REAL, measure over the recorded cells and the edge inputs whether
    the f32 function gives the value the f64 round-trip gives; switch only those proven identical, and tag the rest `keep:<measured
    difference>`.
  - Notes: the 5 "`(x as f64).exp() as f32`" notes tagged here by 0.6.
  - Where: `emit/rust/builtins.ts`, `numeric.cases.ts`.
  - Accept: twin cells per switched function; S-out; M.
  - Depends: 7.3.6.
- [ ] 7.3.13 MOD on narrow types.
  - What: from 6.A.3's recording: if CODESYS's MIN MOD -1 is 0 and nothing else overflows, MOD joins the narrow rule; otherwise the notes
    are tagged `keep:<6.A.3's answer>`.
  - Notes: the narrow-MOD notes tagged here by 0.6.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out; M.
  - Depends: 7.3.1, 6.A.3.

### 7.5 Loop shape (lean 5, on model 1)

- [ ] 7.5.1 The counter lines are gone with the cap.
  - Notes: 02b031c773, 5ba97e5557, d9d57311e3, 6bf6856d37.
  - Where: `emit/rust/loops.ts`.
  - Accept: M (notes deleted, verified).
  - Depends: 2.3.
- [ ] 7.5.2 Labels and body blocks from `ir/walk.loopUses`: drop the body block without CONTINUE and the label without a labelled EXIT.
  - Notes: 521ba042ac, 1ad1ab3163, 93a17fab28, 204a887600.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.8.
- [ ] 7.5.3 WHILE uses `continue 'loop`.
  - Notes: 95094bd48a.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.5.2.
- [ ] 7.5.4 `while cond {}` and `for`-style forms where 2.1's type-max measurement allows them.
  - Notes: 1d1551a034, de2f16610e, 50226e2c19, e798927653.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.5.2, 2.1.
- [ ] 7.5.5 ELSIF prints as `else if` (collapsible_else_if 19).
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.5.6 `&&`/`||` when neither operand holds a call (lowering marks it in the IR).
  - Notes: 5e5aa25221, b2d33739c5, a54ead1fbe, ec21aafede.
  - Where: `lower/expressions/operators.ts`, `emit/rust/expr.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.5.7 De Morgan negation of loop and IF tests.
  - Notes: 1d1551a034, 50226e2c19, b736e18f55, de2f16610e, e798927653, e8a1222ae6, ed880b92a8.
  - Where: `emit/rust/expr.ts` `negated`.
  - Accept: S-out, M.
  - Depends: 7.5.4.
- [ ] 7.5.8 Omit `if false { break; }` for WHILE TRUE / UNTIL FALSE.
  - Notes: 235daf8f29.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M (`never_loop` re-checked in 7.11.3).
  - Depends: 7.5.2.
- [ ] 7.5.9 A runtime FOR step evaluated once per pass (or hoisted), only as 2.1's `for_runtime_step_changed_in_body` allows.
  - Notes: 129bb34a7e, 547ea4e920.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.1, 2.4.
- [ ] 7.5.10 A negative constant step prints as `wrapping_sub`.
  - Notes: 5351b3711d.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.4.
- [ ] 7.5.11 Statements after an unconditional RETURN/EXIT are not printed; `ir/walk.exitsAfter` also sees EXIT/CONTINUE and all-return
  IFs (appendix); ALLOWED `unreachable_code`'s reason re-checked.
  - Notes: 0e0d715a81.
  - Where: `ir/walk.ts`, `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 1.7.4.
- [ ] 7.5.12 `clippy::collapsible_if` (4): nested IFs the printer produces are collapsed where the IR has no else and no statement between.
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out; M (surviving `collapsible_if` 0).
  - Depends: 7.5.5.

### 7.4 String copies (lean 4, on model 2)

- [ ] 7.4.1 `.to()` only when the capacity differs or the target is generic.
  - Notes: 5d9850550d, 8e30e6691c, ec1b55e90b, 4c088ca52b, 8883cf3a18, c90fc459e6, d3fdc1ed97, 0464b7d671, e8210b694c.
  - Where: `emit/rust/stmt.ts` (assign).
  - Accept: S-out, M.
  - Depends: 3.12.
- [ ] 7.4.2 Literals and conversion results built at the target capacity, no `.to::<N>().to()`.
  - Notes: 803ee89d4f, 4eeb332195, 7030300a1b, 90e7185468, 7587dbd531, 54e36b572f, c689147e80.
  - Where: `lower/values/literals.ts`, `builtins/conversions.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.3 An in-place `set_char` for `s[i] := c`.
  - Notes: 234c4da721, 7566f32b5e, f0973f1bcc, c05be29130, 318cfd770d, 0205cf3af0.
  - Where: `runtime/string.ts`, `emit/rust/stmt.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.4 A cursor read borrows, with one guard per statement.
  - Notes: 211808ca56, 5c499dbdc8, e6075a580f, 4fb82cd93a.
  - Where: `emit/rust/place.ts`, `lower/pointers/cursor.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1, 7.9.3.
- [ ] 7.4.5 Cursor and ANY variants keyed by width, not capacity (lean 4.5).
  - Where: `lower/calls/variants.ts`.
  - Accept: S-out; M (fewer duplicate fns).
  - Depends: 6.16.
- [ ] 7.4.6 Read-only Standard string inputs by `&IecStr<N>`, and a LEN_INTERNAL primitive (`units().len()`).
  - Notes: 185a887a57, 7a85af3c04, cbcde0e5de, dea089f2fd, 21ef64a1e0, 811c8ccd59, 3cacc7bfac, 9c8d21e237, 83ed1aab47, b592939dbf, c001fbb3b1.
  - Where: `lower/calls/binding.ts`, `libraries/Standard/*`.
  - Accept: S-out; `test/libraries` green; M.
  - Depends: 7.4.1.
- [ ] 7.4.7 An empty-string initializer prints `new()`.
  - Notes: e6646a0bd0.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.8 A WSTRING literal built at its target capacity from a `&[u16]` const.
  - Notes: 23d12708e2.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.2.
- [ ] 7.4.9 A string compared with a literal compares against the literal's bytes, not a built IecStr.
  - What: the runtime gains `eq_bytes(&[u8])`/`cmp_bytes`, mirrored in `semantics/string.ts` and `semantics/string.cases.ts`.
  - Notes: the string-literal-compare notes tagged here by 0.6.
  - Where: `runtime/string.ts`, `emit/rust/expr.ts`, `semantics/string.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.4.1.

### 7.6 Temporaries as locals (lean 6, on model 3; pub_underscore_fields 58)

- [ ] 7.6.1 `core/temps.ts` produces a statement-scoped local in body mode (chain, property, output, inout_guard and inout_index temps).
  - Notes: de132e5019, 73505351ad, 4edbb4135a, 707233d6d6, e7e871371f, 40fd7317bb, 42897347c4, 7a88c529f6, c7af448b33, 915417cef0.
  - Where: `lower/core/temps.ts`, `emit/rust/printer.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.6.2 A property-setter value passed directly when it holds no invoke on the same instance.
  - Notes: 48737e1389, 377c1dfc31, 4d8c0c87ee, 782a04d94c.
  - Where: `lower/calls/property.ts`, `interfaces/dispatch.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1.
- [ ] 7.6.3 An unbound VAR_OUTPUT goes to a local.
  - Notes: 53bd7d992e, 0878222ac3, 0b358286cb.
  - Where: `lower/calls/outputs.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1, 4.11.
- [ ] 7.6.4 VAR_TEMP as Rust locals; measure first which fixtures' recorded paths name a VAR_TEMP (those keep observable storage).
  - Where: `lower/storage/layout.ts` (`INSTANCE_STORAGE`), `init/temp-resets.ts`.
  - Accept: S-out, M.
  - Depends: 5.5, 7.6.1.
- [ ] 7.6.5 A scalar VAR_IN_OUT CONSTANT argument (or a literal bound to one) is passed by value, not copied into `let __copy_N`.
  - Notes: the `__copy_N` notes tagged here by 0.6.
  - Where: `lower/calls/binding.ts`, `emit/rust/calls.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1.
- [ ] 7.6.6 Argument hoisting only when needed.
  - What: no `let __arg_N` for a single input or for a pure argument; only the arguments that must be evaluated before a call-holding
    sibling are hoisted; SEL binds only what 6.15's contract needs.
  - Notes: the `__arg_N` / SEL-lets notes tagged here by 0.6.
  - Where: `lower/calls/invoke.ts`, `emit/rust/calls.ts`.
  - Accept: S-out (edge identical over every call-order fixture), M.
  - Depends: 7.6.1, 6.15.

### 7.7 Routine signatures (lean 7, on model 4)

- [ ] 7.7.1 `mut` only on parameters the body stores to.
  - Notes: 8a9bb48ddb, 1ca8b1b1fc, 0ab2575555, 7ab9128afd, a01f00db76, abc8bc67de, 49346d6299, 00fc50d055.
  - Where: `lower/calls/facts.ts` (a written set), `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 5.10.
- [ ] 7.7.2 Drop the blanket `#[allow(unused_mut, unused_variables, unused_assignments)]`; `init()` gets an allow only with parameters.
  - Notes: fa7d5f176f, dbcd1088a5, 3cf4e6fa21, f5ca982c14, c8ca44a755, 0ca9dad97d.
  - Where: `emit/rust/routine.ts`, `module.ts`.
  - Accept: M (no new surviving lint).
  - Depends: 7.7.1.
- [ ] 7.7.3 Return the result expression directly when assigned once at the end; skip the VAR_OUTPUT reset at entry when the body assigns it first.
  - Notes: 11f6ad8ec5, 96a5b25b66, 0969e59592, 5370b79269, 8088e0ab18, a573b540d2, 6dd22a92d0, a5c4faeebd, fda03fa84f, 14b2f39d44.
  - Where: `lower/calls/routines.ts`, `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.1.
- [ ] 7.7.4 `new()` as `const fn` where possible, marked `#[must_use]` (must_use_candidate, missing_const_for_fn).
  - Where: `emit/rust/structs.ts`.
  - Accept: M.
  - Depends: 5.10.
- [ ] 7.7.5 `g` and `prg` passed only to routines that reach them, with one params builder (the differing renderings 1.5.3 listed).
  - Notes: b9787e0d18, 1524fb865f, f62e4d99a5, ab696e2449, 37745ed7a0, 85168be6a7, 30d5674ec4.
  - Where: `lower/calls/reentrancy.ts` (the reach set), `emit/rust/names.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.2.
- [ ] 7.7.6 No `std::mem::take` when the callee does not reach Programs.
  - Notes: abf2bb6e4e, 58a7e6289b.
  - Where: `emit/rust/calls.ts` `moveOutProgram`.
  - Accept: S-out, M.
  - Depends: 7.7.5.
- [ ] 7.7.7 Drop the dead form-2 value parameter (was calls.ts:1145-1146).
  - Where: `lower/pointers/borrowed.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.7.8 ARRAY[*] upper bounds derived from `len()`, not passed.
  - Where: `lower/storage/declare.ts`, `calls/fb-call.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.1.
- [ ] 7.7.9 A constant ANY diSize folds into its variant; dead arms pruned.
  - Where: `lower/pointers/any.ts`.
  - Accept: S-out, M.
  - Depends: 4.9.
- [ ] 7.7.10 Delete the "call itself is correct" note fb7e9e6ff4 (tagged `keep`).
  - Where: `support/notes/notes.data.ts`.
  - Accept: M (7.11.1's count falls by one).
  - Depends: 0.6.
- [ ] 7.7.11 No unused generic routine beside its per-target specializations (`ptrparam_method`).
  - What: a generic routine every call site replaced by a specialization is not emitted.
  - Notes: the `ptrparam_method` note(s) tagged here by 0.6.
  - Where: `lower/calls/specialize.ts`, `emit/rust/module.ts`.
  - Accept: S-out; M (dead_code falls).
  - Depends: 7.1.2.
- [ ] 7.7.12 `clippy::too_many_arguments` (2; StringUtils' pointer+string parameter pairs).
  - What: after 7.4.6 and 7.7.8 re-count; if still present, either the pair collapses into one parameter (a cursor carrying its capacity)
    or the lint joins ALLOWED with that reason.
  - Where: `lower/pointers/cursor.ts`, `emit/rust/routine.ts`, or `support/transpile/lint-policy.ts`.
  - Accept: M (surviving `too_many_arguments` 0, or ALLOWED with a reason).
  - Depends: 7.4.6, 7.7.8.
- [ ] 7.7.13 `must_use_candidate` beyond `new()` and `missing_panics_doc`.
  - What: `#[must_use]` on every emitted fn that returns a value and writes nothing observable (from `calls/facts.ts`); for
    `missing_panics_doc`, a `/// # Panics` line on each fn that can reach a fault (from `ir/faults` kinds the body holds), or ALLOWED with
    a reason if the doc lines cost more than they tell — measured on the map and decided here.
  - Where: `emit/rust/routine.ts`, `lower/calls/facts.ts`, `support/transpile/lint-policy.ts`.
  - Accept: M (both counts fall to 0 or are ALLOWED with the recorded reason).
  - Depends: 7.7.4.

### 7.8 Derives and aggregate syntax (lean 8, on model 4)

- [ ] 7.8.1 `isCopy` drives the derives: derive `Eq`, and `Copy` for all-Copy structs; drop `.clone()` on Copy stores
  (derive_partial_eq_without_eq 1473).
  - Notes: ac452bc801.
  - Where: `emit/rust/types.ts`, `structs.ts`.
  - Accept: S-out, M.
  - Depends: 5.10.
- [ ] 7.8.2 A repeat expression for Copy arrays, nested included; `from_fn` only for non-Copy.
  - Notes: 00c356c11c, a65506e4d8, c9c77500c6, f9bdd4950a, 1f2f8205f9, 683d4b1944, 4026548939.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.8.1.
- [ ] 7.8.3 Struct-update syntax for aggregate initializers; `[d; N]` plus stores for a partial initializer.
  - Notes: 055df7e5f8, d5d625ee73, 8b9a7c5eea.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.8.2.
- [ ] 7.8.4 Unions via `to_le_bytes`/`from_le_bytes`, on the IR reinterpret node from 4.3, or adding it with its interpreter twin if 4.2
  chose no arena.
  - Where: `lower/storage/unions.ts`, `ir/expr.ts`, `semantics/`, `emit/rust/`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.8.5 A constant bit store prints as `|=` / `&= !`.
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.8.6 Remove the `(*x)` and `&mut (*x)` deref noise.
  - Notes: 98ba0d2e70, 0d14fd327c, 3d7b4a7836, 0b51d542e8, 7e45a342fc, 8064ae1570, ca81b2092d, 28af8caf65, 29dc1a9c14, 01e84968c3, 52d85b7cdc, f0065dbd0b.
  - Where: `emit/rust/place.ts`, `printer.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.8.7 No parentheses around a statement-level `match` (unnecessary_semicolon 9).
  - Notes: 0cbdff077d, 59c341cb0f, 82e802ebc9, 26bfea40dc, 4b5007906a, 5ed54bb657.
  - Where: `emit/rust/calls.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.8.
- [ ] 7.8.8 A pointer initializer `ADR(x)` is a constant in `new()`, not a separate init store.
  - Also: a REFERENCE bound at its declaration (`REF=`) to a variable of the same instance gets its constant tag in `new()`, so
    its `init()`/`__init()` chain goes (review item shapes6_2, owned here by 0b).
  - Notes: ad25627749, fbde4d6e1e.
  - Where: `lower/init/initial-values.ts`.
  - Accept: S-out, M.
  - Depends: 5.10, 4.16.
- [ ] 7.8.9 `x := x` stays ALLOWED `self_assignment`: note ea53989ac8's text becomes that ALLOWED entry's reason; the note stays tagged
  `keep` and is deleted by 7.11.1.
  - Where: `support/transpile/lint-policy.ts`, `support/notes/notes.data.ts`.
  - Accept: M (the reason carries the text).
  - Depends: 0.6.
- [ ] 7.8.10 The reserved-prefix rule is structural: the unprefixed `t` (TRUNC), `program` and `v` use `tmp()`; the program move-out is
  one spelling.
  - Where: `emit/rust/names.ts`, `builtins.ts`, `calls.ts`, `values.ts`.
  - Accept: S-out; the collision test in `names.test.ts` asserts every generated binding is `__`-prefixed.
  - Depends: 1.9.4.
- [ ] 7.8.11 No hand-written `impl Default` beside `new()` (clippy `new_without_default`).
  - What: every struct today gets `pub fn new()` plus a five-line `impl Default { fn default() -> Self { Self::new() } }`; it gets
    `new()` and `#[allow(clippy::new_without_default)]` instead (the reviewer's choice: one uniform shape), unless 7.8.1's derives
    make `#[derive(Default)]` exact (every initializer its type's zero, no array beyond 32 elements) — measured, not assumed.
  - Notes: 870b70e195 (item 2, review item shapes6_4: it rode under 7.2.8 with no task of its own until 0b).
  - Where: `emit/rust/structs.ts`.
  - Accept: S-out, M (`new_without_default` stays 0; the emitted size falls).
  - Depends: 7.8.1.

### 7.11 Notes and lint-policy hygiene

- [ ] 7.11.1 Remove the remaining `keep` items (a note goes with its last item), after 7.8.9 moved ea53989ac8's text.
  - Where: `support/notes/notes.data.ts`.
  - Accept: M; no `keep` item left.
  - Depends: 0.6, 7.2.13, 7.7.10, 7.8.9.
- [ ] 7.11.2 Every note item owned by a finished task is removed (a note goes with its last item).
  - What: gated since 0b — `assertNotes` (run by `rate:fixtures` and `map.test.ts`) refuses an item whose owner is ticked, so
    each task removes its own items in the commit that ticks it; this task verifies none is left.
  - Where: `support/notes/notes.data.ts`, `scripts/rate-fixtures.ts`.
  - Accept: the generator reports 0 note items owned by a ticked task.
  - Depends: all of 7.
- [ ] 7.11.3 Re-check every ALLOWED lint after the models.
  - What: eq_op (17), unnecessary_min_or_max (10), approx_constant (6), manual_clamp (2; RC 28/41), absurd_extreme_comparisons,
    manual_range_patterns, never_loop (model 1), unused_comparisons, dead_code, self_assignment, unreachable_code: each entry's excused
    count is re-measured; an entry at 0 is removed; the others get their reason re-written against today's cause.
  - Where: `test/conformance/support/transpile/lint-policy.ts`.
  - Accept: M; every ALLOWED entry has a current count and a reason written after 5.10.
  - Depends: 7.1.3, 7.2.7, 7.5.11.
- [ ] 7.11.4 Notes placed by 0.6 in tasks created for them are resolved or tagged `keep:<reason>`.
  - Where: `support/notes/notes.data.ts`.
  - Accept: the per-task note count lists no note under an open task at the end of phase 7.
  - Depends: all of 7.

## 8. Close

- [ ] 8.1 Docs.
  - What: architecture.md describes the four models as decided, the `semantics/` layer, the ownership rows and the refused lists;
    data-model.md describes the IR and the Type facts as they are; the package README and `scripts/README.md` updated.
  - Where: `docs/architecture.md`, `docs/data-model.md`, `README.md`, `scripts/README.md`.
  - Accept: `check-citations` reports 0.
  - Depends: 2.10, 3.12, 4.16, 5.10, 7.11.4.
- [ ] 8.2 Final map delta against 0.2.
  - What: edge, size median and top ten (under the 7.1.4 definition, with the 0.2 value re-computed under it), pedantic, lint totals,
    ALLOWED excused counts, notes remaining, open divergence marks. The target: only the refusals the model decisions name and the trig
    family of design.md §7.2.
  - Where: this file.
  - Accept: M; every open mark is in one of those two lists.
  - Depends: 8.1.
- [ ] 8.3 Final review.
  - What: spec, layering and a fresh-implementation review over the whole change; fix or file.
  - Where: all touched files.
  - Accept: lint (layering, size, citations) green; the size ceiling list for `src/transpile/**` empty.
  - Depends: 8.2.
- [ ] 8.4 Archive.
  - What: check each spec delta describes what was built; every hand-off of design.md §7.1 has a line in `lsp-transpile-review-gaps`;
    every transpile-st-to-rust task 0.8/4.2 marked superseded is ticked there with its reference. Archive this change and
    `transpile-lean-candidates` (unapplied, superseded), and `transpile-review-2026-09-29` if every RC is closed (else list the open
    ones here). Delete the re-created `openspec/specs/`.
  - Where: `openspec/changes/`.
  - Accept: `openspec list` shows neither this change nor transpile-lean-candidates; no `openspec/specs/`.
  - Depends: 8.3.

## Hand-off from transpile-st-to-rust (2026-10-03)

`transpile-st-to-rust` closed with 82 of 121 tasks done and is archived at
`openspec/changes/archive/2026-10-03-transpile-st-to-rust/` (its proposal's "Close-out" holds the full 39-row mapping;
its `pointer-model.md` and `memory-sketch.rs`, which design.md §3.3 and task 4.1 start from, moved there with it).
These are notes, not tasks: the task list and plan above are unchanged.

**Task 0.8 is done by this hand-off** — every open line there carries a verdict. Because that change is archived, the
"mark/tick it there" steps of 0.8, 4.2, 4.11, 4.14 and 8.4 are met by writing the closing commit against the id below
instead of editing the archived file.

**Superseded — owned here (6):**
- 4.11 ← "A routine's VAR_OUTPUT as a local copied back after the call, not a `&mut` reset on entry." (RC 20)
- 4.2 ← "A multi-target handle for stored POINTER/REFERENCE (`pointer-targets`)" (designed 2026-09-20 in `pointer-model.md`;
  two measurements before it: a `REFERENCE TO` field bound by a METHOD surviving to the next scan, and `__ISVALIDREF` of one
  never bound).
- 4.2 ← "**Form 2 first** (`pointer-model.md` §8)" — built (`pointers/borrowed.ts`); design.md §3.3 option (c) keeps it (the
  call-scoped half); 4.2 confirms.
- 4.2 ← "REFERENCE/POINTER inputs of a routine as borrows for the call — and interface inputs (`itf_function_input`)."
- 4.2 ← "`VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref` — on the phase-3 model." (its phase 4 parent)
- 4.14 ← "**`instanceRelative` treats the root FB's own frame as multi-instance** — structurally real, NO REACHING CASE." (resolved
  or left with a reason, as 4.14 says)

**Backlog — handed off, not in this change's scope (33, verbatim; `l.` = line in the archived tasks.md).** Feature growth
this change's non-goals exclude. They wait for a follow-up change; a model here that makes one lower for free reports it in
its delta.

- (l.170) **C0582's wording** — unreachable on SP21 (design §7 of phase 1 above). Mirror the tree's creation error
    instead? A decision for the user, not researched further.
- (l.217) **Standard's functions and blocks are also hard-coded as always-present names** (gap 10, raised by the user
    2026-09-14) — `reference.ts` lists LEN…FIND and TON…RS, so they resolve even in a project that references no
    Standard. Analysis done. **PARKED by the user 2026-09-14** ("a lot still to cover before we get to that") —
    together with all other Standard-library work (Standard64, the runtime tier).
- (l.229) **Push round-trip** — push each case's ST through the bridge, fetch it back, require it byte-identical. Existing
    ops only; catches serialization bugs on bit access, chains, conversions, literals.
- (l.231) **Build parity** — the bridge's `build` diagnostics for each case agree with what the oracle compile reported.
- (l.232) **Execution through the bridge** — a `run` op on the Core online API (`IOnlineApplication.Login/Start/
    SingleCycle` exist on SP21); reading values there is still to probe. Only then can `record:exec` drop the
    runscript. TwinCAT would need its own answer.
- (l.373) **A PROGRAM called from an FB body** (60 corpus POUs) — recorded (`state_program_called_from_fb`: the one
    instance PLC_PRG calls), not built. Rust holds program instances in `Programs`, handed only to the POU's own
    `scan`; an FB body would need them too, and a program body calling on would borrow them twice. The likely shape:
    every body takes `prg`, and a program call moves its instance out and back (`mem::replace`), with a lowering guard
    against re-entering a body still being lowered.
- (l.555) **Then** what is left of the library half: a call into a library FUNCTION or FB, whose BODY really is absent
    (`L_MC1P_ModuloCycle`, `StrConcatA`, `SysTimeRtcGet`) — design §8's stub mechanism, so a POU that calls one is
    still testable. `plc-library-runtime` covers Standard/Standard64 only and names none of these vendor libraries.
    Parked as the user asked (2026-09-16), and it is the next proposal after this change, not a phase of it.
- (l.566) `place-not-local` +4 → 56 — the library-free half: a `var` of another scope with no frame slot (`Unit`, `AxisRef`).
- (l.567) `init-not-constant` +3 → 59 — the library-free half: an initializer that folds but is not reached.
- (l.568) `graphical-body` +6 → 65 — an FBD/LD body reaching the backend through **network text**, not through `lowerUnit`.
- (l.569) `place-shape` +4 → 69 — member access on a base with no layout, an index on a non-array, a literal as a place.
- (l.570) `pointer-order` +5 → 74.
- (l.571) `call-body` +5 → 79.
- (l.572) `aggregate-init` +3 → 82 — an initializer naming an INHERITED field (`instanceNo` of a base FB) is the top shape.
- (l.573) `enum-value` +17 → 99 — **the biggest single step**: the library-free half, an enum value that does not fold.
- (l.574) `call-param` +4 → 103.
- (l.575) `interface-type` +3 → 106.
- (l.576) `expr-member` +4 → 110.
- (l.577) `stmt-try` +3 → 113 — `__TRY`/`__CATCH`; Rust has no exceptions, so decide a strategy or refuse explicitly.
- (l.578) `layout-union` +4 → 117.
- (l.579) `conversion-type` +2 → 119 · `fb-init-argument` +2 → 121 · `expr-call` +2 → 123 (the built-ins `ADR`, `LTIME`,
    `TEST_AND_SET`, `DELETE` reaching the generic call path) · `call-inout-alias` +1 → 124 · `stmt-call_stmt` +1 → 125.
- (l.609) **`place-not-local` (+7 sole)** — still the head of the list, and the four the old order counted have been
    taken. The library-free half: a `var` of another scope with no frame slot (`Unit`, `AxisRef`).
- (l.611) **`graphical-body` (+6 sole)** — an FBD/LD body through **network text**. Note what this now sits beside:
    `network-text` is a first-class sublanguage the LSP analyzes, and the conformance suite records graphical
    fixtures on both vendors, so the input is measured — what is missing is the route into `lowerUnit`.
- (l.614) **`stmt-try` (+3 sole)** — nine `__TRY` fixtures are in `KNOWN_DIVERGENCES.twincat` because the x64 code
    generator refuses structured exception handling there, which is a DEVICE fact and does not change what this
    backend must decide.
- (l.617) Then re-measure. `bun run scripts/lower-completeness.ts` prints the table above; the greedy order is
    derived from the refusals and moves when they do, which is what this section is evidence of.
- (l.627) `__ISVALIDREF` and the pointer built-ins, which only mean something here.
- (l.631) Interfaces, `EXTENDS`, `__QUERYINTERFACE` — dynamic dispatch.
- (l.851) `__POUNAME` 304 and the other CODESYS compiler operators.
- (l.861) `expr-assign_expr` (1).
- (l.868) `stmt-try` (6, 2%) — `__TRY`/`__CATCH`. The interpreter can run it; Rust has no exceptions, so the
    emitter needs a strategy or an explicit refusal. Decide rather than default.
- (l.870) `type-unknown` (18, 6%) — triage; each is a type the frontend could not resolve.
- (l.886) Stub mechanism for third-party library FBs, so a POU that calls one is still testable (design §8).
- (l.916) **A TwinCAT build pass for the program cases**, so the replay stops tolerating unrecorded cases on that vendor.
    PARKED (user, 2026-09-14) — the CODESYS data is complete and this is the second vendor's half. Tried once:
    `ide.ps1 up -Vendor twincat` attaches workers to two XAE windows, both "no project selected"; `connect
    {project: "TwinCAT Project13"}` binds it (worker log: "select: bound", "DEGRADED cleared") and one `refs`
    answers, then the recorder's `refs` is refused PLC_DISCONNECTED with no deselect in the log. Not diagnosed.

## Hand-off from frontend-conformance (2026-10-03, its tasks 5.2 and 5.3)

_The modules this hand-off names without `.ts` (`lower/lower`, `lower/calls`, `ir/values` …) are the pre-restructure files as read on 2026-10-03, since split — their homes are `docs/architecture.md`'s folder map._

These are notes, not tasks: the task list above is unchanged. Front-end paths are the real ones (`src/frontend/<layer>/…`);
every function named below is reachable through `src/frontend/<layer>/index.js` unless it says otherwise.

**Task 5.2 (input to 0.1 and 0.9).** design.md §6.1 gives each of the 15 needs of §6 a verdict and a path (met: 1, 2, 6 in
part, 7 in part, 8–13, 15 with two exceptions; not provided, with the reason: 3, 4, 5, `widthOf`, `contextLiteralType`, 14);
design.md §6.2 gives every front-end root cause a status (RC 1–4, 2.3, 6, 21, 45 closed UPSTREAM by the review's own fixes;
6.A.22, 6.A.24, 6.A.26 closed by frontend-conformance; 6.A.20, 6.A.25, 6.A.29 closed in the front-end half only; 6.A.21,
6.A.23 open). frontend-conformance changed no transpiler output: its F-back snapshot (emitted Rust and interpreter values,
1b03f0e55c → the 4e tree) is byte-identical for all 2181 fixtures that lowered at its start; 22 refused fixtures stopped
lowering because the parser now refuses them as CODESYS does (`cc_il_name_*` ×14, `cc_reserved_name_*` ×3,
`cc4_type_name_*_as_variable` ×2, `identifier_*underscore*` ×2, `var_non_retain`), one started (`operand_uchar_literal`,
`UCHAR#'A'`, which CODESYS REFUSES — "Cannot convert type 'UDINT' to type 'BYTE'", recorded; TwinCAT refuses it at
parse): lowering called the literal malformed and now lowers it, so it joins the 266 refused fixtures that lower — outside
the transpiler's input contract ("code CODESYS compiles", the old `fixtures` test's `refused` row), neither an improvement nor a
regression; the LSP gives the recorded refusal, pinned by the fixture's `refused` field. A refusal at a compiler struct
(`VERSION`, an `ANY` input — `type_codesys_version`, `refuse_interface_any_input`) pointed at 0:0; `storageOf` now takes
the span of its use and refuses there (fixed in frontend-conformance's step-5 review, the old `lower` test).

**Task 5.3 — the T hand-off.** Every "T" row of frontend-conformance design.md P6 and §3.3, once, with the transpiler site as
read on 2026-10-03 (line numbers name the code, not a contract) and the front-end function that replaces it. The restructure
task that owns each is in brackets.

- **H1 — EXTENDS chains** (P6 "13 EXTENDS sites"; §3.3 "EXTENDS chains", "Interface EXTENDS"). Sites today: `lower/lower`
  `extendsChain(lw, fb)` :212 (by NAME through `unit.extends?.text`) and its callers :398, :583; the `baseOf`/`.extends`/
  `baseScope` walks at `lower/lower` :200, :272, :290, :301, :377, :438; `lower/calls` :97–101, :113, :655, :735, :983,
  :1409; `lower/storage` :90, :109; `lower/bytes` :64, :72, :81; `lower/interfaces` :53, :66 (interface EXTENDS by
  name); `lower/lowering` :46 (`baseOf`, a copy of the front-end's). → `symbols/extends.ts` `extendsChain(scope)` (base
  first, cycle-safe), `baseOf`, `basesOf`/`ancestry` for interfaces (linked by the binder since frontend-conformance 3.2.1, so
  a base is the one precedence picked, not the first by name); `symbols/scope-nav.ts` `hasUnresolvedBase` for "incomplete".
  [1.1.2, 1.7.3]
- **H2 — GVL-qualified resolution** (P6 `places:33,64,80`). `lower/places` :34, :65, :81 search
  `lw.project.symbols.get(…)` for a `gvl_var`. → `symbols/scope-nav.ts` `resolveGvlMember`, `gvlBlockOf`, `externalGlobal`
  (per-unit `qualified_only` read since frontend-conformance 3.1.3). [1.6.12]
- **H3 — namespace lookups by map** (P6 `calls:976,1627`, `constants:103`). `lower/calls` :993
  (`ns.symbols.get(…)` for a namespace FUNCTION); `lower/lower` :302 (`s.symbols.get("fb_init")`). The `constants`
  namespace lookup now reads `findChildScope` (:56–58) — that site is met. → `symbols/scope-nav.ts` `findChildScope` +
  `symbols/scope.ts` `lookupLocal` (both on the symbols index). [6.5]
- **H4 — typing rules re-decided in lowering** (P6 NOT, duration × integer, LIMIT/SEL/MUX, `UNARY_MATH`, platform rewrite;
  §3.3 "NOT result type", "Built-in result types").
  - NOT: `lower/expressions` :180–184 (a signed integer → the bit string of its width) → `types/arith/operators.ts`
    `notResultType` (value-identical, frontend-conformance 4.3.2). [1.1.8]
  - duration × integer: `lower/expressions` :246–251 → `types/arith/temporal.ts` `durationScaleResultType`,
    `durationScaleConversion` (4.3.5). [1.1.8, 6.14]
  - LIMIT/SEL/MUX: `lower/builtins` :456–487 (its own meet over `commonType`/`integerFoldType`) → `types/builtins.ts`
    `selectionValueArguments` (the checked meet of the value arguments, after SEL's selector and MUX's index; 4.3.4).
    [6.7, 6.15]
  - `UNARY_MATH`: `lower/builtins` :76, :229 → `types/builtins.ts` `MATH_ARG_TYPED`, `mathResultType`. [1.6.15]
  - platform conversion rewrite: `lower/builtins` :152–156 (replaces `__XINT` & co. before parsing) and
    `lower/constants` :132, :183 (`parseConversionName(…, undefined)`) → `types/conversion-name.ts`
    `parseConversionName(name, target)` with the project's target (`symbols` `targetOf`), which reads platform sides itself
    (4.1.2). [1.1.10]
- **H5 — literal typing** (P6 `contextLiteralType`; §3.3 "Literal typing"). `lower/constants` `contextLiteralType` :251
  → `types/literal.ts` (`literalCheckType`, `literalContextConversion`, `integerLiteralType`). NOT value-identical: LT14
  (`test/frontend/literal-agreement.test.ts`, `baselines/literal-agreement.json`) pins 29 classes, corpus 78 / fixtures 79
  stores, where the two answer differently (a 0/1 into BOOL/BIT/TIME, an integer the target cannot hold, a real beyond REAL,
  a real into an integer); each class needs a recording before the switch, and the baseline may only fall. The transpiler's
  own mark here is `lt_literal_negative_in_comparison_unsigned` (rule LT12, `diverges`; F in 6.2). [1.1.7, 6.2]
- **H6 — width ladder and wrap** (P6 `stored`/`fit`/`integerFoldType`; §3.3 "Integer width ladder", "Wrap to width").
  `lower/convert` `stored` :132, `integerFoldType` :67; `ir/values` `fit` :416; `ir/evaluate` `widthOf` →
  `types/width.ts` `wrapToWidth` (export it from the types index first) and `integerOfWidth`; the fold width is the
  front-end fold's (`types/const/fold.ts`). [1.1.6, 6.B.2]
- **H7 — the constant folder and enum facts** (P6 `constants` row; §3.3 "Constant folding", "Enum base / numbering /
  default"). `lower/constants` `foldConstant` :187, `foldsToConstant` :157, `convertedConstant` :123 →
  `types/const/fold.ts` `constEval`, `compileTimeConstant`, `declaredValue`, `constantSlotType`, `constancyIn`
  (frontend-conformance 4.6.1 made the LSP fold the set the transpiler folds: conversions, pure built-ins, SIZEOF, enum
  values, NOT, shifts); `lower/constants` `enumStorage` :28 → `types/enums.ts` `enumStorage`/`enumValueStorage`
  (recorded DT5–DT6, 4.7.3). Already switched by frontend-conformance: `enumDefault`, `inlineEnumDefault` (1.37,
  `lower/storage` imports them), `calendarNanoseconds` (1.22). [1.1.9, 1.7.14, 7.2]
- **H8 — the default STRING capacity** (P6 `withStringCapacity`). `lower/storage` `withStringCapacity` :32 (and its
  callers in `builtins`, `places`, `constants`) → `types/defaults.ts` `DEFAULT_STRING_LENGTH`, applied at
  `lowering.resolve` as design.md §3.2 decides. [3.3]
- **H9 — the platform target** (P6 `canonicalElem`'s target in `lowering`). The `lowering` `canonicalElem` call is gone
  (`resolve` goes through `resolveTypeExpr`, which takes the project's target). What is left: `lower/conditions.ts` :20
  `EXEC_ORACLE_TARGET` passed to `build.buildSymbolTable` (`lower/lower` :719), and `lower/bytes` :172
  `elementaryTypeOn(name, targetOf(project))` for SIZEOF of a type name → `types/platform.ts` `canonicalElem(name, target)`
  / `elementaryTypeOn` with the target the project states (4.1.1; `workspace-refs` `MEASURED_DEVICE_TARGETS` for real
  projects). [1.1.6 or 6.B]
- **H10 — identifier equality** (P6 interp `sameName`). `interp/interp` `sameName` :467 → `syntax/identifier.ts`
  `sameName`; and the self-reference spellings `lower/calls` `isSuper` :84 and `lower/places` :156
  (`name.toUpperCase() === "SUPER"` / `"THIS"`, found by the frontend-conformance close review) → `syntax/identifier.ts`
  `selfRefKind`. [1.1.1]
- **H11 — attribute maps** (frontend-conformance 1.23 "T, 5.3"). `lower/lower` `attributesOf` :733 and
  `lowering` `attributes` :261 rebuild per-file maps from `unitAttributes`/`memberAttributes`/`declarationAttributes`;
  since frontend-conformance 2.7.2 every unit, member and declaration node carries `attributes` in the AST (the three
  functions no longer lex). → read the node's `attributes` (`syntax/pragmas/attributes.ts` `hasFrontendAttribute`,
  `readAttribute`). Output-neutral. [1.6.20]

**Fixtures the front-end now types and the transpiler does not lower** (each `not-lowered` in `map.generated.ts`; a model
task here that lowers one reports it): `ce_fold_untyped_in_context_values` ("init-not-constant": lowering folds an
initializer without its context — H5/H7); `dt_union_member_sizes` (union member sizes); `dt_this_into_pointer`,
`dt_this_deref_identity_values` (a bare THIS and `SUPER^.v` as places); `ty_dint_to_uxint` (a platform conversion name read
as a project FUNCTION — H4); the enum `to_string` member-name table (4.5.1, refused by name); `type_codesys_version` and
`refuse_interface_any_input` — the front-end now types `VERSION` and an `ANY` input as the compiler's own structs
(`types/system.ts`, rules TY14/TY15, recorded), so `lower/storage` :125 refuses `layout-struct` "VERSION / ANY has no
declaration lowering can lay out" at a zero span (no project symbol declares them); before, `type_codesys_version` was refused
as `slot-unknown` at its declaration. Lay out the system structs from `types/system.ts` `systemStructType`, or refuse at the
declaration that names one. [5 (the instance model) or 6.B]
