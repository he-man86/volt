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
    | FOR with an unsigned counter and a negative constant step emits `-1u8` | closed upstream (absorbed into RC 35); every other unsigned counter recorded by 6.A.27 | 8f6ae481e6; 6.A.27 |
    | an unbound FB VAR_IN_OUT reached from a METHOD panics with the "interface" message | closed (6.A.28: its own fault kind `unbound-inout`) | 6.A.28 |
    | REAL intermediates rounded to f32 per step | open | 6.A.2 |
    | LTIME_TO_TIME / LDT_TO_DT sub-unit truncation | open | 6.A.1 |
    | UDINT op DINT fixtures run only on zeros | closed upstream by the rating (RC 48: an all-default recording rates `compiles`) | 0ca79f7bae; 6.20 |
    | DINT/LINT MIN MOD -1 | open | 6.A.3 |
    | the interpreter's SHL/SHR/ROL count goes through `Number()` | open (`ir/evaluate.ts:81`) | 6.A.4 |
    | LEN(WSTRING) lowers through an implicit narrow | closed upstream (`standard_len_wstring_rejected` refused, no tier) | 8531164eca (RC 38) |
    | StrReplaceA panics past LEN | closed (3.11, step 3d: the body moves the whole buffer as recorded; a buffer size above the caller's string is niche: accepted loss) | 3.11 |
    | `x := F(o => x)`: which write wins | open | 6.A.5 |
    | `hasStatementAfterReturn` misses EXIT/CONTINUE and all-return IFs | open | 1.5.9 moves it as `exitsAfter` with today's behaviour; 7.5.11 fixes it |
    | const-generic in-out names collide | open | 6.A.6 |
    | emitted helpers collide with a user FUNCTION | open | 7.1.5 |
    | `ir/codes.ts` exact codes contradict their prefix families | open | 6.A.8 |
    | `constantValue` swallows every non-LoweringBug throw | open | 6.A.9 |
    | STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5' | open | 6.A.10 |
    | a whole-string cursor store is cut to the caller's capacity | closed (3.10, step 3d: refused `cursor-overrun` — store, chain link, FB copy-out, VAR_IN_OUT binding) | 3.10 |
    | `overridesCalled` resolves SUPER^.M() against the frame | open | 6.A.11 |
    | a bare METHOD call with an unconnected VAR_OUTPUT in an FB body is refused | open | 6.A.12 |
    | `calledLayout`'s doc about VAR_TEMP | open (it still reads "Refused, until recorded: an FB with VAR_TEMP") | 6.A.13 |
    | SHL/SHR of an untyped literal into a 64-bit destination | open | 6.A.14 |
    | `0 = p` / `0 <> p` refused | open | 4.13 (c) |
    | the init-sequence read walk skips `select` and an invoke's freezes | closed (5.9, step 5d: `initReadChildren` is `childrenOf`) | 5.9 |
    | `insideInstance` refuses `holder.started`, allows `holder.Get()` | closed (5.8, step 5d: both refused, `init-reads-instance`) | 5.8 |
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
    | (grouped) a STRUCT field's FB_Init arguments folded in the declaring POU's scope | closed (5.8, step 5d: the struct's scope — earlier fields, then globals) | 5.8 |
    | (grouped) a pointer's target set read while still growing | open | 4.13 (a) |
    | (grouped) a null source copied into a multi-target pointer becomes non-null | open | 4.13 (b) |
    | (grouped) GVL1.x and GVL2.x in two plain lists share one slot | open | 6.A.17 |
    | (grouped) member access does not walk EXTENDS | closed by frontend-conformance 3.2.3 | 461b70fc4d; 6.A.24 verify |
    | (grouped) subrange bounds dropped | the front-end closed by frontend-conformance 4.7.1; lowering open (`decl_subrange_unsigned` diverges) | 62bcb30d65; 6.A.25 |
    | (grouped) a qualified `Lib.T` resolves by its bare name | closed by frontend-conformance 3.4.2 | 1bdaf58172; 6.A.26 verify |
    | (grouped) an FB body call stores its inputs before binding its in-outs | open | 6.A.19 |
    | (grouped) an ANY input given a REFERENCE TO fails E0308 | open | 4.13 (e) |
    | (grouped) a named DINT/LINT constant folds unbounded in an initializer | the front-end half closed by frontend-conformance 4.6.1; closed by 6.A.29 (read in the run-time width; past 64 bits refused) | 62bcb30d65; 6.A.29 |

    Appendix B (refuted groups): mod-min-by-minus-one — open (6.A.3); rotate-in-promoted-width — closed (6.A.30: recorded, an untyped literal rotates in its destination's width);
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
- [x] 1.8.8 `libraries/index.ts` takes the manifest's directory (`LibraryManifest.dir`, the folder as its uri writes
  it) instead of slicing the URI (l.70). (Proposed as the manifest's `folder`; rejected — `folder` is the lower-cased
  name with `%20` decoded, so it would change every body's uri; see below and design.md §4.8.)
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
  - Done 2026-10-09 (step 1.8b, the owner default). `LibraryManifest.dir` (`frontend/library/manifest.ts`): the directory
    the manifest sits in exactly as its uri writes it (case, separators, `%20` kept, trailing separator included);
    `parseLibraryManifest` fills it — the one slice, moved from `libraries/index.ts`. `withImplementations` reads each
    file through `parseLibraryManifest` and names the bodies `manifest.dir + <element>.pou`. One behaviour edge, 0 in
    the corpora: a `.library` with no NAMESPACE line is not a manifest to it any more, as it already was to the binder
    and `prepare.ts` (all 695 manifests in the six corpora and the fixtures name one; the bridge always writes it).
    New `src/frontend/library/manifest.test.ts` (2; red first). Nineteen hand-written `LibraryManifest` literals in
    ten src tests gain their `dir`. T: old vs new `withImplementations` byte-identical over the six corpora (17685
    files, 695 manifests, 15 resolved by the repo, 250 files replaced); `bun typecheck` clean; test/conformance +
    test/libraries 6422 pass / 356 todo / 0 fail; test/frontend 45 pass / 0 fail, baselines unchanged;
    `rate:fixtures` leaves `map.generated.ts` unchanged; lint as before (1 function over 80, `lastBinding`, pre-existing).
  - Gate 1.8b (2026-10-09). Review: one low finding, fixed (record only, no code, so no failing test): this task's
    heading still named the manifest's `folder`, the design the step measured and rejected; it now names
    `LibraryManifest.dir` (design.md §4.8 already did). Numbers (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): `bun typecheck`
    clean; `bun test` 8848 pass, 35 skip, 399 todo, 0 fail (9282 tests, 308 files, 593 s); `bun run rate:fixtures` leaves
    `map.generated.ts` unchanged (edge agree 3107, disagree 3, not-run 207); `bun run lint` green (layering 4 known; size
    0 ceilings, 1 function over 80, `lastBinding`, pre-existing; citations strict, 5 planned).
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
- [x] 2.2 Design "§3.1 Decision: loops".
  - What: the cap (option a or b), the counting rule, the step rule (refuse only a non-converting step, per 2.1's runtime-step
    recordings), literal vs typed limit, loop depth, labels by pre-scan, what stays refused (by code), and which of `places/bounds.test.ts` ("bounds from a POU's own constant …"),
    `statements/loops.test.ts` ("a FOR reads its limit and its step on every pass") and `emit/rust/loops.test.ts` ("a FOR whose limit is a different type") change and on which recording.
  - Where: `design.md`.
  - Accept: committed before any code.
  - Depends: 2.1.
  - Done (2026-10-08): design.md "§3.1 Decision: loops", committed alone in d6ca98081b. Cap = option (a) as built, names kept
    (`loopGuard`/`LoopGuardError`; a `cfg` switch and the `loopBudget`/`HarnessBudget` rename rejected); counting rule kept (one
    body entry after a head test); `compareFault` runs under `HARNESS_LOOP_GUARD`, a `LoopGuardError` failing the case by name;
    step, literal limit and loop depth kept as built; ONE new refusal `for-limit-type` for a limit whose front-end type does not
    convert into the counter; labels from `ir/walk.loopUses`. `places/bounds.test.ts` and `statements/loops.test.ts` unchanged
    (`for_runtime_step_changed_in_body`, `callshape_for_bounds_changed_in_body`); `emit/rust/loops.test.ts` "a FOR whose limit is
    a different type" becomes the refusal (`for_limit_wider_than_counter_dint_var`/`_dint_expr`/`_upper_bound`).
    Every "as built" claim re-checked in the code at this tick: `for-step-type`, `for-bound-call`, `exit-outside-loop` in
    `lower/diagnostics/codes.ts`; `beside` + the `for-compare` meet in `lower/statements/loops.ts`; `compareFault`
    (`transpile-replay.test.ts`) calls `run()` with no guard; the guard pinned at N/N+1 (`pipeline/control.test.ts`,
    `emit-build.test.ts` 3 vs 2); `emit/rust/loops.ts` still rewrites `p.lines[…]`. The `for-limit-type` rule measured on the
    front end (a single-use scratch probe, deleted): `inferExprType` + `classifyConversion` answer `k - 1` (DINT) into INT
    `incompatible`, `UPPER_BOUND(arr, 1)` (DINT) into INT `incompatible`, `k` (DINT) into INT `incompatible`, `n - 1` (UINT) into
    UINT `identity`, `-5` and `100 + 100` (untyped) `identity` — the three refusals and the three that stay confirmed separate
    exactly. Map at the tick: `tr_35_for_byte_step_minus_one`, `_uint_step_minus_two`, `_byte_step_255`, `tr_36_*`,
    `callshape_for_runtime_step` confirmed; `tr_35_for_byte_runtime_int_step`, `_sint_step_300` `lsp-gap` with no rust column
    (refused by the transpiler); `cc2_exit_outside_loop` `refused`; the three typed wider limits `lsp-gap`, rust `compiles`.
    Tasks 2.3–2.8 below rewritten to the decision's migration (2.3 named a cap and renames that no longer exist).
  - [x] Gate 2b (2026-10-08). Three review findings, all fixed in the plan (no code: the findings schedule recordings and
    comment rewrites for 2.6, so there is no test to turn red here):
    - The step rule is judged by IR shape (`by.kind === "load"` in `lower/statements/loops.ts`), the judgement §3.1 rejects
      for the limit. Re-measured with a single-use scratch probe (deleted): `BY k - 1` (`k : DINT`) on an INT counter lowers
      and runs n = 10, `BY UPPER_BOUND(a, 1)` n = 3, `BY k` refused `for-step-type`. design.md §3.1 "Open (gate 2b)"; 2.4 is
      no longer check-only; 2.6's batch records `for_step_wider_than_counter_dint_expr` and `_upper_bound` and changes the
      step rule if CODESYS refuses them.
    - `for-limit-type` decides classes with no recording (one `incompatible` pair recorded; FOR-limit conversion is not
      assignment conversion: `tr_36_*` vs `tr_37_case_label_wraps_300`). 2.6's batch adds `for_limit_wider_than_counter_
      typed_literal` (`TO DINT#5` on INT) and `for_limit_sign_change_int_on_uint` / `_uint_on_int`; a REAL limit stays
      refused unrecorded (refusing loses nothing). 2.6's batch is now six fixtures, one `record:exec` run.
    - 2.6 now names the two product comments to rewrite to `for_limit_wider_than_counter_dint_var`'s recording (above
      `compareIn` in `lower/statements/loops.ts`; the header of `emit/rust/loops.test.ts`'s "a FOR whose limit is a
      different type").
    - Numbers (no fixture or transpiler change, so `map.generated.ts` not regenerated — unchanged from gate 2a): typecheck
      clean; FULL `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8538 pass, 35 skip, 432 todo,
      0 fail (9005 tests, 303 files, 623 s), fold agreement 420 compared, 38 disagree, 38 known; `bun run test:corpus`
      19 pass, 1 skip, 0 fail; `bun run lint` exit 0; `openspec validate` valid; `bun run check` 18 passed.
- [x] 2.3 A runaway cannot hang the fault replay (RC 27's last hole).
  - What: RC 27 itself landed in f052467157 (no cap in `ir/`, the interpreter or the Rust; `run`/`emitRust` take `loopGuard`).
    Left: `compareFault` (`test/conformance/transpile-replay.test.ts`) runs `run()` under `HARNESS_LOOP_GUARD`; a
    `LoopGuardError` there fails the case by name ("runs past the harness guard") — never a refusal, never a fault match.
    No renames.
  - Where: `test/conformance/transpile-replay.test.ts` (+ its support).
  - Accept: red first (a runaway shape replayed through `compareFault` hangs, or passes on the guard's throw, today); then green;
    F(`tr_27_loop_cap_for_1000000`, `_for_1000001`, `_repeat_1000001`, `_while_5000000`) stay confirmed; the N/N+1 boundary
    tests (`pipeline/control.test.ts`, `emit-build.test.ts`) unchanged; M.
  - Depends: 2.2.
  - Done (2026-10-08, step 2c). `compareFault` calls `replayFault(pou, cycles, HARNESS_LOOP_GUARD)`
    (`test/conformance/support/transpile/fault.ts`, new): `run()` under the guard; a `LoopGuardError` throws "runs past the
    harness guard (N body entries)" (cause kept), any other throw is the fault match, a completed scan throws "completed …
    where the vendor stopped". Red first: `fault.test.ts` ("a runaway replayed as a vendor stop fails by name") against
    today's body (unguarded `run()`) HUNG — killed by a 60 s process timeout; green after. No renames. `tr_27_*` stay
    confirmed (map unchanged for them); `pipeline/control.test.ts` and `emit-build.test.ts` untouched. M: no map change
    from this task (the 32 `compareFault` rows — faults and `diverges` — pass under the guard).
- [x] 2.4 FOR step (RC 35) — a check for the folded and variable step; the typed non-variable step is decided in 2.6.
  - What: verify the folded step (wrapped to the counter, direction from the signed literal), `for-step-type` for a variable step
    that does not convert and for a folded step that does not fit, and the convertible runtime step read every pass. NOT a
    check-only task (gate 2b): the type rule fires only on a bare variable (IR `by.kind === "load"`), so `BY k - 1` (`k : DINT`)
    and `BY UPPER_BOUND(a, 1)` on an INT counter lower and run unrecorded (design §3.1 "Open (gate 2b)"); 2.6 records them and
    changes the rule if CODESYS refuses them.
  - Where: `lower/statements/loops.ts` (read only here; changed in 2.6 if the recordings say so).
  - Accept: F(`tr_35_for_byte_step_minus_one`, `tr_35_for_uint_step_minus_two`); `tr_35_for_byte_step_255` and
    `callshape_for_runtime_step` confirmed; `tr_35_for_byte_runtime_int_step` and `tr_35_for_sint_step_300` refused by the
    transpiler (LSP half Filed); `loops.test.ts` and `bounds.test.ts` green and unchanged; M.
  - Depends: 2.3.
  - Done (2026-10-08, step 2c). Folded step verified (`tr_35_for_byte_step_minus_one`, `_uint_step_minus_two`,
    `_byte_step_255`, `callshape_for_runtime_step` confirmed, no divergence mark on any — F holds); `tr_35_for_byte_runtime_int
    _step`, `_sint_step_300` refused by the transpiler (`for-step-type`; `lsp-gap`, LSP half filed as lsp-transpile-review-gaps
    1.2). The typed non-variable step changed in 2.6 (CODESYS refuses it). `statements/loops.test.ts` existing tests and
    `places/bounds.test.ts` unchanged and green (2.6 ADDS one test to `loops.test.ts`).
- [x] 2.5 FOR literal limit in its own type (RC 36) — a check, no code.
  - What: verify `beside` (a constant the counter cannot hold keeps its type) and the compare in the `for-compare` meet.
  - Where: `lower/statements/loops.ts` (read only).
  - Accept: F(`tr_36_for_literal_limit_beyond_counter`) (n = 300, small = 44); its src test exists (name it); M.
  - Depends: 2.4.
  - Done (2026-10-08, step 2c). `beside` + the `for-compare` meet verified; `tr_36_for_literal_limit_beyond_counter`
    confirmed (n = 300, small = 44), no mark. Src test: `lower/statements/loops.test.ts` "a literal FOR limit the counter's
    type cannot hold is compared unnarrowed". No code.
- [x] 2.6 A typed FOR limit wider than the counter is refused (RC 13's transpiler half).
  - What: a limit whose FRONT-END type (`inferExprType`) does not convert implicitly into the counter
    (`classifyConversion(counter, limit) === "incompatible"`) is refused with a new code `for-limit-type` ("invalid"); an untyped
    limit stays asked by value. First write and record, in the step's ONE `record:exec` batch (gate 2b widened it from one to
    six; design §3.1): `for_limit_wider_than_counter_dint_constant` (a named DINT CONSTANT limit on an INT counter),
    `_typed_literal` (`TO DINT#5` on INT), `for_limit_sign_change_int_on_uint` (INT variable limit on a UINT counter) and
    `_uint_on_int` (UINT on INT; both rated `sign-change`, kept by the rule as written), `for_step_wider_than_counter_dint_expr`
    (`BY k - 1`, `k : DINT`, INT counter) and `_upper_bound` (`BY UPPER_BOUND(a, 1)`). The recordings decide: a refused
    sign-change pair widens `for-limit-type` to `sign-change`; an accepted typed literal is asked by value; refused typed
    steps → the step judged by its front-end type (`inferExprType` + `classifyConversion`) under `for-step-type`, an
    expression of untyped literals (`callshape_for_runtime_step`) still asked by value. Rewrite the two product comments
    that contradict `for_limit_wider_than_counter_dint_var`'s recording ("does not compile: Cannot convert type 'DINT' to
    type 'INT'"): the block above `compareIn` in `lower/statements/loops.ts` ("ordinary ST that CODESYS compiles", "a DINT
    100000 into an INT"), and the header comment of `emit/rust/loops.test.ts`'s "a FOR whose limit is a different type".
  - Where: `lower/statements/loops.ts`, `lower/diagnostics/codes.ts`, `emit/rust/loops.test.ts`,
    `test/conformance/fixtures/semantics/execution.ts` (the six fixtures).
  - Accept: the six recorded (one batch); `for_limit_wider_than_counter_dint_var`, `_dint_expr`, `_upper_bound` refused by the
    transpiler (their `rust`/`tier` columns disappear; the LSP half is Filed); each of the six rated as its recording says;
    `_uint_expr`, `_negative_step`, `tr_36_*` and `callshape_for_runtime_step` stay confirmed; `emit/rust/loops.test.ts`
    "a FOR whose limit is a different type" changes to the refusal, citing those three recordings; no comment left calling a
    DINT limit on an INT counter compilable; src test red then green; M.
  - Depends: 2.5.
  - Done (2026-10-08, step 2c). Recorded (record:exec, CODESYS 3.5.21.40): batch of six, then ONE more fixture in a
    second run, because `BY k - 1` answered a different question (design §3.1 "Settled"):
    `for_limit_wider_than_counter_dint_constant` and `_typed_literal` — "Cannot convert type 'DINT' to type 'INT'";
    `for_limit_sign_change_int_on_uint` (runs 3, u 4) and `_uint_on_int` (runs 3, i 4) — compile, so `for-limit-type` stays
    at `incompatible`; `for_step_wider_than_counter_upper_bound` — "Cannot convert type 'DINT' to type 'INT'";
    `for_step_wider_than_counter_dint_expr` (`BY k - 1`) — a PARSE error, "'DO' expected instead of '-'";
    `for_step_wider_than_counter_dint_paren` (`BY (k - 1)`, the 7th) — "Cannot convert type 'DINT' to type 'INT'".
    Code: `lower/statements/loops.ts` `typedIncompatible` (front-end type: `inferExprType` + `classifyConversion` ===
    `incompatible`) refuses the limit with new `for-limit-type` ("invalid", `lower/diagnostics/codes.ts`) and replaces the
    step's IR-shape test (`by.kind === "load"`) under `for-step-type`; the step lowering split into `lowerForStep` (lowerFor
    was 89 lines). Comments rewritten (above `compareIn`; `emit/rust/loops.test.ts`'s describe header) to the recordings.
    Tests: `loops.test.ts` "a typed FOR limit or step that does not convert into the counter is refused; untyped ones are
    asked by value" (red, then green); `emit/rust/loops.test.ts` "a typed limit that does not convert into the counter is
    refused, as CODESYS refuses it" (replaces "the counter is promoted to the common type") and "a same-width sign change
    meets in the common type" (`(self.u as i16) > self.hi`). Ratings: `_dint_var`, `_dint_expr`, `_upper_bound` lose their
    `rust`/`tier` columns (`lsp-gap`); the five new refusals `lsp-gap` with no rust column (`MEASURED_SILENT` +5; filed as
    lsp-transpile-review-gaps 2.1, and 2.2 for the parse error — niche: accepted loss, 0 `BY x - y` in the corpora);
    sign-change pair confirmed, rust `vendor`; `_uint_expr`, `_negative_step`, `tr_36_*`, `callshape_for_runtime_step`
    stay confirmed. `map.test.ts` lsp-gap ceiling 76 -> 81 (for measurement). Frontend baselines: counts only
    (`VOLT_WRITE_BASELINE=1`: files 10720 -> 10734, expressions +72 per vendor, literal UNKNOWN +27 per vendor, literals
    stored 4641 -> 4656, recorded values 9114 -> 9120, unrecorded-no-parse-error +7 per vendor, bare names resolved +34
    per vendor, folds +1/+7 per vendor); no finding, `ceilings.json` unchanged.
    M (`rate:fixtures`): confirmed 2809 -> 2811, refused 1989, not-lowered 389, lsp-gap 76 -> 81, diverges 5, unaskable 92;
    control 158/147 -> 157/146; lowered 3228 -> 3227, shapes 1719 -> 1718; edge agree 3043 -> 3042, disagree 0, not-run
    185 (partial agrees: `_dint_expr` 2/16 and `_dint_var` 1/16 gone, `for_limit_sign_change_int_on_uint` 1/14 new);
    median size 3.1 unchanged; pedantic 30868 -> 30864 (must_use_candidate -1, cast_possible_truncation -1, cast_lossless
    -3, missing_panics_doc -1, cast_possible_wrap +2); no ALLOWED count or note changed. Fixtures whose Rust changed: the
    three refused (no Rust now) and the two sign-change (new).
- [x] 2.7 EXIT/CONTINUE outside a loop (RC 39) — a check, no code.
  - What: verify `lw.loops` → `exit-outside-loop` (`lowerExit` in `lower/statements/loops.ts`).
  - Where: read only.
  - Accept: `cc2_exit_outside_loop` refused by the transpiler with `exit-outside-loop` (no `rust`/`tier` column); its src test
    exists (name it); M.
  - Depends: 2.3.
  - Done (2026-10-08, step 2c). `lowerExit` → `exit-outside-loop` verified; `cc2_exit_outside_loop` rated `refused`, no
    `rust`/`tier` column. Src test: `lower/statements/loops.test.ts` "EXIT and CONTINUE outside a loop are refused; inside one
    — nested in an IF — they lower". No code.
  - [x] Gate 2c (2026-10-08). Four review findings, all fixed (red test first each); one record:exec batch of three
    fixtures (CODESYS 3.5.21.40):
    - (medium) The same-width sign-change pair was compared in the unpromoted common type (INT) and its emit test pinned
      `(self.u as i16)` to what the code printed; its recordings stayed inside INT. Recorded outside it:
      `for_limit_sign_change_uint_counter_out_of_int_range` (UINT counter from 40000 TO an INT 100) runs 0, u 40000 — the
      transpiler ran 25637; `for_limit_sign_change_uint_limit_out_of_int_range` (INT counter TO a UINT 40000, EXIT at 50000)
      runs 50000, i -15537 — the transpiler ran 0. CODESYS compares the pair PROMOTED, as an IF does. Fix:
      `values/promote.ts` `for-compare` is the pair's one type when they are the same (promotion keeps every value, so
      that compares alike), else `promoteForRuntime(commonType)`. Tests: `statements/loops.test.ts` "a same-width
      sign-change FOR pair is compared promoted, as an IF compares it" (red, then green); `values/promote.test.ts`
      for-compare rows (+UINT/INT -> DINT, UDINT/DINT -> DINT); `emit/rust/loops.test.ts` now pins
      `(self.u as i32) > (self.hi as i32)`, citing the recording. Comments above `compareIn` and the describe header
      rewritten.
    - (low) A typed literal step was refused unrecorded. Recorded `for_step_typed_literal_on_narrower_counter` (`BY INT#-1`
      on a BYTE): "Cannot convert type 'INT' to type 'BYTE'" — the 2c rule is right. Added to `loops.test.ts`'s refusal
      test (and the untyped `BY -1` beside it), to MEASURED_SILENT (`lsp-gap`) and to lsp-transpile-review-gaps 2.1.
    - (low) `execution.ts`'s comment above the typed-step fixtures stated the pre-recording guess; rewritten to the
      recording (`_dint_paren`, `_upper_bound` do not compile; `_dint_expr` is a parse error).
    - (low) `replayFault` matched any throw. Now only a `RangeError` (the interpreter's runtime faults: `IecFault`, index
      or character out of range) matches; anything else is rethrown. `fault.test.ts` "an interpreter crash is not a fault
      match — it is rethrown" (IR with an unknown statement kind throws a TypeError; red, then green).
    - Numbers: typecheck clean; `rate:fixtures` — confirmed 2811 -> 2813 (the two new sign-change fixtures), refused 1989,
      not-lowered 389, lsp-gap 81 -> 82 (`map.test.ts` ceiling 81 -> 82, for measurement), diverges 5, unaskable 92;
      control 157/146 -> 159/148; lowered 3227 -> 3229, shapes 1718 -> 1720; edge agree 3042 -> 3044, disagree 0, not-run
      185; pedantic 30864 -> 30874 (cast_lossless +8, must_use_candidate +2, missing_panics_doc +2, cast_possible_wrap -2).
      Rust changed for the two existing sign-change fixtures only (shape and pedantic 5 -> 6). Frontend baselines counts
      only (`VOLT_WRITE_BASELINE=1`, files 10734 -> 10740, recorded values 9120 -> 9126), `ceilings.json` unchanged. FULL
      `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8559 pass, 35 skip, 432 todo, 0 fail (9026
      tests, 304 files, 640 s), fold agreement 420 compared, 38 disagree, 38 known; `bun run test:corpus` 19 pass, 1 skip,
      0 fail; `bun run lint` exit 0; `openspec validate` valid; `bun run check` 18 passed.
- [x] 2.8 Labels from the IR pre-scan.
  - What: whether a loop needs `'loop_N`/`'body_N` comes from `ir/walk.loopUses`, asked before printing; `emit/rust/loops.ts` stops
    rewriting printed lines (`p.lines[…].replace`); the printed text is unchanged.
  - Where: `emit/rust/loops.ts`, `ir/walk.ts`.
  - Accept: S-out and Rust identical (S on the rust layer).
  - Depends: 2.3.
  - Done (2026-10-08, step 2d). `stmtLoop` asks `loopUses(s)` before printing and prints `'loop_N: ` only on `exits`, `'body_N: `
    only on `continues`; the two `p.lines[…].replace` rewrites, `stmtBreak`/`stmtContinue`'s flag writes and the printer frame's
    `exits`/`continues` fields are gone (`Printer.loops` is `{ n }[]`, the number the breaks name). `ir/walk.ts` and
    `walk.test.ts` untouched. S: `snapshot:transpile write --baseline --layers ir,rust` before the edit, `check --layers ir,rust`
    after: 5370 fixtures, "✓ identical" (IR and Rust unchanged, so S-out follows: the outputs/edge layers are computed from
    those two). `rate:fixtures` rewrote `map.generated.ts` byte-identical.
- [x] 2.9 RC 13 regression guard.
  - What: the conformance replay of the UINT `n-1` loop is the compile guard (design.md §3.1 step 2d: no rustc in a colocated test,
    layering rule 6); `emit/rust/loops.test.ts` pins its text.
  - Where: `emit/rust/loops.test.ts`, `test/conformance/transpile-replay.test.ts` (read only).
  - Accept: G; `for_limit_wider_than_counter_uint_expr` (the task named it `_uint_n_minus_1`, which does not exist) and
    `for_limit_wider_than_counter_negative_step` stay confirmed after 2.4-2.6 (the typed wider limits are refused, per 2.6: the
    task first said three; 2.6 recorded two more, five in all).
  - Depends: 2.6.
  - Done (2026-10-08, step 2d). Red check, reverted: a scratch edit made the FOR step add to the widened test read (`left: current`
    in `lower/statements/loops.ts`) — `emit/rust/loops.test.ts` "the step adds in the counter's own type — only the test is
    widened" failed (1 of 7), and `VOLT_FIXTURES=for_limit_wider_than_counter_uint_expr,_negative_step bun test
    test/conformance/transpile-replay.test.ts` failed `for_limit_wider_than_counter_uint_expr` by name with rustc
    `error[E0308]: mismatched types` (plus its stored-row check; 2 of 16). Reverted: 7/7 and 16/16 pass. No new test. Map:
    `_uint_expr` and `_negative_step` confirmed, tier control, rust `vendor`, edge `agree`; the five typed wider limits
    `_dint_constant`, `_dint_expr`, `_dint_var`, `_typed_literal`, `_upper_bound` `lsp-gap`, no rust column (`_dint_constant`
    and `_typed_literal` recorded in 2.6).
  - Gate 2d review: the Done note above and the Accept line named three refused typed wider limits; the map has five at
    `lsp-gap` (`_dint_constant`, `_typed_literal` from 2.6 too). Record fixed, no data or code change (review found
    `loopUses` gives the old flags' answer: body only, no nested loops, `blocksOf` covers if/switch/loop).
- [x] 2.10 Model delta.
  - What: architecture.md's loop paragraph; the map delta written here.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 2.3-2.9.
  - Done (2026-10-08, step 2d). `docs/architecture.md`: a *Loops* paragraph after "The IR carries the semantics" — no bound in
    the semantics (harness-only `loopGuard`, one body entry after a head test = one pass in both backends, `LoopGuardError`
    never a fault match); FOR step and limit judged by front-end type (`for-step-type`, `for-limit-type`), untyped literal
    expressions by value; labels from `ir/walk.loopUses`.
    Map delta, model 1 (before 2a = `map.generated.ts` at 7dcd537a00; after 2.9 = `rate:fixtures` on the 2d tree, unchanged
    from gate 2c): map rows 5355 -> 5368 (+13: three 2.1 measurements, seven 2.6, two gate-2c sign-change, one
    `for_step_typed_literal_on_narrower_counter`); confirmed 2806 -> 2813, lsp-gap 76 -> 82, refused (map rows) 1987 ->
    1987 (`rate:fixtures` 1989 -> 1989), not-lowered 389, diverges 5, unaskable 92 unchanged; tier control 155 -> 159
    lowered (clean 144 -> 148), other tiers unchanged; edge agree 3046 -> 3044, disagree 0, not-run 179 -> 185. No
    known divergence opened or closed by model 1: RC 27/35/36/39 were already passes at 2.1, RC 13's transpiler half
    became refusals (`lsp-gap`, the LSP half is lsp-transpile-review-gaps 2.1).
  - Gate 2d (2026-10-08): one review finding (2.9's record named three of the five refused typed wider limits) fixed in the
    record. `bun typecheck` clean; `rate:fixtures` map byte-identical (control 159 lowered/148 clean, edge agree 3044,
    disagree 0, not-run 185); `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8559 pass, 35 skip,
    432 todo, 0 fail (9026 tests, 304 files, 637 s), fold agreement 420 compared, 38 disagree, 38 known; `bun run
    test:corpus` 19 pass, 1 skip, 0 fail; `bun run lint` exit 0; `openspec validate` valid; `bun run check` 18 passed.

## 3. Model 2: strings (RC 11, 34, 45; appendix string items)

- [x] 3.1 Measure.
  - What: M1 (re-read `tr_45` cell by cell against RC 45's LIVE text; record `string_literal_nul_tail` if unresolved), M2
    (`string_assign_tail_narrow`, `string_assign_tail_wide`), M3 (WSTRING twins), M4 (`string_compare_tail`), M5
    (`string_conversion_result_capacity`, `concat_result_capacity`), M6 (interpreter time per representation on the `string_*` fixtures),
    M7 (how CODESYS prints a sizeless STRING in `codesys.build.json` messages, and every LSP message/hover that renders one).
  - Where: `test/conformance/fixtures/strings/string-edges.ts`; numbers here.
  - Accept: recordings committed; M1-M7 answered here.
  - Depends: 1.9.4.
  - Done (2026-10-08, at cda74a482d; single-use scratch probes for M6/M7 and the index census, deleted — nothing under
    `scripts/`). As with RC 27 in 2.1, most of RC 34/45/11 ALREADY landed in transpile-review (5c1e7e00df, 34.2/45.2/11.2):
    the interpreter holds the whole buffer as a JS string (trailing zeros trimmed, `len` = first 0, `semantics/string.ts`
    `charAt`/`setChar`/`visible`/`held`), the Rust `IecStr<T, N>` a `[T; N]` with N = the capacity (byte N, the terminator, is
    implied: `char_at(N)` reads 0, `with_char(N, 0)` is a no-op) and `len` re-scanned; `tr_34_lib_prim_char_behind`,
    `tr_45_string_embedded_nul`, `tr_11_string_conversion_beyond_80` and `lib_prim_char_past_length` are `confirmed` (rust
    vendor). So 3.2 decides what of 3.4-3.8 is left, and the representation question is whether to keep the JS string
    (option c without the tail array) or move to (a)/(b). New fixtures: nine, `STRING_MODEL_TESTS` in `string-edges.ts`
    (each dumps the BUFFER through `s[i]` into an ARRAY OF BYTE/WORD, the destination pre-filled with 'Z' = 90, long operands
    filled by index), recorded in ONE `record:exec` batch (CODESYS 3.5.21.40 simulation, 9 cases, 0 failed); the two M5
    fixtures re-recorded once (2 cases) after their length loops were made to stop at the first 0 (the first loops counted
    every non-zero unit of the buffer and read 211 for a 200-unit conversion result — non-zero units sit behind its
    terminator — so they measured something else; recorded values only, no recording edited).
    - M1 — RC 45's LIVE text is WRONG for its source. `tr_45`'s committed recording (c2 = 0, c3 = 0, uc3 = 0, lenS = lenU =
      lenS3 = 2, eqAb = eqFull = weqAb = TRUE, cat = 'abX') disagrees with the LIVE text (c3 = 99, uc3 = 99) on exactly those
      two cells, and `string_literal_nul_tail` re-asks the cell verbatim: `three : STRING(3) := 'ab$00c'` holds 97 98 0 0 —
      the literal's 4th unit 'c' falls on byte 3, the terminator of a STRING(3), and is cut; `tr_45`'s note "bytes behind the
      NUL are 0" is true only because of that capacity. Where the capacity holds the literal the bytes behind its `$00` ARE
      stored: `lit : STRING(10) := 'ab$00cd'` and the sizeless `bare` hold 97 98 0 99 100 0 0 0 0 0 0, LEN 2; a copy
      `copy := lit` carries them (same bytes). A literal STORED at run time over 'ZZZZZZZZZZ' gives 97 98 0 99 100 0 90 90 90
      90 0: it writes its own units and its terminator (six) and leaves the rest of the destination — see M2.
    - M2 — a string store writes `min(n, m)` units of the SOURCE BUFFER (the bytes behind its terminator included), then a 0
      at `min(n, m)`, and leaves every destination unit behind that as it was. Narrow, STRING(10) := STRING(20) holding
      'abc' + 0 + 'efgh…t': 97 98 99 0 101 102 103 104 105 106 0, LEN 3 (a 20-character source with no 0: 'abcdefghij', LEN
      10). Wide, STRING(20) := STRING(10) holding 'abc' + 0 + 'efghij' over 20 'Z': 97 98 99 0 101…106 0, then 90 at [11..19],
      0 at [20] — the eleven bytes of the source, nothing of its neighbour `after` ('QQQQ…'). A literal is a source of its
      own length (M1); a STRING(3) into a Z-filled STRING(10) writes four (97 98 0 0, 90 from [4]). Today both backends
      rebuild the destination from zeros (`fit` / `IecStr::to` start from `new()`), so the WIDE half diverges (the 'Z's read
      0) while the narrow half already matches. 3.6's "a same-capacity copy keeps the units" is the special case of this rule.
      SCOPE (gate 3a): measured, `n` = the source's declared capacity, on these sources — a STRING/WSTRING variable, a
      literal (n = its own length), a user FUNCTION's STRING(10) result, and CONCAT / LEFT / STRING_TO_WSTRING /
      WSTRING_TO_STRING results, whose `n` is 255 (the library's and the conversions' result buffer); and on these
      destinations — a plain variable, an ARRAY element, a STRUCT member, a VAR_IN_OUT (store inside a FUNCTION) and an FB
      VAR_INPUT (the call's pass). The units behind a 255-unit result's terminator are STACK RESIDUE (address bytes that
      differ between two runs), so what such a store leaves behind the result's length is unaskable; only its extent is
      (it writes `min(m, 255)` units and a 0 there). Not measured: a function VAR_INPUT pass (fresh stack; no destination
      to pre-fill), a POINTER/REFERENCE destination, a user FUNCTION_BLOCK output.
    - M3 — WSTRING: identical, unit for unit (`wstring_literal_nul_tail` 97 98 0 99 100 0 …, `three` 97 98 0 0, the sizeless
      `bare` 97 98 0 99 100 0 0 …, LEN-by-loop of `lit`/`assigned`/`copy` 2 — every cell the STRING twin asks, since gate
      3a —, the run-time literal store and the copies keep 90 exactly where the STRING twins do;
      `wstring_assign_tail_narrow`/`_wide` as M2).
    - M4 — comparison reads only up to the terminator: 'abc' + 0 + 'def' against 'abc' + 0 + 'xyz' is equal (eqAB, leAB,
      geAB TRUE; neAB, ltAB, gtAB FALSE), against a STRING(20) 'abc' + 0 + 'rstuvw' equal (eqAC TRUE, ltAC/gtAC FALSE), = 'abc'
      TRUE, and the WSTRING twins the same. Today's model already compares `units[..len]` (confirmed).
    - M5 — conversions and the Standard functions cut at 255. STRING_TO_WSTRING, WSTRING_TO_STRING, TO_WSTRING and TO_STRING
      of a 300-unit operand all give 255 units (a 200-unit one gives 200); CONCAT of two 150-unit STRING(200)s gives 255;
      LEFT(·, 290), RIGHT(·, 290), INSERT, REPLACE of a 300-unit STRING(300) give 255, DELETE(·, 2, 150) 253, MID(·, 290, 2)
      254, LEN 255, FIND of a 'Q' at position 281 0 — the operand itself is cut to 255 on the way IN (the library's STRING(255)
      parameters; `esc_wstring_sized_fits` records "Cannot convert type 'WSTRING(3)' to type 'STRING(255)'"). The library bodies
      already match (`concat_result_capacity` confirmed); the conversions do NOT: RC 11's fix sizes a STRING↔WSTRING result by
      its source and gives 300 (`string_conversion_result_capacity` diverges). So 3.8's "a wide result is sized by the source
      (M5)" is contradicted: the result capacity is 255, and only an operand under 80 → 255 is what RC 11 fixed.
    - M6 — interpreter cost. Today, the 197 lowered fixtures whose name says string run in 11.8 ms together (median of 7 per
      fixture; median fixture 0.006 ms; top: `tr_11_string_conversion_beyond_80` 5.9 ms, `string_conversion_result_capacity`
      1.9 ms, `string_input_truncation` 0.94 ms, everything else ≤ 0.24 ms). The representation alone, on one workload in the
      fixtures' mix (200 × [300 indexed stores each followed by a LEN, 50 copies 300 → 400, 50 compares], the same checksum
      from all three): today's JS string 12.0 ms, (a) a `Uint8Array(n + 1)` with `len` scanned on read 4.0 ms, (b) (a) plus
      a cached `len` 4.1 ms. No option is a cost problem; (a) is 3× faster on the primitive mix and (b)'s cache buys nothing.
    - M7 — CODESYS prints the type AS DECLARED: a sizeless STRING is 'STRING', never 'STRING(80)'. Quoted string types in
      `codesys.build.json` messages: 'STRING' 542, 'WSTRING' 36, sized ones 96 (STRING(255) 21 — the library's parameters —,
      STRING(2) 13, STRING(4) 12, …); 'STRING(80)' 0. 564 messages quoting a bare 'STRING'/'WSTRING' sit in fixtures that
      declare ONLY sizeless strings (TwinCAT 560), and the only 'STRING(80)' anywhere (TwinCAT, 3, `sysop_position_value`)
      comes from a declaration that WRITES `STRING(80)`. The LSP renders a Type in one place, `frontend/types/render.ts`
      `renderType` (`t.length === undefined ? name : name(n)`), called from 21 analysis checks/shared files
      (`checks/calls/{call-arguments,intrinsic-operands}`, `checks/declarations/input-default`, `checks/flow/case-labels`,
      `checks/oop/{method-reference,method-signature}`, `checks/types/{array-init,assignment,comparison,conversion,enum-init,
      indexing,pointer-conversion,string-constant,subrange,unary-operand,unknown-source}`, `shared/{reference-bind,rules}`,
      `frontend/types/literal`) and `network/network-analysis`; hover and signature help print the DECLARED `TypeExpr`
      (`renderTypeExpr`, `services/assist/{hover,signature-help}.ts`), so they show 'STRING' as written. The default is
      applied inside the front-end only where nothing is rendered (SIZEOF, `types/builtins.ts:212`; a constant's fold,
      `types/const/fold.ts:89`). So the default stays transpile-side (type.ts:36-38 stands; putting it in `types/resolve`
      would turn 564 recorded 'STRING's into 'STRING(80)'). `commonType` (`types/arith/runtime.ts:22`, `length ?? 0`) has NO
      caller outside `src/transpile` (`lower/values/{convert,promote}.ts` only): no LSP-visible consequence, so the appendix
      item closes with M7 as the reason, and inside lowering it disappears with 3.3 (every Type carries its capacity).
    - Found on the way (LSP, handed off): the front-end types `s[i]` on a STRING/WSTRING UNKNOWN (26 reads in the fixtures
      before, +53 per vendor in these nine, 5 in the corpora — all pro2193) → `lsp-transpile-review-gaps` 2.3; each new
      fixture's count is a named ceiling exception (`test/frontend/baseline.ts` `STRING_INDEX_ROWS`), not a raised ceiling.
    - Ratings: five fixtures diverge and run as expected failures with `deferred.transpile` naming what was measured and
      the task that closes it — `string_literal_nul_tail`, `wstring_literal_nul_tail`, `string_assign_tail_wide`,
      `wstring_assign_tail_wide` (M2's kept destination tail, 3.6) and `string_conversion_result_capacity` (the 255 cut,
      3.8); four are `confirmed` (`string_assign_tail_narrow`, `wstring_assign_tail_narrow`, `string_compare_tail`,
      `concat_result_capacity`). `rate:fixtures`: confirmed 2813 → 2817, diverges 5 → 10, lowered 3229 → 3238 (arith 1545/1543
      → 1546/1544, control 159/148 → 160/149, aggregate 142/142 → 145/145, call 268/266 → 272/270), edge agree 3044 → 3053
      (disagree 0, not-run 185), pedantic 30874 → 31524 (+650, the nine fixtures' own), dead_code 5263 → 5398, shapes 1720
      → 1729. `test/frontend` baselines rewritten (`VOLT_WRITE_BASELINE=1`; counts only, no finding; `ceilings.json`
      unchanged): files 10740 → 10758, expressions +713 per vendor, literal UNKNOWN +220 per vendor, index UNKNOWN 26 → 79 /
      25 → 78 (the excepted rows), literals stored 4662 → 4735, recorded values 9126 → 9409.
    - Tests: `bun typecheck` clean; `test/conformance` (full, once) 6227 pass, 389 todo, 0 fail, 10 diverge as expected
      failures; `test/frontend` 45 pass, 0 fail; `bun run lint` exit 0 (no new warning).
  - Gate 3a (2026-10-08): four review findings, all fixed (none skipped).
    - (1) The 211 kept as a fixture: `string_conversion_result_tail` dumps units [199..262] of `STRING_TO_WSTRING(n200)`
      stored into a zero WSTRING(400) and into a 'Z'-filled one, and of the WSTRING_TO_STRING twin. CODESYS: [199] the last
      character, [200] 0, [201..254] residue (address bytes, e.g. 54050 32761 = 0x7FF9D322), [255] 0, 'Z' from [256]
      (`zWideKept` = `zNarrowKept` = 137 of [263..399]); the zero destination counts 211 non-zero units. A second
      `record:exec` of the same fixture recorded DIFFERENT residue bytes (6188 62 → 16943 203 at [201..202], …), so the tail
      is stack residue: the result is a 255-unit buffer and only its extent is askable. New fixture field
      `LanguageTest.residue` (beside `wallClock`, `support/fixture-suite.ts` `reproducible`/`uncompared`): the replays compare
      every other path and hold residue paths only to being produced; 163 paths here, 47 in (2).
    - (2) M2's scope measured: `string_store_function_result_tail` (CONCAT, LEFT, WSTRING_TO_STRING, a user FUNCTION
      returning STRING(10) with 'efghij' behind a 0) and `string_store_destination_kinds_tail` (ARRAY element, STRUCT member,
      VAR_IN_OUT, FB VAR_INPUT), each over 'Z' and dumped [0..20]. Every one follows M2 with `n` = the source's declared
      capacity: the user FUNCTION and the four destinations carry eleven bytes ('efghij' included) and keep 'Z' at [11..19];
      the three library results (n = 255) write all 20 units plus the terminator, residue behind their own terminator. M2's
      text above now states the measured scope and what is not measured.
    - (3) Build recordings: the nine 3.1 fixtures and the three new ones recorded with `record:language` on both vendors
      (`ide.ps1 -Instance transpile-restructure`, CODESYS fixture copy, TwinCAT `-Fixture 13`): all twelve build; the only
      messages are the two `String constant '...' too long for destination type 'STRING(3)'` / `'WSTRING(3)'` warnings
      (the `three` initializers; CODESYS twice, TwinCAT once), which the LSP gives — `lsp-replay` agrees, the diagnostic
      census moves by counts only (stringConstantTooLong TP 78 → 82 / 37 → 39, fixtures measured 5114 → 5126).
    - (4) `wstring_literal_nul_tail` asks every cell the STRING twin asks: a sizeless `bare : WSTRING := "ab$0000cd"` (97 98
      0 99 100 0 0 …, as `bare` in M1) and `lenLit`/`lenAssigned`/`lenCopy` (counted to the first 0 — LEN takes a STRING —
      all 2). M3's claim now holds on what is recorded.
    - Ratings: the three new fixtures diverge (the kept 'Z', task 3.6; the conversion one also 3.8) with `deferred.transpile`;
      `rate:fixtures`: mapped 5379 → 5382, confirmed 2817, diverges 10 → 13, lowered aggregate 145 → 146, call 272/270 → 274/272
      (lowered/clean), edge agree 3053 → 3056 (disagree 0, not-run 185). `test/frontend` baselines rewritten, counts only
      (`STRING_INDEX_ROWS` +3 rows, `wstring_literal_nul_tail` 5 → 9; index UNKNOWN 79 → 124 / 78 → 123, recorded values
      9409 → 9810); `lsp-transpile-review-gaps` 2.3's count updated (+98 per vendor).
    - Tests: `bun typecheck` clean; `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8575 pass, 35
      skip, 432 todo, 0 fail (9042 tests, 304 files, 507 s), 13 diverge as expected failures, fold agreement 420 compared,
      38 disagree, 38 known; `bun run test:corpus` 19 pass, 1 skip, 0 fail; `bun run lint` exit 0 (no new warning);
      `openspec validate` valid; `bun run check` 18 passed.
- [x] 3.2 Design "§3.2 Decision: strings".
  - What: the representation (a/b/c) in TS and Rust (incl. the `B = n+1` const parameter), literal NUL, assignment across capacities,
    comparison, conversion capacity, where the capacity default is applied (transpile-side, per type.ts:36-38 unless M7 contradicts), the
    commonType item per M7, the tests that change and why.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 3.1.
  - Done (2026-10-08): design.md "§3.2 Decision: strings", committed alone in 9e6a30efcc (no code). One store rule for every
    string, M2's (`min(n, m)` units of the source buffer, a 0 at `min(n, m)`, the destination's units behind left alone; `n` a
    literal's own unit count or 255 for a library/conversion result). Representation: option (c) WITHOUT the tail array — the
    JS string holding the whole buffer (`held`) and `IecStr<T, N>` with the terminator at N implied, as landed in
    transpile-review; deciding measure M6 (197 string fixtures interpret in 11.8 ms). Rejected (a) `Uint8Array(n+1)` /
    `IecStr<B = n+1>` (a mutable buffer inside the immutable `IrValue` needs a clone at every copy site; byte N only ever holds
    0, so B = n+1 carries nothing), (b) (its cached `len` bought nothing, 4.0 vs 4.1 ms) and the tail array (one buffer already
    holds the tail). The store reads its destination: `storeString(dst, m, src, n)` in `semantics/store.ts`, Rust
    `dst.store(&src)` (`&mut self`; lean 4.3 falls out). Literal `$00` keeps every decoded unit (3.7). Conversions: operand cut
    to 255, result STRING(255)/WSTRING(255) — M5 contradicts RC 11's "sized by the source", so 3.8's What is rewritten below;
    the residue tail is written 0 and held only to being produced. Capacity default in `lower/core/lowering.resolve`
    (`withStringCapacity` goes at 3.3, conversions.ts's `sized` at 3.8 with the 255 rule), `types/resolve.ts` unchanged (M7: 564 recorded messages print
    'STRING'); the `commonType` appendix item closes with M7 as the reason. Stays refused: `assign-string`,
    `string-escape` in `stringLiteralText`. The eight string divergences (of 13) flip at 3.6
    (kept destination tail: `string_assign_tail_wide`, `wstring_assign_tail_wide`, `string_store_function_result_tail`,
    `string_store_destination_kinds_tail`), 3.7 (`string_literal_nul_tail`, `wstring_literal_nul_tail`) and 3.8
    (`string_conversion_result_capacity`, `string_conversion_result_tail`); a design step turns none of them.
  - Gate 3b (2026-10-08) — review findings on the 3.2 text, all five fixed (docs only, no code):
    1. `sized` was moved into 3.3 although the 255 rule replacing it arrives at 3.8 (the conversion target is built from the
       name, sizeless, so 3.3 would default it to 80 and regress the confirmed `tr_11`). Fixed: `sized` goes at 3.8 (3.3's
       What/Where, 3.8's What, design §3.2 "Capacity default" and "Migration"); 3.3's Where now names every
       `withStringCapacity` caller (conversions.ts, system.ts, places.ts, enums.ts).
    2. 3.6 and 3.7 Accepts did not ask for the divergences they exist for (3.7 asked F on the already-confirmed `tr_45`).
       Fixed: 3.6 asks F of the four kept-destination-tail fixtures, 3.7 of the two literal NUL tails, `tr_45` stays confirmed.
    3. §3.2's conversion rule covered same-width TO_STRING >255 and string->number parses >255 without a measurement.
       Fixed: both stated unmeasured, today's own-capacity rule kept, and 3.8 records `string_conversion_same_width_255` and
       `string_parse_beyond_255` before writing their rule.
    4. `tr_34_lib_prim_char_behind` was listed refused `pointer-type` until 4.12; it is confirmed and lowered
       (`pointers/address.ts`). Fixed in design §3.2 "Stays refused", this note and 3.6's Accept.
    5. A function VAR_INPUT destination was declared to "start zeroed" — unmeasured, and stack buffers carry residue (gate 3a).
       Fixed: design §3.2 no longer claims 0; 3.6 records `string_store_function_input_tail` and its recording decides rule
       vs residue.
    - Numbers (no code or fixture changed, so no `rate:fixtures`): `bun typecheck` clean; `bun test` (VOLT_REQUIRE_FULL=1,
      VOLT_FIXTURES unset, rustc cache on) 8575 pass, 35 skip, 432 todo, 0 fail (9042 tests, 304 files, 513 s) — unchanged
      from gate 3a; `bun run test:corpus` 19 pass, 1 skip, 0 fail; `bun run lint` exit 0; `openspec validate` valid;
      `bun run check` 18 passed.
- [x] 3.3 Every string Type the transpiler holds carries its capacity.
  - What: `core/lowering.resolve` applies `DEFAULT_STRING_LENGTH` to every sizeless STRING/WSTRING it returns; `withStringCapacity`
    (`storage/layout.ts`) is deleted, its callers taking the resolved capacity or the default by name; `builtins/conversions.ts`'s
    `sized` STAYS (it sizes a STRING<->WSTRING result and a wide parse's narrowed STRING by the operand; the conversion's
    target is built from its name, sizeless, and would otherwise default to 80 — the cut RC 11 removed; it goes at 3.8 with the
    255 rule). `types/resolve.ts` is unchanged. The appendix item "commonType treats a sizeless STRING as capacity
    0" is closed with M7 as the reason, per 3.2.
  - Where: `lower/core/lowering.ts`, `lower/storage/layout.ts`, `lower/builtins/conversions.ts`, `lower/builtins/system.ts`,
    `lower/places/places.ts`, `lower/values/enums.ts` (the `withStringCapacity` callers).
  - Accept: G+LSP (LSP output byte-identical unless 3.2 names the change); S-out (list any Rust that printed capacities differently).
  - Depends: 3.2.
  - Done (2026-10-08, step 3c): `Lowering.resolve` sizes every sizeless STRING/WSTRING it returns, array elements included
    (`Lowering.sized`, `lower/core/lowering.ts`); `withStringCapacity` deleted — enums.ts takes the resolved type, system.ts
    (`__POUNAME`) and conversions.ts (`defaultCapacity`, the conversion's NAMED type, sizeless) name `DEFAULT_STRING_LENGTH`,
    places.ts takes the place's own capacity, and `storageOf` sizes a POINTEE's string by the same default (a `POINTER TO
    STRING`'s target is resolved with the pointer, not by `resolve`). `sized` stays (3.8). A capacity the declaring scope
    cannot fold (`unfoldedLength`) was silently 80; it is refused by name, `string-capacity` (not-modelled), so
    `decl_string_length_variable` (`STRING(n)` over a VARIABLE, refused by CODESYS) no longer lowers. The literal half was
    already done: `lowerLiteral` typed a string const STRING(k). `types/resolve.ts` unchanged; the `commonType` appendix item
    closes with M7 as the reason (no caller outside `src/transpile`). Layering: the listed violation `values/enums.ts →
    storage/layout.ts` is gone (removed from `KNOWN_TRANSPILE_VIOLATIONS`).
    - S (against a baseline written at 6ed116ac11, all four layers): identical but `decl_string_length_variable` (refused).
- [x] 3.4 `semantics/string.ts` new model plus `semantics/string.cases.ts`; the interpreter runs it.
  - Where: `semantics/string.ts`, `semantics/string.cases.ts`, `string.test.ts`, `interp/frame.ts`.
  - Accept: `semantics/string.test.ts` green on the case table (`tr_34`, `tr_45`, `lib_prim_char_past_length`, M1-M5 cells).
  - Depends: 3.3.
  - Done (2026-10-08, step 3c): `storeString(dst, m, src, n)` in `semantics/string.ts` (§3.2's formula, `held`);
    `semantics/string.cases.ts`: 32 cases under 4 rules (the M2 store narrow/wide and its WSTRING twins; every source and
    destination kind gate 3a measured; the literal as a source of its own units, M1/M3 and `tr_45`; `s[i]` behind the
    terminator, `tr_34` and `lib_prim_char_past_length`), each a variable started at zeros and taken through the stores and
    `s[i] :=` its fixture runs, answering the WHOLE buffer, and naming its fixture and the 360 recorded cells it shows (each
    unit dumped through `s[i]`, each string and length) over 11 fixtures. `string.test.ts` runs the table (4 tests);
    `runtime-twins.test.ts` holds all 360 cells to `codesys.run.json` (a new test).
- [x] 3.5 `emit/rust/runtime/string.ts` new model.
  - Where: `emit/rust/runtime/string.ts`, `emit/rust/types.ts`, `values.ts`.
  - Accept: `runtime-twins.test.ts` runs `semantics/string.cases.ts` through rustc and matches.
  - Depends: 3.4.
  - Done (2026-10-08, step 3c): `IecStr::store<const M>(&mut self, src: &IecStr<T, M>)` in `runtime/string.ts` (min(M, N)
    units, a 0 at k < N, `scan`); `runtime-twins.test.ts` builds the 32 cases through rustc (`IecStr::new` + `store` /
    `with_char`, printing the N units) and every line matches.
- [x] 3.6 Bytes behind the terminator (RC 34).
  - What: a store at or past `len` rescans; every string store follows M2 (design §3.2 Decision): `storeString(dst, m, src, n)`
    writes `min(n, m)` source units and a 0 at `min(n, m)` and keeps the destination behind it (Rust `dst.store(&src)`). A
    same-capacity copy keeping the units is the special case. First record `string_store_function_input_tail` (a STRING(10)
    'abc'+0+'efghij' passed to a FUNCTION's `VAR_INPUT p : STRING(20)`, `p[11..19]` read through `p[i]`, recorded twice):
    its recording decides whether the units behind a fresh-stack destination are a rule or residue (design §3.2).
  - Where: `semantics/string.ts`, `runtime/string.ts`, `lower/places/places.ts` (`s[i]`), the new fixture.
  - Accept: src pipeline test (right-to-left digit fill gives '4321'; 'abcdef' with `t[2]:=0; t[2]:=88` gives 'abXdef');
    F(`string_assign_tail_wide`, `wstring_assign_tail_wide`, `string_store_function_result_tail`,
    `string_store_destination_kinds_tail`); `string_store_function_input_tail` recorded and confirmed (or residue-marked per
    its recording); `tr_34_lib_prim_char_behind` stays confirmed.
  - Depends: 3.5.
  - Done (2026-10-08, step 3c): `string_store_function_input_tail` written and recorded TWICE in one-fixture `record:exec`
    runs (CODESYS 3.5.21.40), identical: `p` = 97 98 99 0 101…106 0 at [0..10], then 'Z' at [11..19] — the units the call
    before left in the same stack frame (a 20-'Z' literal through the same FUNCTION), so `residue: p[11..19]`; build
    recordings on both vendors (`record:language`, `ide.ps1 -Instance transpile-restructure`, CODESYS fixture copy, TwinCAT
    `-Fixture 13`): builds clean, no message. `assignTo(target, value, span)` (`lower/values/convert.ts`) replaces the 15
    `{ kind: "assign", value: convert(…) }` literals; a STRING→STRING / WSTRING→WSTRING of another capacity passes
    unconverted (a sizeless side is a `LoweringBug`). Interpreter: `compileWrite(place, source)` / `Frame.write(…, source)`
    store `storeString(prior, m, v, n)` for an assign of a string into a string (`machine.ts` `stringSource`); call inputs,
    bindings and the runner keep `storeAs`. Rust: `place.store(&v)` where the capacities differ or a STRING VAR_IN_OUT is on
    either side, `place = v` at one capacity (the whole copy) — no `.to()` behind an assign any more (design §3.2 "As
    built"). Found on the way and fixed: `__QUERYINTERFACE` into a STRING (`ar_queryinterface_type`, refused by CODESYS)
    stored a BOOL into a string buffer — `queryInto` now refuses it `assign-string`.
    - F: `string_assign_tail_wide`, `wstring_assign_tail_wide`, `string_store_function_result_tail`,
      `string_store_destination_kinds_tail` confirmed (marks removed); `tr_34_lib_prim_char_behind` stays confirmed;
      `string_store_function_input_tail` confirmed. Src tests: `pipeline/strings.test.ts` (wide store keeps 'Z', a literal
      over 'Z', an FB VAR_INPUT pass, `tr_34`'s '4321' and 'abXdef'), `emit/rust/stmt.test.ts` (store vs plain copy, the
      in-out store).
    - S-out (against 6ed116ac11): outputs and edge identical but the eight flipped/new string fixtures, the two now refused
      (`decl_string_length_variable`, `ar_queryinterface_type`) and two edge-seeded runs (`lib_prim_char_past_length`,
      `tr_34_lib_prim_char_behind`: a seeded 'AAAA…' buffer keeps its tail behind a shorter store, both backends alike, edge
      agree). Rust: 225 fixtures' code changed (`.to()` dropped / `.store(&…)`), 147 more by the prelude's three `store`
      lines alone. NOTES: 65 constructs re-keyed to the 70 that replaced them (five split into a store and a plain-copy form,
      the note copied to both); their tasks unchanged (7.4.1-7.4.3 still own the `.to()`/with_char items they name).
- [x] 3.7 `$00` in a literal (RC 45).
  - What: the literal valuation keeps the decoded units; `values/literals.stringLiteralText` builds a buffer whose `len` is the first 0,
    the bytes behind per M1. If frontend-conformance closed the decoding half (0.1), only the lowering half remains.
  - Where: `frontend/syntax/literal/value.ts`, `lower/values/literals.ts`.
  - Accept: F(`string_literal_nul_tail`, `wstring_literal_nul_tail`); `tr_45_string_embedded_nul` stays confirmed; G+LSP; M.
  - Depends: 3.6.
  - Done (2026-10-08, step 3c): nothing left to lower — `decodeStringLiteral` keeps every decoded unit (`$00` and what
    follows) and `lowerLiteral` types the const STRING(k)/WSTRING(k), so with 3.6's store a literal is a source of its own
    units: F(`string_literal_nul_tail`, `wstring_literal_nul_tail`) confirmed at 3.6 (their marks named 3.6);
    `tr_45_string_embedded_nul` stays confirmed; LSP unchanged (`lsp-replay` green, `test:corpus` 19 pass).
    - M (`rate:fixtures`, 3.3-3.7 together): mapped 5382 → 5383; confirmed 2817 → 2824, diverges 13 → 7 (refused 1989,
      unchanged); lowered decl 755/755 → 758/758, arith 1546/1544 → 1542/1540, control 160/149 → 159/148, call 274/272 → 275/273
      (three `str_assign_into_*` and `string_assign_truncation` move arith → decl: their assign holds no convert node now);
      edge agree 3056, disagree 0, not-run 185 → 184; median size 3.1 → 3.1 (string fixtures' median 5.1, no fixture's size
      moved — one line replaced by one); pedantic 31843 → 31848; dead_code 5443 → 5448, clippy::self_assignment 34 → 39
      (`s := s` on a string printed `s = s.to()` and now `s = s`, which clippy names); notes resolved: none (re-keyed, 3.6).
      `test/frontend` baselines rewritten, counts only (`STRING_INDEX_ROWS` + `string_store_function_input_tail` 3; index
      UNKNOWN 124 → 127 / 123 → 126, recorded values 9810 → 9855); `lsp-transpile-review-gaps` 2.3's count +3.
    - Tests: `bun typecheck` clean; `test/conformance` (full, once) 6240 pass, 389 todo, 0 fail, 7 diverge as expected
      failures; `test/frontend` 45 pass; `src/transpile` 394 pass; `test/libraries` 23 pass; `bun run test:corpus` 19 pass,
      1 skip; `bun run lint` exit 0 (PLANNED `semantics/string.cases.ts` removed — it exists); `bun test scripts` 37 pass;
      `bun run check` 18 passed.
  - Gate 3c (2026-10-08) — review findings on 3.3-3.7, each fixed with its test first:
    1. (3.3, medium) `storageOf` still sized a POINTEE's string 80 without asking `unfoldedLength`: `POINTER TO STRING(n)` /
       `REFERENCE TO STRING(n)` over a variable or an invisible constant lowered as STRING(80). Fixed: `storageOf` sizes a
       sizeless pointee string through `Lowering.sized` (now public), the same refusal `string-capacity`. Test
       `storage/layout.test.ts` (variable, REFERENCE, unknown constant). No fixture moved (refused 1989 unchanged).
    2. (3.6, medium) `string_store_function_input_tail`'s `residue` mark did not meet `LanguageTest.residue` (memory no
       program wrote). Measured as the review asked: the first call's literal changed to 20 'Y' and re-recorded
       (`record:exec`, one batch with 3's fixture): p[11..19] = 89 — it FOLLOWS the previous call (90 after 'Z'), a
       deterministic carry-over of the function's frame. `residue` removed; a known divergence (`deferred.transpile`):
       "niche: accepted loss (0 occurrences in the corpora)" — of the corpora's FUNCTIONs with a STRING/WSTRING VAR_INPUT,
       none indexes it. Build recordings re-taken on both vendors (`ide.ps1 -Instance transpile-restructure`, TwinCAT
       `-Fixture 13`): clean.
    3. (3.6, low) `assignTo`'s store reached `=>` copy-out unrecorded. `string_store_destination_kinds_tail` gains an FB
       VAR_OUTPUT STRING(10) copied out by `fbOut(o => viaOut)` into a 'Z'-filled STRING(20), recorded: 97 98 99 0 101…106 0,
       then 90 at [11..19] — the tail is kept, as the code already did (fixture stays confirmed; src test
       `pipeline/strings.test.ts`). The UNION half is skipped: a UNION with a STRING member is refused `layout-union` (only
       measured-integer or all-pointer members lay out, `unions.ts`), so `unionCopies` never stores a string. SEL/MUX of a
       narrow meet stays with 3.8/3.9 (a function-result source).
    4. (3.6, low) Re-keyed notes described the `.to()` 3.6 removed (1c341ca22f on `x = str;`). 7.4.1 ticked as resolved by
       3.6 and its pure `.to()` items removed with 7.4.2's shapes15_1 (24 notes gone, 10 shrunk; two items re-owned, see
       7.4.1): NOTES 728 → 704.
    5. (3.3, low) `string-capacity` never named what did not fold, and came twice per declaration. Fixed: `types/resolve.ts`
       keeps `lengthText` on an `unfoldedLength` capacity too (render unchanged — it prints a sizeless name), the message is
       "the capacity of STRING(n) does not fold here"; `storage/declare.ts` resolves a declaration once (`startValue` takes
       the resolved type for its enum default). Test `core/lowering.test.ts`.
    - M (`rate:fixtures`): mapped 5383; confirmed 2824 → 2823, diverges 7 → 8 (`string_store_function_input_tail`),
      refused 1989; edge agree 3056, disagree 0, not-run 184; pedantic 31848 → 31858 (the `=>` cells); constructs 1838 →
      1839; notes 728 → 704. Baselines rewritten, counts only: `STRING_INDEX_ROWS` destination_kinds 9 → 12 (index UNKNOWN
      127 → 130 / 126 → 129), recorded values 9855 → 9878, fixtures measured +1 (the function-input build recording).
    - Numbers: `bun typecheck` clean; `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on) 8598 pass,
      35 skip, 432 todo, 0 fail (9065 tests, 304 files, 502 s); `bun run test:corpus` 19 pass, 1 skip; `bun test scripts`
      37 pass; `bun run lint` exit 0; `bun run check` 18 passed; `openspec validate` valid.
- [x] 3.8 Conversions without the 80 cut (RC 11).
  - What: (rewritten by §3.2 Decision on M5) a STRING<->WSTRING / TO_STRING / TO_WSTRING of a string cuts its operand to 255 on
    the way in and its result Type is STRING(255)/WSTRING(255) — not sized by the source; the units behind the result's
    terminator are written 0 (stack residue in CODESYS, `LanguageTest.residue`). Number->STRING conversions unchanged.
    `sized` is deleted here (not at 3.3). First record, in one batch, the two neighbours M5 did not measure:
    `string_conversion_same_width_255` (TO_STRING of a STRING(300), TO_WSTRING of a WSTRING(300)) and
    `string_parse_beyond_255` (STRING_TO_INT, WSTRING_TO_INT and TO_INT of 290 spaces then '5'); their recordings decide
    whether the 255 cut reaches them — until then they keep the operand's own capacity.
  - Where: `lower/builtins/conversions.ts`, the two new fixtures.
  - Accept: F(`string_conversion_result_capacity`, `string_conversion_result_tail`); the two new fixtures recorded and
    confirmed; `tr_11_string_conversion_beyond_80` and `xo3_string_wide_conversions` stay confirmed; M.
  - Depends: 3.6.
  - Done (2026-10-08, step 3d): the four fixtures of the step written first and recorded in ONE `record:exec` batch
    (CODESYS 3.5.21.40 simulation, 4 cases, 0 failed) and one `record:language` run per vendor (`ide.ps1 -Instance
    transpile-restructure`, CODESYS fixture copy, TwinCAT `-Fixture 13`): all build clean on CODESYS; TwinCAT builds the
    three string ones clean (`lib_stu_replace_past_len`'s TwinCAT recording withdrawn — no StringUtils there, see design
    §3.2 step 3d "As built"). `string_conversion_same_width_255`: 80 and 80 — neither rule offered; a same-width
    TO_STRING / TO_WSTRING gives the named type at the default capacity (was refused "not measured yet", now lowered).
    `string_parse_beyond_255`: 290 spaces then '5' → 0, 250 → 5, on STRING_TO_INT, TO_INT, WSTRING_TO_INT, TO_INT — the
    255 cut. `stringConversion` (`lower/builtins/conversions.ts`): a cross-width result is STRING(255)/WSTRING(255)
    (`CONVERSION_RESULT`), a same-width one and a number's text the default 80, a parse cuts an operand wider than 255
    (a wide one narrowed to STRING(min(n, 255))); `sized` deleted; a string operand without a capacity is a `LoweringBug`.
    - F: `string_conversion_result_capacity`, `string_conversion_result_tail` confirmed (marks removed);
      `string_conversion_same_width_255`, `string_parse_beyond_255` confirmed; `tr_11_string_conversion_beyond_80`,
      `xo3_string_wide_conversions` stay confirmed. Src tests (`builtins/conversions.test.ts`, red before the change): the
      255 result with the 'Z' kept from [256] (144), the same-width 80 and the parse at 255.
- [x] 3.9 Tests that pinned the old model.
  - What: `pipeline/strings.test.ts`, `semantics/string.test.ts`, `builtins/conversions.test.ts`, `places/places.test.ts`,
    `builtins/value-functions.test.ts`, `pointers/cursor.test.ts`, `test/libraries/{standard,stringutils}.test.ts`: each changed
    expectation cites its recording.
  - Where: those files.
  - Accept: G; the diff lists every changed expectation with its recording.
  - Depends: 3.8.
  - Done (2026-10-08, step 3d): every listed file run against the new model — `pipeline/strings.test.ts`,
    `semantics/string.test.ts`, `builtins/conversions.test.ts`, `places/places.test.ts`, `builtins/value-functions.test.ts`,
    `pointers/cursor.test.ts`, `test/libraries/{standard,stringutils}.test.ts` — and NO existing expectation failed: the
    old model's pins were already replaced at 3.4-3.7 (each citing its recording there). Changed expectations: none.
    Changed text: one comment in `conversions.test.ts` ("keeps the operand's own capacity past 80" now says up to 255,
    citing `string_conversion_result_capacity` / `string_parse_beyond_255`). Added: the three 3.8 tests, the 3.10 cursor
    test, the two 3.11 `stringutils.test.ts` cases — each citing its fixture.
- [x] 3.10 Whole-string cursor store (appendix).
  - What: record `cursor_whole_store_capacity`; fix it or refuse it by name.
  - Where: `lower/pointers/cursor.ts`.
  - Accept: recorded; F or a named refusal; M.
  - Depends: 3.9.
  - Done (2026-10-08, step 3d): `cursor_whole_store_capacity` recorded (in 3.8's batch): through a local POINTER TO
    STRING(20) and through a FUNCTION's pointer input alike, `p^ := ten` (STRING(10)) into a STRING(5) writes eleven bytes —
    'abcdef' over the six of `head` (no terminator: its value is unreadable) and 'ghij' + 0 into the 'Z'-filled neighbour.
    Neighbour overwritten → refused `cursor-overrun` (new code, not-modelled) where `min(n, m_ptr) > m_c`
    (`pointers/cursor.ts` `refuseCursorOverrun`, asked by `statements/assign.ts` `storeValue`); below it the store is the
    plain one. The fixture rates `not-lowered` (the local pointer form is refused `pointer-type` first, the cursor form
    `cursor-overrun`); `map.test.ts` not-lowered ceiling 389 → 390 with the reason. Corpus: 11 whole-string cursor stores,
    0 refused (design §3.2 step 3d). Src test `pointers/cursor.test.ts` (red first): the overrun refused, a store that fits
    keeps the unit behind its 0.
- [x] 3.11 StrReplaceA past LEN (appendix).
  - What: re-run `STRREPLACEA.fun` on the new model; fix the library body only if it is still wrong against its recording.
  - Where: `libraries/StringUtils/**`.
  - Accept: the `stringutils.test.ts` case green against the recorded value.
  - Depends: 3.9.
  - Done (2026-10-08, step 3d): `lib_stu_replace_past_len` recorded (in 3.8's batch): with `iLengthInput` 12 over
    'abcdefghijkl' := 'abc', CODESYS moves and copies over the whole buffer in place — inside 97 88 89 90 99 0 101…108 0,
    behind (position 6, past LEN) 97 98 99 0 101 88 89 90 103…108 0, shrink 97 88 89 90 103…108 0 108 0 ('aXYZghijkl').
    Today's body disagreed on 25 cells (it copied up to the first 0 and returned at a position past LEN), so
    `STRREPLACEA.pou` changed: the buffer is read and written back whole (`cap + 1` units), the `p > LEN` return is gone,
    `cnt` is bounded by `cap - src` too. `stringutils.test.ts`: `pastLen` 'aXYZghijkl' and `pastLenTail` 108 (red first);
    `lib_stu_replace` stays confirmed. A NOTE on the deleted `WHILE PSTINPUT^[n] <> 0` loop (50f8dcd811, 7.4.4) named a
    construct no fixture emits any more and was deleted (NOTES 704 → 703).
- [x] 3.12 Model delta.
  - What: architecture.md's string paragraph; the map delta (string fixture sizes).
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 3.6-3.11.
  - Done (2026-10-08, step 3d): architecture.md *Strings* paragraph (one buffer, `storeString`, the 255 conversions and
    the 80 ones, the refusals). M (`rate:fixtures`, 3.8-3.11 together): mapped 5383 → 5387; confirmed 2823 → 2828,
    diverges 8 → 6 (left: `string_store_function_input_tail`, niche: accepted loss, and five non-string), not-lowered
    389 → 390 (`cursor_whole_store_capacity`), refused 1989; lowered control 159/148 → 161/150, call 275/273 → 276/273
    (`lib_stu_replace_past_len`, `clippy::too_many_arguments` 2 → 3); edge agree 3056 → 3059, disagree 0, not-run 184;
    Rust changed (shape) in `lib_stu_replace` (size 4 → 3.9, pedantic 96 → 87), `tr_11_string_conversion_beyond_80`,
    `xo3_wstring_across_objects`; median size 3.1 → 3.1, string fixtures' median 3.3 → 3.3 (the two new 2.3 and 2.1, no
    other moved); pedantic 31858 → 32081 (the four new fixtures' own 232, lib_stu_replace −9); dead_code 5448 → 5492;
    constructs 1838 → 1839; notes 704 → 703 (one resolved, 3.11). `test/frontend` baselines rewritten, counts only
    (`STRING_INDEX_ROWS` + the four fixtures, 28 per vendor: index UNKNOWN 130 → 158 / 129 → 157; library index UNKNOWN
    ceiling 49 → 47 — the StrReplaceA body; recorded values 9878 → 10005); `lsp-transpile-review-gaps` 2.3 +28.
    - Tests: `bun typecheck` clean; `bun run lint` exit 0; `test/conformance` (full, once) 6246 pass, 390 todo, 0 fail
      after the ceiling (6 diverge as expected failures); `test/frontend` 45 pass; `src/transpile` 400 pass;
      `test/libraries` 23 pass; `bun test scripts` 37 pass; `bun run check` 18 passed.
  - Gate 3d (2026-10-08): the review's seven findings, fixed first (red test first where code changed):
    1. (3.10, medium) `lowerChain` asked only `refuseImplicitString`, so `x := P^ := SRC` / `P^ := x := SRC` stored past
       the caller's string silently. Fixed: the chain's `:=` link asks `refuseCursorOverrun` too
       (`statements/assign.ts`); src test `pointers/cursor.test.ts` (CSTORECL / CSTORECR refused `cursor-overrun`).
    2. (3.10, medium) an FB output copied out into `P^` (`f(o => P^)`) and `P^` lent to a VAR_IN_OUT STRING(20) wrote past
       a STRING(5) (the in-out left 10 characters in it). Corpus: 0 such bindings or copy-outs in the six corpora (1996
       POINTER TO STRING/WSTRING declarations scanned) — cheap, so refused by name rather than accepted: `fbOutputCopy`
       (`calls/outputs.ts`) and `bindPlace` (`calls/binding.ts`, a writable VAR_IN_OUT / VAR_OUTPUT, by its capacity) ask
       `refuseCursorOverrun`, which now takes the written Type. Src test (CSTORELEND / CSTORECOPYOUT refused into a
       STRING(5), 'abcdefghij' into a STRING(20)).
    3. (3.8, medium) `string_parse_beyond_255` could not tell the 255 cut from "an operand longer than 255 parses 0".
       Cells added and recorded (record:exec): a STRING '5' then 290 spaces → 5 (named, bare), 253 spaces then '12345' → 12
       (named, bare, both widths) — the cut, confirmed. The WIDE '5' + 290 spaces answered 0: measured apart in the new
       `wstring_parse_trailing_spaces` ("5   " in a WSTRING(20), '5' + 254 / 255 / 290 spaces; beside STRING '5   ' → 5):
       every wide one 0 — a WSTRING parse refuses trailing spaces, inside 255 too, not the cut. Both backends narrow and
       answer 5: known divergence, "niche: accepted loss (0 occurrences in the corpora: no WSTRING_TO_* parse, and no user
       POU declares a WSTRING)".
    4. (3.8, medium) the same-width 80 rested on one operand. 100- and 255-unit operands added, both widths, recorded: 80
       for all six — "cut to 80 only above 255" and "identity up to 255" ruled out; the fixture stays confirmed.
    5. (3.11, low) StrReplaceA with `uiInputBufferSize` larger than the caller's string faults at run time (RangeError)
       where CODESYS writes into the neighbour. Not refusable at lowering (a run-time argument); "niche: accepted loss (0
       occurrences in the corpora: the one caller, pro2193 ParseInstanceName, passes 80 for a STRING(80))", noted in
       `STRREPLACEA.pou`.
    6. (3.8, low) the hand-deleted TwinCAT recording of `lib_stu_replace_past_len`: `twincat.build.json` restored to HEAD
       and the recorder run (`ide.ps1 -Instance transpile-restructure -Fixture 13`) on the four string fixtures only
       (`string_conversion_same_width_255`, `string_parse_beyond_255`, `cursor_whole_store_capacity`,
       `wstring_parse_trailing_spaces`; testCount 5119 → 5123, written by the recorder). CODESYS build recordings of the
       three changed/new fixtures re-recorded too; all build clean on both vendors.
    7. (3.10, low) `refuseCursorOverrun` passed silently on a missing capacity. Now: a store of another family is not this
       one (false); a string source, caller or pointee without a capacity throws `LoweringBug`.
    - M (`rate:fixtures`, against 3.12's): mapped 5387 → 5388; confirmed 2828; diverges 6 → 7
      (`wstring_parse_trailing_spaces`); not-lowered 390; refused 1989; lowered control 161/150 → 162/151; edge agree
      3059 → 3060, disagree 0, not-run 184; pedantic 32081 → 32190; dead_code 5492 → 5506; constructs 1839 → 1838 (HEAD's
      count), notes 703. `test/frontend` baselines rewritten, counts only (`STRING_INDEX_ROWS`: same_width 6 → 18,
      parse 12 → 29, `wstring_parse_trailing_spaces` 10 — index UNKNOWN 158 → 197 / 157 → 196; recorded values
      10005 → 10039); `lsp-transpile-review-gaps` 2.3 +132 → +171.
    - Numbers: `bun typecheck` clean; `bun run lint` exit 0; `bun test` (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset, rustc cache on)
      8612 pass, 35 skip, 433 todo, 0 fail (9080 tests, 304 files, 497 s; 7 diverge as expected failures); `bun run
      test:corpus` 19 pass, 1 skip; `bun test scripts` 37 pass; `bun run check` 18 passed; `openspec validate` valid. The
      first full run failed only `test/analysis` census counts (fixtures measured 5127 → 5132 / 5116 → 5120 — 3.8-3.11's four
      fixtures, which 3.12 had not rewritten, and this gate's one), rewritten counts-only.

## 4. Model 3: pointers and references (RC 14, 15, 16, 17, 18, 20, 26, 44)

- [x] 4.0 RC 26: SIZEOF of an FB (the layout the arena option needs).
  - What: skip replaced scalar VAR CONSTANTs; add 8 bytes per implemented interface.
  - Where: `lower/storage/bytes.ts`, over `core/chain.implementsOf`.
  - Accept: F(`mem_fb_var_constant_scalar` 16, `mem_fb_implements_one` 24, `mem_fb_implements_two` 32); `mem_fb_var_constant_non_replaced`
    and `mem_fb_var_constant_struct` stay confirmed; M.
  - Depends: 1.9.4.
  - Done 2026-10-08 (verify in the new home; RC 26 closed upstream at 381a1810ed). All five fixtures confirmed before and
    after, no divergence mark to remove (`mem_fb_var_constant_scalar` 16, `_non_replaced` 24, `_struct` 32,
    `mem_fb_implements_one` 24, `_two` 32). `core/chain.implementsOf(unit)` added (design.md §4's planned name: a unit's own
    IMPLEMENTS list; a PROGRAM none, a base's not included); `storage/bytes.fieldBytes` and
    `interfaces/tags.implementsInterface` read through it (the two readers of `unit.implements`). Found while verifying: the
    8 bytes are measured only for interfaces that EXTEND nothing — an IMPLEMENTS of an interface that EXTENDS another was
    counted as 8 unmeasured; it is now refused `sizeof-unmeasured` (0 interfaces that EXTEND another in the six corpora — corrected at 4a: the one grep hit, pro2193 `Arrays.pou:12`, is a
    comment). Src tests:
    `builtins/sizeof.test.ts` "SIZEOF of an FB implementing an interface that EXTENDS another is refused as unmeasured" (red
    before, green after), `core/chain.test.ts` "a unit's own IMPLEMENTS list ...".
    - M (`rate:fixtures`): no change — mapped 5388, confirmed 2828, diverges 7, refused 1989, not-lowered 390; edge agree
      3060, disagree 0, not-run 184. `map.generated.ts` byte-identical.
    - Numbers (implement agent, targeted + end-of-step): lower/{core,interfaces,storage,builtins} 45 pass; `bun test
      test/conformance` 6248 pass, 390 todo, 0 fail; `bun test test/frontend` 45 pass; `bun typecheck` clean; `bun run lint`
      green. Full suite: the gate's.
  - Gate 4a (2026-10-09). Review findings, both fixed:
    - The niche count was wrong: `grep -rniE "INTERFACE\s+\w+\s+EXTENDS" test-corpus` has one hit, a comment (pro2193
      `99 Library/Functions/Arrays.pou:12`); anchored to a declaration it finds 0. Corrected above; the verdict (refuse,
      not guess) stands.
    - The guard also refused an EMPTY chain (an IMPLEMENTS name that resolves to no interface declaration) under the
      EXTENDS reason. Kept as a refusal — whether such an interface EXTENDS anything is unknown, and before 4.0 it was
      answered 8 bytes like a measured one — but named: `storage/bytes.implementedInterfaces` (split out of `fieldBytes`,
      which the size check put at 84 lines) refuses a chain longer than 1 and an empty chain as two separate, documented
      cases. Src test `builtins/sizeof.test.ts` "SIZEOF of an FB implementing a name that is no interface declaration is
      refused as unmeasured" (pins the existing refusal: red with the empty-chain check removed, green with it).
    - M (`rate:fixtures`): no change — mapped 5388, confirmed 2828, diverges 7, refused 1989, not-lowered 390; edge agree
      3060, disagree 0, not-run 184. `map.generated.ts` byte-identical.
    - Numbers: `bun typecheck` clean; `bun run lint` exit 0 (no function over 80 lines); `bun test` (VOLT_REQUIRE_FULL=1,
      VOLT_FIXTURES unset, rustc cache on) 8615 pass, 35 skip, 433 todo, 0 fail (9083 tests, 304 files, 648 s; 7 diverge as
      expected failures) — +3 over 3d's 8612 (4.0's two src tests, 4a's one); `bun run test:corpus` 19 pass, 1 skip;
      `bun test scripts` 37 pass; `bun run check` 18 passed; `openspec validate` valid.
- [x] 4.1 Measure.
  - What: the census starting from `transpile-st-to-rust/pointer-model.md` (re-run parse-based, diffed against 2026-09-20): every
    `indirect` fixture, every not-lowered pointer/any/interface/call-fb-inout row (`scripts/probe-lowering-refusals.ts`), every pointer
    `rejects` fixture, each with its predicted verdict under (a) tags, (b) arena, (d) per-pointer enum. A spike of (a), (b), (d) on the
    ten fixtures of design.md §3.3. New recordings: `pointer_to_dword_roundtrip`, `pointer_order_compare`, `adr_difference_two_arrays`,
    `pointer_byte_walk_struct_padding`, `pointer_step_past_end`.
  - Where: this file (census table, spike numbers); fixtures in `test/conformance/fixtures/memory/`.
  - Accept: the census table here; recordings committed.
  - Depends: 4.0.
  - Done 2026-10-09 (at 3dfe0444e3; single-use scratch probes for the census, the predictions, the escape classes and the
    spike, deleted — nothing under `scripts/`; `scripts/probe-lowering-refusals.ts` run as it is). No product code changed.
    - New recordings (`test/conformance/fixtures/memory/pointer-model.ts`, `POINTER_MODEL_TESTS`, six fixtures, each in an FB
      so its layout is the declarations'; `record:exec` ONE batch, CODESYS 3.5.21.40 simulation, 6 cases, 1 refused at build;
      `pointer_to_lword_roundtrip` re-recorded alone after its LWORD moved to VAR_TEMP — the first recording read the
      address itself, which no run reproduces; `record:language` on both vendors, `ide.ps1 -Instance transpile-restructure`,
      CODESYS fixture copy and TwinCAT `-Fixture 13`: all build clean except the DWORD one, which both refuse identically):
      - `pointer_order_compare`: pointers ORDER as addresses — `ADR(arr[1]) < ADR(arr[3])` TRUE, `>`/`>=` FALSE, `<=` TRUE,
        `p <= ADR(same)` TRUE, `p < ADR(same)` FALSE; two members of one instance order by declaration (`first < second`).
      - `adr_difference_two_arrays`: two arrays of one FB are contiguous (`ADR(second[0]) - ADR(first[0])` = 8 for a 4-INT
        `first`; within = 6); a pointer stepped by that difference reads the OTHER array (crossed = 21, crossedLast = 23).
        The reverse difference stored into a LINT is 4294967288 (2^32 - 8): the difference of two addresses is a 32-bit
        unsigned value on the 64-bit simulator, widened by zero extension.
      - `pointer_byte_walk_struct_padding`: `STRUCT b BYTE; d DWORD; w WORD; c BYTE` is SIZEOF 12, laid out
        17 0 0 0 | 161 162 163 164 | 177 178 | 193 0 — padding bytes 0, little-endian; `ADR(sv) + 5 := 16#FF` changes byte 1
        of `d` (16#A4A3FFA1 = -1532756063), a byte store at `ADR(sv.w)` its low byte (16#B2EE). `storage/bytes.ts` agrees.
      - `pointer_step_past_end`: `ADR(arr[3]) + SIZEOF(INT)` is not NULL, reads the variable declared after the array
        (99) and a store through it writes that variable (77); stepping back reads arr[3] (44). Today both backends lower it
        as element tag 4 and FAULT ("array index 4 is outside its bounds"): rated `diverges`, run as an expected failure
        (`deferred.transpile` names 4.2/4.4).
      - `pointer_to_lword_roundtrip`: a pointer through an LWORD and back (stepped there by SIZEOF(INT)) dereferences
        correctly (22, then 33), compares equal to the original and is non-zero.
      - `pointer_to_dword_roundtrip`: refused by both vendors at build, "Cannot convert type 'POINTER TO INT' to type
        'DWORD'" and back; the LSP refuses it too (`refused`).
    - Census of the fixtures (5394 mapped, at this step's map):
      | group | rows | (a) tags | (b) arena | (d) enum |
      |---|---:|---|---|---|
      | tier `indirect`, lowered (design.md's "185" was 2026-09-29; 360 now): 70 vendor-refused, 5 hold a pointer, 285 do not (bit access, in-out copies, dispatch, global roots) | 360 | the 285 and the 70: unchanged | unchanged | unchanged |
      | lowered with POINTER/REFERENCE/ADR/REF= in the source, any tier, not vendor-refused (77 confirmed, 4 lsp-gap, 1 unaskable, 1 diverges; call 27, decl 26, aggregate 12, arith 9, indirect 5, control 4) | 83 | keep | keep 69 if the arena holds every escaped variable; 12 escape an FB instance (`mem_reference_to_fb_*` ×4, `mem_pointer_deref_method`, `mem_pointer_to_instance_method`, `mem_pointer_to_pointer_member`, `mem_private_method_via_*` ×2, `refdecl_to_fb`, `xo_reference_to_fb_call`, `xo_reference_property`) whose field offsets `bytes.ts` does not have (the header's position is unmeasured), 1 a WSTRING (`lib_stu_wide`, unmeasured) — measured first or refused; `pointer_step_past_end` confirms | keep |
      | not lowered, a pointer code, not vendor-refused — byte view (`pointer-value` 16, `pointer-type` 11, `adr-offset` 2, `pointer-step` 1, `cursor-overrun` 1; at 4b `cv_xword_into_pointer` joins as `pointer-value` — an LWORD stored into a pointer, mis-coded `pointer-order` — and `pointer_order_compare` leaves for the row below) | 31 | refused by that code | lowers | refused by that code |
      | not lowered — a target in another frame (`pointer-order`/`pointer-foreign`/`pointer-place`/`copy-instance-pointer`: the `ptrparam_*` five, `cc_fp_ptr_deref`, `cv_pointer_to_other_pointee`, `cv_reference_to_pointer`, `cv_pointer_deref_to_reference_values`, `ty_array_of_pointer`, `use_pointer_deref_struct_field`, `tr_15`; 13 → 12 at 4b, `cv_xword_into_pointer` moved to the byte view) | 12 | lowers with a program-wide target registry and per-call lending (pointer-model.md's "foreign half", ~ the interface module's size) | lowers | as (a) |
      | `pointer_order_compare` (`pointer-value`; moved here at 4b) — `<`/`<=` on two pointers into ONE array, and on two members of ONE instance: answered by element indices and the instance's declaration order, no byte address | 1 | lowers (element tags; the field order the layout has) | lowers | lowers |
      | `tr_16_fb_copy_carries_inout_binding` (`call-fb-inout`) | 1 | lowers (an arm per binding tag) | lowers | lowers |
      | not lowered for a reason no pointer model touches (`call-inout-alias` 5, `place-not-local` 3, interface codes 3 incl. `tr_18`) | 11 | unchanged | unchanged | unchanged |
      | `calls_adr_on_bit_access` (`pointer-shape`: ADR of a BIT) | 1 | refused | refused (a bit has no measured byte address) | refused |
      | `newdel_*`/`op_sys_new_delete` (unaskable: no memory pool in the recording project) | 7 | refused `pointer-value` | `stmt-call_stmt` stays | refused |
      | rejects: vendor-refused with POINTER/REFERENCE/ADR in the source (71 named for pointers; lowering also refuses 39 with a pointer code, lowers 19 — the LSP refuses them) | 87 | unchanged (the front-end refuses) | unchanged | unchanged |
      Rule, applied mechanically per row (one code decides a row: R before "unchanged" before L*): `pointer-value`, `-type`,
      `-step`, `adr-offset`, `cursor-overrun` need byte addresses → (b) only; `pointer-order`, `-foreign`, `-place`,
      `copy-instance-pointer` need a cross-frame target set → (a)/(d) with the registry, (b) without; `call-fb-inout` → all. A `pointer-order` that only FOLLOWS a refused store of the same variable is no code of its own (4b: lowering repeats the store's code there).
      Overrides read from the source: `tr_15` (its `pointer-value` is an EQUALITY with an ADR, which program-wide tags
      answer — the spike below), `calls_adr_on_bit_access`, `cv_pointer_deref_to_reference_values` (ADR(p^) is p), and at 4b `pointer_order_compare` (an ORDER of two pointers into one target, as `tr_15`'s equality: element tags and declaration order answer it).
      Fixtures lowering for the first time: (a) 14 (12 need the registry; at 4b `cv_xword_into_pointer` out, `pointer_order_compare` in), (b) 45 plus `pointer_step_past_end` confirmed and
      13 lowered rows at risk until FB/WSTRING layouts are measured, (d) 14 (as (a)). RC fixtures: `tr_14`, `tr_20`, `tr_34`, `tr_44`
      are ALREADY `confirmed` (closed upstream: 4.5, 4.6, 4.11's fixture and 4.12's `tr_34` are verification, not work);
      open: `tr_15`, `tr_16`, `tr_17` ×4, `tr_18`, `tr_28` ×2.
    - Census of the corpus (parse-based, Library Manager excluded; six corpora, CodesysTestProject declares none):
      | | 2026-09-20 (pointer-model.md) | 2026-10-09 |
      |---|---:|---:|
      | pointer/reference declarations | 192 | 192 (116 POINTER, 76 REFERENCE; pro2193 121, lenze-mid 32, twincat-project14 21, bakon-nano 12, awa-palletizer 6) |
      | FUNCTION/METHOD VAR_INPUT / FB VAR_INPUT / FUNCTION/METHOD locals / FB VAR | 63 / 36 / 59 / 34 | 64 / 35 / 59 / 34 |
      | targets visible: exactly one / two or more / none | 79 / 13 / 100 (96 parameters) | 50 / 10 / 99 (all parameters) + 33 assigned only non-ADR values (another pointer, a `pValue`, arithmetic) |
      | deref `^` / `p[i]` / `p ± n` / passed to a call / tested against 0 / other compare | 391 / 12 / 88 / 404 / 16 on 10 / 1 | 159 / 6 / 47 / 134 / 10 on 10 / 1; `__ISVALIDREF` 32 on 28 |
      The use counts are a METHOD difference, not a corpus change: this census counts uses in the ST bodies of the declaring
      file only (an FB field from every unit of its file, a routine local from its own body); uses from other files
      (`inst.p^`) and in network-text bodies are not counted, and the 2026-09-20 probe's scope is not recorded (deleted).
      Blockers (`probe-lowering-refusals.ts`, 304 POUs with code: 54 lower, 250 refused; 2026-09-24 had 56 lowered):
      `pointer-order` 177 → 105 (after `REF=`) → 109 (09-24) → 106 → 71 at 4b (35 POUs carried it only as a knock-on of the same variable's refused store); `pointer-value` 81 → 99; `pointer-targets` 1 → 0; now
      also `pointer-outlives` 58, `pointer-type` 42, `pointer-foreign` 12, `pointer-runtime-index` 10, `any-input` 8,
      `pointer-root-input` 7, `call-fb-inout` 2, `pointer-shape` 1; interface codes `interface-type` 151, `-value` 80,
      `-query` 80, `-input` 35, `-place` 21, `-instance` 13, `-call-shape` 10; `call-inout-global` 109. Sole blockers: only
      `pointer-order` (2: `MapperBase`, `MapperOutputs`); 5 POUs are stopped by pointer codes alone (those two and three
      `pointer-root-input`). Every option unblocks the SAME 2 POUs; (b)'s codes appear in 146 POUs, (a)/(d)'s in 106 — at 4b, knock-ons removed, 136 and 71 (overlap 71 → 46).
    - Spike (design.md §3.3's ten fixtures; each option hand-written in ONE style — structs, `call`/`scan`, the fixture's
      semantics only — built with rustc 1.96.0 `-O -F unsafe_code`, linted with clippy pedantic + perf, run, and compared
      with the CODESYS recording on every path it prints; (b) shares a 36-line `Mem` runtime, counted apart). EDGE agreement
      cannot be measured for a hand-written option (it needs the interpreter twin, which (b) and (d) do not have); vendor
      agreement is measured instead. Lines (non-blank, non-comment, above `main`):
      | fixture | (a) | (b) | (d) | note |
      |---|---:|---:|---:|---|
      | `tr_44_pointer_step_below_first_element` | 20 | 20 | 23 | today's emission already biases element tags by 2^32 (RC 44 closed) |
      | `tr_15_fb_copy_keeps_pointer_address` | 30 | 30 | 31 | (a)/(d): b's call is lent a.x by its caller; (b): the copy copies x's bytes, no lending |
      | `tr_17_any_pvalue_dint_via_real` | refused | 17 | refused | (b) reads the DINT's 4 bytes as a REAL |
      | `tr_34_lib_prim_char_behind` | 30 | 29 | 32 | |
      | `state_any_int_pointer_increment` | 13 | 29 | 13 | (a)=(d): specialized per argument type, arms pruned by diSize; (b): one routine over (address, diSize) |
      | `lib_prim_string_cursor_offset` (cursor) | 10 | 11 | 10 | (d) erases to (a) (form 2) |
      | `itf_call_dispatches_on_instance` (interface) | 27 | 27 | 27 | (b) keeps (a)'s tags: an address still has to be matched to the instance's type |
      | `tr_16_fb_copy_carries_inout_binding` (FB copy) | 22 | 21 | 21 | |
      | `type_dut_union` | 10 | 12 | 10 | no pointer: (a)=(d) copy-through stores; (b) the union as its bytes |
      | `lib_stu_length` (StringUtils `StrLenA`/`StrIsNullOrEmptyA`) | 19 | 24 | 19 | (a): specialized per caller capacity; (b): one unspecialized walk |
      | total | 181 (9) | 220 (10) + 36 | 186 (9) | on the nine all three build: 181 / 203 / 186 |
      Every program that builds agrees with CODESYS on every path it prints (4/4, 7/7, 4/4, 8/8, 5/5, 2/2 and 3/3, 5/5, 2/2,
      3/3, 5/5 and 6/6). rustc 187-352 ms each, no option measurably slower; clippy pedantic 0 everywhere except one
      `cast_possible_truncation` in each `state_any_int_pointer_increment` option. Today's EMITTED (a), for scale (map rows,
      string prelude included): `tr_44` 85 lines / pedantic 17, `tr_34` 266 / 61, `state_any…` 155 / 16, cursor 239 / 46,
      interface 114 / 18, union 50 / 8, `lib_stu_length` 256 / 50, all edge `agree`. Cost baselines for 4.2's second
      criterion: tier `indirect` 360 rows, median size 2.6, pedantic 2928 (median 4); the 83 lowered pointer rows median
      size 3.1, pedantic 1574 (median 4). Transpiler LOC today: `lower/pointers/` 1033 (non-test), `lower/interfaces/` 485,
      `calls/last-binding.ts` 139, `core/tags.ts` 17, `emit/rust/runtime/pointer.ts` 6.
    - What a hand spike does not show, for 4.2: (b)'s arena needs an escape pass and a layout pass in lowering, every
      routine reaching an escaped variable takes the image (`m: &Mem`/`&mut Mem` threaded like `g`/`prg`), an FB copy copies
      escaped bytes rather than the handle, and the interpreter gains `semantics/memory.ts`; (a)/(d)'s 13 cross-frame rows (12 at 4b)
      need the per-variable lend registry (pointer-model.md: the interface module's size again). (d) differs from (a) only
      where a tag is STORED (tr_44, tr_15, tr_16, interface); everywhere a pointer is erased (cursor, borrow, ANY) the two
      are one emission.
    - Tests (targeted + end of step): `VOLT_FIXTURES=<the six> bun test test/conformance` 205 pass, 10 skip, 4 todo, 0 fail;
      `bun test test/frontend` 45 pass after `VOLT_WRITE_BASELINE=1` rewrote six baselines, counts only (files 10776 → 10788,
      expressions +390 per vendor, recorded values 10039 → 10148, `ident_expr untyped, a type named where the operator takes
      one` 8 → 11 / 10 → 13 — the `SIZEOF(INT)` operands; no finding, `ceilings.json` unchanged); `bun test test/conformance` (full, once) 6248 pass, 394 todo, 1 fail — the evidence
      ratchet's `not-lowered` ceiling, raised 390 → 394 FOR MEASUREMENT with its reason in `map.test.ts` (four of the new
      fixtures are refused by name, none moved), after which `map.test.ts` 21 pass; 8 diverge as expected failures
      (`pointer_step_past_end` the new one); lsp-replay LSP-only 0 on both vendors; `bun typecheck` clean; `bun run lint`
      green.
    - M (`rate:fixtures`): mapped 5388 → 5394, confirmed 2828, refused 1989 → 1990, not-lowered 390 → 394, diverges 7 → 8,
      lowered aggregate 146 → 147; edge agree 3060 → 3061, disagree 0, not-run 184; pedantic 32190 → 32211.
    - Gate 4b (2026-10-09), the three review findings:
      1. KNOCK-ON `pointer-order` — fixed at the root, failing tests first (`pointers/deref.test.ts` "a pointer whose store
         was refused", red then green). A refused store (`storePointer`/`bindReference`, incl. `recordTarget`'s
         `pointer-outlives`) is remembered with its code (`pointers/state.ts` `refusedStores`); a later deref or copy of
         that pointer with no target repeats THAT code — "the pointer variable pb dereferenced after its store was refused
         (pointer-type)" — instead of the false "before any address was stored into it". An INTEGER stored into a pointer
         (`q := lw`, an LWORD) is now `pointer-value`, "an integer (lw) stored as a pointer — its value is a byte address"
         (it named the LWORD "the pointer variable lw"). `entry/totality.test.ts`'s ANY assertion expected the knock-on to
         read `pointer-order`; its premise is the one the review refuted, so it now expects `any-input` twice.
         Fixtures (not-lowered, codes before → after; no rating moved, the map is unchanged): `pointer_byte_walk_struct_padding`
         pointer-type,pointer-order,pointer-value → pointer-type,pointer-value; `pointer_to_lword_roundtrip` and
         `cv_pointer_through_lword_values` lose `pointer-order`; `cv_xword_into_pointer` pointer-order → pointer-value (moved
         to the byte-view row above); `tr_28_minmax_*` ×2 and `cursor_whole_store_capacity` lose it; `initseq_this`,
         `expr_this_as_pointer`, `mem_private_method_of_same_type_instance` are `place-not-local` alone;
         `cv_pointer_deref_to_reference_values` `pointer-shape` alone. Rows with a byte-view AND a cross-frame code: 8 → 2
         (`tr_15`, `decl_pointer_to_pointer_deref_typed`). The review named the latter wrongly: its `pp` is never stored,
         so its `pointer-order` is true; it stays. Left as they are, both cross-frame on both sides: `ty_array_of_pointer`
         (`pointer-place` on `a[1]`, whose element has no key, then `pointer-order` on its deref) and `ptrparam_kept`
         (the deref is lowered before the body that refuses the store).
         Corpus (`probe-lowering-refusals.ts`, 304 POUs, 54 lower / 250 refused, unchanged): `pointer-order` 106 → 71 —
         35 POUs carried it only after a refused store of the same variable (bakon-nano's AGM FBs, lenze-mid's motion FBs,
         pro2193's HMI/buttons/XY-control); all other codes unchanged (`pointer-value` 99, `pointer-type` 42,
         `pointer-foreign` 12, `pointer-outlives` 58); sole `pointer-order` blockers still 2, pointer-only POUs still 5.
         POUs carrying any pointer code (what (b) lowers) 146 → 136; an (a)/(d) cross-frame code 106 → 71; both 71 → 46.
         The census table, rule and "Blockers" lines above carry the corrected figures, marked "at 4b".
      2. `pointer_order_compare` — taken: moved out of the byte-view row into its own row, lowerable by all three (an order
         of element tags within one array; two members by the instance's declaration order, which the layout has), as an
         override beside `tr_15`. First-time lowering: (a) 14 (12 need the registry), (b) 45, (d) 14.
      3. EDGE agreement — taken as an open item: written into 4.2's What as an owner decision before 4.3 (whether vendor
         agreement on the recorded paths suffices, or (b)'s byte reinterpretation is first recorded on NaN/±0/denormal/
         extreme inputs, `tr_17` above all).
      Also: `test/analysis/baselines/fixtures.{codesys,twincat}.json` rewritten (`VOLT_WRITE_BASELINE=1`), counts only —
      4.1's six fixtures measured (5132 → 5138 / 5120 → 5126), TP +2 each (`cannotConvert`, `checkAssignmentTypes`,
      `checkPointerConversion`: the DWORD fixture both vendors refuse), no FP; 4.1 had not rewritten them.
      Gate: `bun typecheck` clean; `bun run lint` green (package; repo oxlint warnings only, none in volt-lsp-iec);
      `rate:fixtures` unchanged (mapped 5394, confirmed 2828, refused 1990, not-lowered 394, diverges 8, edge agree 3061,
      disagree 0, not-run 184); full suite `VOLT_REQUIRE_FULL=1 bun test` (cached rustc, VOLT_FIXTURES unset) 8618 pass, 35 skip, 437 todo, 0 fail, 9090 tests in 304 files.
- [x] 4.2 Design "§3.3 Decision: pointers".
  - What: the decision by fixtures, then Rust cost, then LOC; whether the three tag schemes unify (and why not, if not); which `staticKey`
    options become removable; the refused list by code; which transpile-st-to-rust pointer tasks it supersedes (update 0.8's list); the
    rewrite of architecture.md's "pointers will become indices" paragraph.
    OPEN FOR THE OWNER (4b gate review): design.md §3.3 Measure item 3 asked for EDGE agreement; 4.1 measured VENDOR
    agreement on the recorded paths instead (a hand-written option has no interpreter twin). 4.2 states whether that
    suffices for the decision, or records the inputs it leaves unchecked first — above all (b)'s byte reinterpretation on
    values nobody recorded (`tr_17`'s DINT read as a REAL at a NaN pattern, ±0, denormals, the extremes) — and the owner
    accepts the choice before 4.3.
  - Where: `design.md`; `openspec/changes/transpile-st-to-rust/tasks.md`.
  - Accept: committed.
  - Depends: 4.1.
  - Done 2026-10-09 (step 4c; the decision written at 34c44c3640, checked and corrected here; no product code, no
    fixture, no recording). design.md "§3.3 Decision: pointers": option (b) narrowed — a DATA pointer is a byte address
    into one little-endian image per program, a pointer/reference to an FB instance an instance handle (the interface
    scheme); form 2 borrows and the cursor stay. By the criterion: fixtures (b) 45 first-time lowerings plus
    `pointer_step_past_end` vs (a)/(d) 14 (12 needing a program-wide lend registry), the 13 at-risk lowered rows kept
    (12 instance handles, `lib_stu_wide` waits on one WSTRING layout recording); Rust cost +12% on the nine spikes all three
    build (203 vs 181 lines, (d) 186) plus a 36-line `Mem` runtime paid only by escaping frames, pedantic 0 in all three;
    corpus: the same 2 POUs unblocked by every option, pointer codes cleared in 136 POUs by (b), 71 by (a)/(d).
    Each item the section must also say:
    - tag schemes: data pointer tags go (addresses); pointer-to-instance and interface tags merge into one instance-handle
      scheme in `core/tags.ts`; `__inout_binding` stays separate (folding it in would make every VAR_IN_OUT target
      escape); `instanceRelative` decided with the merge (4.14);
    - `staticKey` options (4.15): `pointers/state.pointerKey` goes for data; `interfaceKey` stays (the handle's key);
      `KEY_STEP`/`SUFFIX_STEP`/`SAME_STEP` stay, each with its reason;
    - stays refused, by registered code: `pointer-shape`, `cursor-overrun`, `sizeof-unmeasured`, `call-inout-alias`,
      `place-not-local`, the `interface-*` codes, `dynamic-memory` on `__NEW`/`__DELETE`; `layout-unmeasured` is NEW and
      4.4 registers it; a pointer→DWORD conversion is vendor-refused;
    - supersedes (0.8's list, the hand-off's four 4.2 lines): "multi-target handle (`pointer-targets`)", "form 2 first"
      (built, kept), "REFERENCE/POINTER inputs of a routine as borrows" (interface inputs: the handle), "`VAR_IN_OUT`,
      `POINTER TO`, `REFERENCE TO`, `expr-deref` on the phase-3 model". transpile-st-to-rust is archived, so per the
      hand-off the commit names these lines instead of ticking the archived file;
    - architecture.md (line 313, "pointers will become indices into that same frame"): the replacement sentence is in
      the section; 4.16 writes it.
    - Owner item (4b): vendor agreement on the recorded paths suffices for the CHOICE (where all three build, all agree
      with CODESYS — the options differ in reach, not arithmetic); it does NOT suffice for reinterpretation — one
      batch records a DINT read as a REAL at a quiet and a signalling NaN, ±0, a denormal and ±max before 4.9/4.12
      lower `tr_17`/`tr_28`, folded into 4.3's single recorder batch per vendor.
    Corrections made while checking: the architecture.md paragraph is at line 313 (the Measure list said 132);
    `layout-unmeasured` is not registered yet (said so, owner 4.4); `newdel_*` is a fixture family, not a code — its code
    is `stmt-call_stmt`. Review fix (4c, low): that last correction was itself wrong — `stmt-call_stmt` sits only on
    `__DELETE` (the generic "is not a callable instance yet", fb-call.ts:75) and the `__NEW` expression is refused only by
    `pointer-value`, which (b) clears (repro: baseline ir.jsonl, every `newdel_*` and `op_sys_new_delete` carries exactly
    that pair); so the list now names a NEW code `dynamic-memory`, raised on `__NEW` and `__DELETE`, which 4.4 registers
    with a failing test first (a `__NEW`-only POU). Doc/plan only — no failing test is possible before 4.4, since
    `pointer-value` refuses the expression today. `newdel_in_method_with_pragma` lowers because its `__NEW` is in a
    METHOD nothing calls (never lowered) — consistent. Niche: 0 `__NEW(`/`__DELETE(` in test-corpus.
    Ticking 4.2 retagged the two `shapes1_12` notes (`013de1dc6a`, `de8528b197`: "pointers are `usize` tags") from 4.2 to
    4.4, the task that changes that representation (notes.test: a ticked task may own no note item); map regenerated.
    Gate: `bun typecheck` clean; `openspec validate` valid; `rate:fixtures` unchanged except the two tags (mapped 5394,
    confirmed 2828, refused 1990, not-lowered 394, diverges 8, edge agree 3061, disagree 0, not-run 184); full suite
    `VOLT_REQUIRE_FULL=1 bun test` (cached rustc, VOLT_FIXTURES unset) 8618 pass, 35 skip, 437 todo, 0 fail, 9090 tests
    in 304 files. OPEN: the owner accepts the choice before 4.3 starts (design.md says so); 4.3 does not start
    on this step.
- [x] 4.3 IR for the decision.
  - What: `ir/expr.ts` changes (reinterpret / load-bytes / store-bytes nodes if (b); an enum-handle node if (d)); `ir/walk.ts` extended.
  - Where: `ir/expr.ts`, `ir/walk.ts`, `walk.test.ts`.
  - Accept: G; `walk.test.ts` totality green.
  - Depends: 4.2.
  - Done 2026-10-09 (step 4d; design.md "§3.3 Decision (step 4d, as built)"). The ONE recorder batch per vendor first
    (`memory/pointer-model.ts`, 4 fixtures; `record:exec` 4 cases 0 failed; `record:language` CODESYS and TwinCAT
    `-Fixture 13`, `ide.ps1 -Instance transpile-restructure`, all four build clean on both):
    `fb_header_offsets_plain` (header 8, then the fields in DECLARATION order across VAR_INPUT/VAR_OUTPUT/VAR: inB 8,
    outD 12, outW 16, offLoc 24, loc 32, SIZEOF 40), `fb_header_offsets_implements` (+8 for one interface: 16/20/24/32/40,
    SIZEOF 48), `wstring_layout_in_struct` (WSTRING(3) SIZEOF 8, aligned 2: offsets 2/10, struct 12),
    `reinterpret_dint_as_real_edges` (every bit kept: bSnan 16#7FA00000, -0, the denormal, ±max). `storage/bytes.ts`
    answers FB field offsets and WSTRING sizes from them (both header fixtures and the WSTRING one lower, confirmed).
    IR (`ir/expr.ts`, `program.ts`, `faults.ts`): `Place.root "image"` with `at` (index steps keep a `size`), the
    expression `address`, the builtin `address_order`, `IrSlot.image`, `IrLayout.size`, `IrPou.image`, the faults
    `address-outside-image`/`address-across-frames`; `walk.ts` visits `at` and `address` (`mapPlaces` also rewrites a
    call's bindings). G: `walk.test.ts` totality names "image place" and "address", and `mapPlaces` maps both (green).

- [x] 4.4 Both backends implement the representation.
  - What: `semantics/memory.ts` (if (b)), `interp/frame.ts`, `emit/rust/runtime/pointer.ts`, `emit/rust/types.ts`; lowering in
    `pointers/state.ts`, `address.ts`, `deref.ts`, `store.ts`.
  - Where: those files.
  - Also (4.2, review 4c): register `dynamic-memory` (`not-measured`) in `lower/diagnostics/codes.ts` and raise it on every
    `__NEW` expression and `__DELETE` statement BEFORE `pointer-value` becomes lowerable, so no `__NEW` lowers to an image
    address CODESYS never ran (no memory pool in the recording project). Failing test first: a POU whose only statement
    is `p := __NEW(INT);` (no `__DELETE`) is refused `dynamic-memory`, not lowered.
  - Accept: every currently confirmed `indirect` fixture stays confirmed; S-out on all non-pointer fixtures; M; the six refused
    `newdel_*` fixtures and `op_sys_new_delete` refused `dynamic-memory`.
  - Depends: 4.3.
  - Done 2026-10-09 (step 4d). `dynamic-memory` first — failing tests then green (`pointers/image.test.ts` "a POU whose
    only statement is `p := __NEW(INT);`", "`__DELETE(p)`"): `newdel_*` ×6 and `op_sys_new_delete` refused
    `dynamic-memory` (was `pointer-value`/`stmt-call_stmt`), as are `ar_new_type`, `cc5_new_in_expression`,
    `lex_keyword_called_sys_delete`. `semantics/memory.ts` (`Memory`, `toImage` — the ONE place rewrite lowering, the
    runner and the Rust harness share) and `emit/rust/runtime/pointer.ts` `Mem` with twin cases `memory.cases.ts`
    (`memory.test.ts` 25, `runtime-twins.test.ts` "Mem over every byte-image case" + the recordings check; the sNaN case an
    expected failure on the TypeScript side). Lowering: `pointers/escape.ts` (the escape pass, a lowering run to a fixed
    point: fixtures 5045 in one pass, 141 in two; corpus 130 / 174, none more), `pointers/image.ts` (layout, static
    regions), `pointers/image-rewrite.ts` (rewrite, in-out copies, `call-inout-alias`, `image-stack`), address pointers in
    `address.ts`/`store.ts`/`deref.ts`, `places.ts` folds steps on image places, `operators.ts` compares addresses,
    `invoke.ts`/`fb-call.ts` hand pointer inputs an address. Registered: `dynamic-memory`, `layout-unmeasured`,
    `image-stack`. Interpreter: `frame.ts` image reads/writes, `runner.ts` paths through `toImage`; Rust: `image.ts`,
    `__mem` threaded like `g`. Harnesses (`rust-access.ts` read/write, replay, backends, edge, library tests) pass `mem`.
    - Accept: every confirmed `indirect` row stays confirmed (the 77 confirmed pointer rows of the census replayed,
      values in both backends); S-out: `snapshot:transpile check` against a baseline taken at the step's start — 91
      fixtures differ, every one holding ADR/REF=/POINTER/REFERENCE/SIZEOF, no other fixture differs in any layer.
    - Lowering for the first time (all confirmed): `tr_15`, `pointer_order_compare`, `pointer_byte_walk_struct_padding`,
      `xo2_pointer_step_variable` (its mark removed), `ptrparam_function_block`/`_kept`/`_input_persists`/`_unsupplied`,
      `use_pointer_deref_struct_field`, `cc_fp_ptr_deref`, `ty_array_of_pointer`, `cv_pointer_deref_to_reference_values`,
      `cv_pointer_to_other_pointee`, the three 4.3 layout fixtures; `pointer_step_past_end` confirmed (mark removed).
      Lowering and marked `diverges` (the interpreter's REAL is a JS number, its NaN always 16#7FC00000; the Rust keeps
      the bits): `tr_28_minmax_limit_nan_signed_zero_{real,lreal}`, `reinterpret_dint_as_real_edges` — 4.9/4.12's.
    - Src tests changed because the decided model answers them (design.md 4.2/4d), each saying so: `totality.test.ts`
      (an address is taken where ADR is; any pointer type reads its bytes; a zero-size step divides nothing),
      `address.test.ts` (steps are bytes), `deref.test.ts` (the refused-store rule shown on a tag pointer; an address
      pointer needs no store first), `cursor.test.ts` (a cursor over a BYTE walks and faults by name), `assign.test.ts`
      (RC 15), `emit/rust/place.test.ts`, `calls.test.ts`.
    - Notes: `013de1dc6a`, `de8528b197` (shapes1_12, "pointers are usize tags", owned by 4.4) resolved and deleted; 16
      notes whose constructs no fixture emits any more (element-tag arithmetic, tag `match`es, in-out freeze temps) deleted
      (`0c7c4434c4 0cf79a4fb2 1fa78ccf62 26c1488275 28e0f14a5a 32f4b8cabb 417ce6fb0b 41d2232599 48944bacca 55d895e28f
      690693c479 785b5ff775 96161d76eb dd1daf8424 def43ae4d0 ef64f29f0d`).
    - Gates moved with reasons: `source-map.test.ts` RENAMED_TARGETS 41 → 141 (a store through `Mem` names no field),
      `fold-agreement` 7 SIZEOFs added to task 6.A.31's class, `ir-walk` reference walk taught `at`/`address`,
      `corpus.test` COVERED_BUILTINS 24 → 25 (`address_order` built by the corpus), frontend/analysis baselines
      rewritten (counts only; `ceilings.json` unchanged; 3 named CEILING_EXCEPTIONS for the 4.3 fixtures' SIZEOF-of-FB and
      negated literals).
    - Corpus (`probe-lowering-refusals.ts`, 304 POUs): 54 lower / 250 refused, unchanged; `pointer-order` 71 → 48,
      `pointer-foreign` 12 → 6, `pointer-runtime-index` 10 → 6, `pointer-type` 42 → 40, `pointer-value` 99, `pointer-
      outlives` 58, `pointer-root-input` 7, `any-input` 8 unchanged; `pointer-targets` 0 → 16 (a pointer given both an
      address and a tag's target, in POUs refused on many other codes); POUs with any pointer code 136 → 135; pointer-only
      POUs 5 → 4.

- [x] 4.5 One below the first element (RC 44).
  - Where: `lower/pointers/state.ts`, `address.ts`.
  - Accept: F(`tr_44_pointer_step_below_first_element`) (lowers; isNull = FALSE); M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4d). IMAGE_BASE = 2^32 answers it for a pointer that holds addresses: `tr_44` stays confirmed
    (values in both backends; src test `image.test.ts` "a step below an array's first element is not NULL"). `ELEMENT_TAG_BIAS`
    stays for the element pointers that keep a TAG (a routine's local array, a VAR_IN_OUT's) until 4.14 — design.md "as built".

- [x] 4.6 S=/R= through a multi-target pointer (RC 14).
  - What: the latch goes inside each arm of `storeThrough`; independent of the decision.
  - Where: `lower/pointers/deref.ts`.
  - Accept: F(`tr_14_set_reset_through_multi_target_pointer`); src test; M.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 4d). For a pointer that holds addresses the latch is one conditional image store — no arms;
    `tr_14` stays confirmed (src test `image.test.ts` "a latch through a pointer that may name either variable"); the
    tag form's latch inside each arm (`storeThrough`) stays for tagged pointers, tested by `deref.test.ts`.

- [x] 4.7 An FB copy keeps its ADR(own member) address (RC 15).
  - What: modelled (foreign target / arena / enum) or refused by name.
  - Where: `lower/pointers/state.ts`, `statements/assign.ts`.
  - Accept: F(`tr_15_fb_copy_keeps_pointer_address`), or its refusal code in the design's refused list and the fixture rated accordingly; M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4d). Modelled: `b := a` of an escaped FB type copies the struct (a pointer keeps the address it
    holds), restores `b.__base`, then moves the bytes of each run of image fields (`statements/assign.ts` `instanceCopy`,
    the runs `pointers/image.imageRuns`). `tr_15_fb_copy_keeps_pointer_address` lowers and is confirmed (rb 7, b.x 5,
    sameA TRUE, sameB FALSE, both backends). Src tests `image.test.ts` "an instance copied whole keeps the address its
    pointer field held (RC 15)", `assign.test.ts` (a TAG field targeting its own member stays `copy-instance-pointer`).
  - M (4.3-4.7, `rate:fixtures`): mapped 5394 → 5398, confirmed 2828 → 2845, refused 1990, not-lowered 394 → 379,
    diverges 8 → 10, lsp-gap 82, unaskable 92; tier `indirect` 360 → 415 rows, median size 2.6 → 2.7, pedantic 2928 →
    3199 (median 4); total pedantic 32211 → 32311; edge agree 3061 → 3078, disagree 0 → 3 (the three NaN-bit rows above),
    not-run 184 → 185; allowed `dead_code` 5506 → 5630.
  - Review 4d (fixes before the gate): `memory/pointer-model.ts` +3 fixtures (`fb_offsets_var_before_input`,
    `pointer_order_one_past_end` confirmed; `bool_byte_two_through_pointer` diverges, niche: accepted loss — 0 occurrences
    in the corpora), an instance passed through a call's arguments copied by value, an ADR difference in one array measured
    wherever it sits, `WHILE p < pEnd` with pEnd one past the end (src tests `image.test.ts`).
  - Gate 4d review finding (fixed, failing tests first): `builtins/sizeof.adrDifference` folded ANY difference of two
    places reached through an address pointer (root "image", slot 0, path []) to the constant 0 — `ADR(p^) - ADR(q^)` gave
    0 where CODESYS gives 6. It now refuses `adr-offset` by name when either place has root "image" (an ADR as an integer
    operand is not lowered, so the run-time distance cannot be taken instead); 0 ADR differences of any shape in the six
    corpora. Src tests `image.test.ts` "a difference of addresses through dereferenced pointers is refused" (`ADR(p^) -
    ADR(q^)`, `ADR(p^.g) - ADR(q^.f)`, `ADR(p^[3]) - ADR(p^[0])`; red at d = 0, green). No fixture moved.
  - M at the gate (`rate:fixtures`, against the 4.3-4.7 line above): mapped 5398 → 5399, confirmed 2845 → 2847, refused
    1990, not-lowered 379, diverges 10 → 11 (`bool_byte_two_through_pointer`), lsp-gap 82, unaskable 92; tier `indirect`
    415 → 417 rows (412 clean); total pedantic 32311 → 32340; edge agree 3078 → 3081, disagree 3, not-run 185; allowed
    `dead_code` 5630 → 5633. Analysis census baselines: fixtures measured codesys 5138 → 5145, twincat 5126 → 5133 (count
    only, the review's fixtures).
  - Gate: typecheck clean; full LSP suite (`VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset) 8705 pass / 0 fail / 35 skip / 422
    todo, 9162 tests in 306 files (514 s).

- [x] 4.8 An FB copy carries its in-out binding (RC 16).
  - Where: `lower/calls/last-binding.ts`, `entry/finish.ts`.
  - Accept: F(`tr_16_fb_copy_carries_inout_binding`) (first = 11, second = 100; no `_ => panic` reached); src test in `last-binding.test.ts`; M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4e). Failing test first (`last-binding.test.ts` "an FB copied whole carries its in-out binding",
    red on `call-fb-inout`, then green): a METHOD dispatch on an FB type in `copiedWhole` arms EVERY binding tag of the type
    (`mine` = all the FB's calls), not only the receiver's; the per-arm "bound by a call in another frame" refusal is
    unchanged, so a tag made in another frame stays `call-fb-inout` (tested: `w2 := h.inner` with `inner` bound in FB_H's
    body). `entry/finish.ts` needed nothing. Two old expectations moved with the recorded answer (independent ground: the
    `tr_16` recording): `w2 := worker` with w2 called first, and with w2 never called, now run (first = 11). `tr_16` lowers
    and is confirmed (first 11, second 100, both backends).
  - Review fixes (step 4e). (1) A copy taken from ANOTHER instance of a frame type there are several of lent the copied
    binding's places from the running frame: recorded `tr_16_fb_copy_across_frame_instances` (CODESYS x1.a = 11, x2.a = 1),
    refused `call-fb-inout` (`not-lowered`); plus `tr_16_fb_copy_into_uncalled_carries_inout_binding` and
    `tr_16_fb_copy_reverse_carries_inout_binding`, both confirmed. (2) The guard for (1) compared instance keys, but the key
    is frame-relative (`inner` in x1 and in x2 is one key in FB:FB_X): a copy into the SAME-NAMED field of another instance
    (`inner := src.inner` in a METHOD, or `x2.inner := x1.inner` then `x2.Use()`) passed it and lowered with no diagnostic,
    a1 = 1, a2 = 11 where CODESYS writes x1.a. Failing test first (`last-binding.test.ts` "a binding copied into the
    same-named field of another frame instance is refused", red on `[]`, then green): under a whole copy every binding whose
    places are not global, made in a frame that is not single, is refused whatever the key. Refused, not recorded: it is the
    `tr_16_fb_copy_across_frame_instances` shape with the field renamed, and the refusal is the answer either way.
  - M at the gate (`rate:fixtures`, against the 4.8-4.12 line below): mapped 5404, confirmed 2852 -> 2854 (`tr_16` uncalled,
    reverse), not-lowered 374 -> 375 (`tr_16` across frame instances), refused 1990, diverges 11, lsp-gap 82, unaskable 92;
    tier `indirect` 422 -> 424 rows (417 -> 419 clean); total pedantic 32358 -> 32372; edge agree 3086 -> 3088, disagree 3,
    not-run 185; allowed `dead_code` 5643; shapes 1761 -> 1762 over 3276 lowered, constructs 2005, noted constructs 677 -> 681.
    Fix (2) moved no fixture (the map's diff against HEAD is the same before and after it).
  - Gate (step 4e): typecheck clean; full LSP suite (`VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset) 8726 pass / 0 fail / 35
    skip / 418 todo, 9179 tests in 306 files (601 s). (`bun run lint`: oxlint is not installed in this tree — not run.)
- [x] 4.9 ANY pValue and the pointer's type (RC 17).
  - What: reinterpret under (b), or a `pointer-type` refusal plus arm pruning by constant diSize under (a)/(d).
  - Where: `lower/pointers/any.ts`.
  - Accept: F(`tr_17_any_pvalue_dint_via_real`, `_byte_via_sint`, `_uint_via_int`, `_dint_write_via_byte`) or their named refusal;
    `state_any_int_pointer_increment` still lowers; M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4e; design.md "§3.3 Decision (step 4e, as built)"). Failing tests first (`pointers/any.test.ts`
    "an ANY input's pValue stored into a pointer is the argument's address (RC 17)": REAL/SINT/INT views 1.0/-1/-1, a
    one-byte write 16#010203FF, red on `pointer-type`, then green; the old "refused" test replaced by the recorded values).
    A `pValue` stored into a pointer that holds addresses is recorded for the escape pass (`escape.noteAnyAddress`, a new
    `Escapes.anyAddresses`); from the next lowering on, that variant takes a hidden POINTER input (`__anyadr_<v>`,
    `any.declareAnyAddresses`) in place of the hidden VAR_IN_OUT, and every call site fills it with `ADR(argument)` stored
    into the ANY's holder `ROUTINE:<variant>.__any_<v>` (`any.bindAnyAddress` over `imageAddressOf`), so the argument
    escapes by 4d's units; an argument the image cannot hold tags the holder (closed over the `p := v.pValue` copy), which
    puts the variant back on the VAR_IN_OUT and `pointer-type`. The union rule needed no code: a UNION of address pointers
    is one pointer key, so `u.p1_Byte := v.pValue` then `u.p4_Dint^` reads the bytes at DINT (src test "a UNION of
    pointers given pValue is one address"). `diSize` pruning reads the argument's type from either home (`anySize`). The
    four `tr_17` lower and are confirmed (both backends, edge agree); `state_any_int_pointer_increment` stays confirmed
    (size 4.1 -> 5.9: its four arguments now live in the image). Its 9 notes on constructs no fixture emits any more are
    deleted (`431373ac5d 57ce9e2ee4 64cc413c0b cca22914d5 d39e19d533 d8e4a747d3 dd8988b5d4 e3343dab4f efd31f3397`); the
    7.7.9 one (diSize passed at run time) is re-keyed to the new signature `f7ee3854dd`. Found on the way: a stray
    `ZZ_PASSES` debug print in `entry/lower-unit.ts` (4d) deleted; `joined` moved beside `covers` in `escape.ts`.
    - Corpus (`probe-lowering-refusals.ts`, 304 POUs; before = HEAD e6f73cf519 in a worktree): 54 lower / 250 refused,
      unchanged; pro2193 `any-input` 8 -> 8 and `pointer-type` 33 -> 33 POUs (all six corpora: 8 -> 8, 40 -> 40), so none
      of those is a stored pValue of a place; `pointer-outlives` 58 -> 42 (pro2193's `Increment`/`BitLogic` callers: the
      pValue is no longer a tag into a VAR_IN_OUT); POUs with any pointer code 135 -> 131; `pointer-targets` 16,
      `pointer-value` 99, `call-fb-inout` 2 unchanged; `LubricationPumpFB` is now refused only `graphical-body`.
- [x] 4.10 `__QUERYINTERFACE` into a global (RC 18).
  - What: compute the foreign edge as `storeInterface` does and model it (CODESYS accepts: r1 = r2 = 1).
  - Where: `lower/interfaces/query.ts`.
  - Accept: F(`tr_18_queryinterface_into_global`); M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4e, no code; design.md §3.3 step 4e). Stays refused `interface-instance-relative`: niche:
    accepted loss (0 occurrences in the corpora; their 35 `__QUERYINTERFACE` write locals). `tr_18` stays `not-lowered`.
- [x] 4.11 Routine outputs copied out after the call (RC 20).
  - Where: `lower/calls/outputs.ts`, `calls/binding.ts` (freeze loop).
  - Accept: F(`tr_20_output_index_moved_by_callee`) (arr[1] = arr2[1] = 5); src test; the LSP false positive stays in
    `KNOWN_DIVERGENCES.codesys` and is Filed; the transpile-st-to-rust VAR_OUTPUT task is ticked "superseded by 4.11"; M.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 4e, verify). The copy-out closed upstream (8ce61e47f8): `tr_20` confirmed (rust vendor, edge
    agree), src test `calls/outputs.test.ts` (and `init/step.test.ts`); the LSP false positive stays in
    `KNOWN_DIVERGENCES.codesys` (`support/divergences.ts`) and is filed in `lsp-transpile-review-gaps` tasks.md; the archived
    transpile-st-to-rust line reads "*Superseded by transpile-restructure 4.11.*"; `tr_43_output_dint_to_int` stays 6.17's.
- [x] 4.12 Fixtures the pointer model unblocks.
  - What: `tr_34_lib_prim_char_behind` (RC 34; u = 'abcBC', lenU = 5) and, if the decision supports reinterpretation,
    `tr_28_minmax_limit_nan_signed_zero_{real,lreal}` now lower.
  - Where: per 4.2.
  - Accept: F(`tr_34_lib_prim_char_behind`); `tr_28_*` lower (their values are 6.7's) or stay refused by the code 4.2 names.
  - Depends: 4.4, 3.6.
  - Done 2026-10-09 (step 4e). `tr_34_lib_prim_char_behind` confirmed (the chars path; verify). `tr_28_*` lower since 4.4;
    the interpreter's REAL stays a JavaScript number: niche: accepted loss (1 occurrence in the corpora: bakon-nano
    `ReadParametersFromAGM` views a REAL's bytes through a POINTER TO ARRAY OF BYTE). `tr_28_minmax_limit_nan_signed_zero_
    {real,lreal}`, `reinterpret_dint_as_real_edges` and `memory.cases.ts`'s sNaN keep their expected-failure marks, now with
    that reason (`fixtures/semantics/execution.ts`, `fixtures/memory/pointer-model.ts`, `MEMORY_INTERPRETER_DIVERGENCES`);
    the emitted Rust keeps every bit.
  - M (4.8-4.12, `rate:fixtures`, against 4d's gate line): mapped 5399, confirmed 2847 -> 2852 (`tr_16`, the four `tr_17`),
    refused 1990, not-lowered 379 -> 374, diverges 11, lsp-gap 82, unaskable 92; tier `indirect` 417 -> 422 rows (412 -> 417
    clean); total pedantic 32340 -> 32358; edge agree 3081 -> 3086, disagree 3, not-run 185; allowed `dead_code` 5633 -> 5643;
    shapes 1756 -> 1761, constructs 1995 -> 2005, noted constructs 685 -> 677.
  - Tests (end of step, once each): `bun typecheck` clean; `bun run lint` clean; `bun test src/transpile` 458 pass / 0
    fail; `bun test test/conformance` 6299 pass / 0 fail; `bun test test/frontend` 45 pass / 0 fail; `bun test test/corpus`
    19 pass / 1 skip.
- [x] 4.13 Appendix pointer items, each recorded first, then fixed or refused by name.
  - What: (a) a target set read while growing (`pointers/state.ts`); (b) a null source copied into a multi-target pointer
    (`pointers/store.ts`); (c) `0 = p` recognition (`expressions/operators.ts`); (d) `r.3` on a REFERENCE (`places/places.ts`); (e) an ANY
    input given a REFERENCE TO failing E0308 (`pointers/any.ts`); (f) a GVL FB never callable through an interface (`interfaces/lend.ts`
    `lendPlace`).
  - Where: as listed.
  - Accept: each has a fixture plus F or a named refusal; M.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4f; design.md "§3.3 Decision (step 4f)" and its "As built"). Recorded FIRST, one CODESYS
    record:exec batch for the eight (`memory/pointer-model.ts`, `oop/interface.ts`), then one more for
    `any_input_given_reference_size` (the diSize-only variant, which the pValue fixture moves off the E0308 path):
    every value as the items predict. Each src test below was red before its fix and green after (checked by reverting
    the product files).
    - (a) `pointer_target_set_grows_after_read` (33; we gave 22) — confirmed. A use reads a target set through
      `state.readTargets`, which notes the count it saw; `grownTargets` names the keys that ended with more, and
      `lower-unit.ts` lowers again SEEDED with their final sets (`seedTargets`); still growing at `ESCAPE_PASSES` is
      refused `pointer-targets` by name. Src: `pointers/deref.test.ts` "a dereference lowered before the store that adds a
      target reads every target".
    - (b) `pointer_null_copied_into_multi_target` (copiedNull TRUE, readBack 11; we gave FALSE) — confirmed.
      `store.storePointer`: a copy into a pointer of several targets is `IF src <> 0 THEN p := tag ELSE p := 0`. Src:
      new `pointers/store.test.ts`.
    - (c) `pointer_zero_on_left_compare` (an image pointer) and `_local` (a tag) — confirmed; refused `pointer-value`
      before. `operators.pointerNullCompare` normalizes the zero to the right. Src: `expressions/operators.test.ts`.
    - (d) `reference_bit_access` (bit3 TRUE, bit2 FALSE, w 1) and `_local` (TRUE, 9) — confirmed; refused
      `bit-on-reference` before. `places.bitPlace` steps through the reference. Src: `places/places.test.ts`; the
      `entry/totality.test.ts` case that pinned `bit-on-reference` (pro2193 MapperInputs' `slice.0`, a root input) now
      reads `pointer-root-input` — its premise ("phase 4 aliasing") is what the recording refutes.
    - (e) `any_input_given_reference` (diSize 2, pValue^ 5) and `_size` (2; rustc E0308 before, verified) —
      confirmed. `any.anyArgumentTypes` and `bindAnyAddress` step through the reference (`address.imagePlaceAddress`
      split out of `imageAddressOf`). Src: `pointers/any.test.ts`.
    - (f) `interface_holds_gvl_instance` (8, 9, 9) — not-lowered, refused by name: `lendPlace` answers the global place,
      and the call meets the direct call's blocker (the METHOD takes `g`; rustc E0499 when let through), now
      `call-global-instance` in `dispatch.ts` instead of `interface-context`; niche: accepted loss (0 occurrences in
      the corpora — see the gate review fix below) — `deferred.transpile` on the fixture. Src:
      `interfaces/tags.test.ts`.
    - Corpus (`probe-lowering-refusals.ts` before/after): lowered POUs 54 = 54; `bit-on-reference` gone from 3 pro2193
      POUs (MapperInputs/MapperOutputs now `pointer-order,pointer-root-input`, IQ_Handling loses the code); nothing else
      moved.
    - `source-map.test.ts` RENAMED_TARGETS 150 -> 159, read: 7 of the image class, 2 of one new class (the NULL-keeping
      copy's `if`). `test/frontend/baseline.ts`: CEILING_EXCEPTIONS for the 6 bit accesses through a REFERENCE (untyped
      by design, as every bit access); the frontend baselines' counts rewritten (new fixtures only).
  - Gate review fixes (step 4f gate, 2026-10-09):
    - The seeding's side effect on a COPY is pinned: a pointer copied while its target set still grows (`q := p; F := F
      + q^; p := ADR(b)` in a loop) read 22 silently at HEAD and is now refused `pointer-targets` (a copy of a pointer of
      several targets). Fixture `pointer_target_set_grows_copied` (CODESYS record:exec: 33) — not-lowered; src
      `pointers/deref.test.ts` "a pointer copied before the store that adds a target is refused by name" (red on a HEAD
      copy, green here).
    - The seeding's other new lowering is measured: a FUNCTION's local pointer dereferenced before its first store
      (`F := p^; p := ADR(a);`, `pointer-order` at HEAD) now lowers and faults as a null dereference. Fixture
      `pointer_deref_before_first_store`: CODESYS stops ("The operation has timed out." at start, as `cc_fp_ptr_deref`
      records a plain null dereference) — confirmed, a fault match; src `pointers/deref.test.ts` "... faults as a null
      dereference, as the vendor stops".
    - (f)'s niche count now counts the CONSTRUCT: no assignment or call argument in the six corpora stores a VAR_GLOBAL
      FB instance into an interface-typed variable (text census over every project's own code: GVL FB instances awa 11,
      bakon 3, lenze 5, pro2193 52; the 5 name-only matches, bakon-nano ReadParametersFromAGM `Device:= Device`, are a
      local `Device : CIA405.DEVICE` shadowing the GVL's) — `deferred.transpile` reads "0 occurrences".
    - Diagnostics measured, not only runs: CODESYS `record:language` (instance transpile-restructure) for the eleven
      4.13 fixtures — every one builds with no error and no warning, and the LSP agrees (`test/conformance` green); parse
      census "fixtures codesys: unrecorded, no LSP parse error" back to 152 (builds, no LSP parse error 3083 -> 3094).
      TwinCAT build recordings not taken: like the 152 other transpile fixtures without one, CODESYS is the exec oracle
      these answer to (twincat unrecorded 161 -> 163, the two new fixtures).
    - Stale text: `places.bitPlace`'s comment no longer cites `slice.0` as phase-4 aliasing (a REFERENCE is stepped
      through before it); architecture.md's `pointer-targets` entry names the copy of a multi-target pointer and the
      "still grew after `ESCAPE_PASSES` lowerings" refusal.
- [x] 4.14 The three tag schemes per 4.2.
  - What: merged into one scheme, or each kept with the reason 4.2 recorded, all numbering through `core/tags.ts`; the
    transpile-st-to-rust `instanceRelative` task resolved or left with a reason.
  - Where: `lower/pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`, `core/tags.ts`.
  - Accept: S-out; design.md P1's "Tag encodings" row states the final home.
  - Depends: 4.4.
  - Done 2026-10-09 (step 4f). Kept three, each with its reason, all numbering through `core/tags.ts`: the INSTANCE
    HANDLE (`interfaces/tags.instanceHandle`, split out of `tagOf`) now numbers interfaces AND pointers/references to a
    whole FB instance (`state.targetTag`/`byHandle`: `ADR(inst)` writes the handle, a copy carries it, the select arms
    read it); the residual DATA TAG; `__inout_binding`. Census first: 18 instance-pointer fixtures, all single-target, all
    frame variables — so dispatching/lending a MULTI-target instance pointer as an interface is not built (0 fixtures, 0
    corpus POUs where it would be the sole blocker; design.md "As built"). `instanceRelative` stays with RC 18's reason.
    S measured: `snapshot:transpile` ir,outputs,edge identical over all 5413 fixtures against a baseline of the tree with
    the handle switched off (a lone instance's handle is 1, as its tag was; the store keeps the address's span). Src:
    `pointers/store.test.ts` "ADR of an instance writes the instance handle an interface holding it would write" (red
    with the handle off). design.md P1 "Tag encodings" row states the final homes.
  - Gate review fix (S against HEAD, not against the tree itself): the baseline the step compared to had been written
    by the new code with the handle switched off. Re-measured against HEAD: `snapshot:transpile write --baseline` on a
    `git archive HEAD` copy (rustc cache and corpus shared; path prefix normalized), then `check` on the working tree:
    all 5404 HEAD fixtures identical in ir, rust, outputs AND edge — every 4.13-4.15 edit is output-neutral on every
    existing fixture; only the 11 new fixtures differ (not in the baseline). The handle's 2n for an instance pointer
    shows only where an interface numbered another instance first (`store.test.ts`; 0 fixtures). `.snapshot/baseline`
    is now HEAD's.
- [x] 4.15 Remove the `staticKey` named options 1.7.11 listed, where the model made them unnecessary; the rest carry a reason.
  - Where: `lower/places/path.ts` and callers.
  - Accept: S-out; no option without a written reason.
  - Depends: 4.14.
  - Done 2026-10-09 (step 4f). The G check (a throw on a constant index that is not a bigint): none over every fixture
    (lowered by a census script), the six corpora (`probe-lowering-refusals.ts`) and `bun test src` — only the synthetic
    `1` against `1n` case in `path.test.ts`. So `SAME_STEP` folded into `KEY_STEP`: `sameStep` compares KEY_STEP
    writings and `sameTarget` is `staticKey` equality plus `element`/`chars`; the synthetic case left the test with its
    premise (a runtime index added: no target's twin). Stay, each with its reason in `path.ts` / design.md P1: `SUFFIX_STEP`
    (a Rust name, not a key), `pointerKey` (residual tagged pointers, a UNION's members, the ANY holder), `interfaceKey`
    (the handle's key). S: `snapshot:transpile check --layers ir` identical.
- [x] 4.16 Model delta.
  - What: architecture.md "Places, not references" rewritten per 4.2; the refused list in docs; the map delta.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 4.5-4.15.
  - Done 2026-10-09 (step 4f). architecture.md "Places, not references": line 313's "pointers will become indices into
    that same frame" replaced by 4.2's sentence plus "a pointer the image cannot hold keeps a tag", and a new *Pointers*
    paragraph: the escape pass (and the seeded re-lowering), the image as a Place root, the three tag schemes and their
    homes, form 2 and the cursor, and the refused list by code. `core/tags.ts`'s header states the three schemes.
    - M (`rate:fixtures`, 4.13-4.15 together): mapped 5404 -> 5413 (the nine new fixtures; no existing row changed):
      confirmed 2854 -> 2862, not-lowered 375 -> 376 (`interface_holds_gvl_instance`), refused 1990, diverges 11, lsp-gap
      82, unaskable 92; tier `indirect` 424 -> 432 rows (419 -> 427 clean); edge agree 3088 -> 3096, disagree 3, not-run
      185; total pedantic 32372 -> 32395; allowed `dead_code` 5643 -> 5651; shapes 1762 -> 1770, constructs 2005 -> 2035;
      notes resolved: none.
    - Tests (end of step, once each): `bun typecheck` clean; `bun run lint` clean (the one size warning is
      `last-binding.ts`'s, unchanged); `bun test src` 2147 pass / 0 fail; `bun test test/conformance` 6319 pass / 0 fail (after
      the RENAMED_TARGETS read); `bun test test/frontend` 45 pass / 0 fail; `bun test test/analysis` 13 pass / 0 fail;
      `bun test test/corpus` 19 pass / 1 skip.
    - Gate (step 4f, after the review fixes): M (`rate:fixtures`) mapped 5413 -> 5415: confirmed 2862 -> 2863
      (`pointer_deref_before_first_store`), not-lowered 376 -> 377 (`pointer_target_set_grows_copied`), refused 1990,
      diverges 11, lsp-gap 82, unaskable 92; tier `indirect` 432 -> 433 rows (427 -> 428 clean); edge agree 3096 -> 3097,
      disagree 3, not-run 185. Tests, full, `VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`: `bun typecheck` clean; `bun run
      lint` clean; `bun test src` 2149 pass / 1 skip / 0 fail; `bun test test/conformance` 6320 pass / 0 fail; `bun test
      test/frontend` 45 pass / 0 fail; `bun test test/analysis` 13 pass / 0 fail; `bun test test/corpus` 19 pass / 1
      skip (frontend and analysis baselines rewritten for the new fixtures' counts and the new build recordings only).

## 5. Model 4: instance initialization (RC 22, 23, 24, 25; RC 30 closed upstream)

- [x] 5.1 Measure.
  - What: record `init_extends_interleaving`, `init_struct_field_fb_init_scope`, `init_structured_after_fb_init` (or cite its existing
    recording), `init_gvl_program_slot_order`, `init_this_in_initializer`, `var_temp_dynamic_init_method`,
    `var_temp_dynamic_init_function`, and `var_temp_dynamic_aggregate_init` (a VAR_TEMP array and struct with a dynamic initializer).
  - Where: `test/conformance/fixtures/declarations/` and `oop/`; numbers here.
  - Accept: committed recordings.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 5a, measure only — no product code). Ten fixtures: `oop/init-model.ts` (new, `INIT_MODEL_TESTS`)
    holds `init_extends_interleaving`, `init_struct_field_fb_init_scope` and its twins `_local` and `_sibling`,
    `init_gvl_program_slot_order`, `init_this_in_initializer` and its twin `_argument`; `declarations/section-semantics.ts`
    (`initModel`) holds `var_temp_dynamic_init_method`, `_function` and `var_temp_dynamic_aggregate_init`. Most cells read
    a STAMP — a fixture-own FUNCTION bumping a global counter, called from field initializers, FB_Init bodies and
    `call_after_global_init_slot` methods — so every initialization event of a fixture sits on one line. Recorded in one
    batch per vendor: `record:exec` (CODESYS simulation; two fixtures re-recorded after the build refusals below),
    `record:language` on CODESYS and on TwinCAT (Project13); every recording below holds on both builds.
    `init_structured_after_fb_init` is NOT a new fixture: `fb_init_and_structured_initializer` (`oop/lifecycle.ts`) records
    it — FB_Init saw `seenBefore` 0 and the structured `started := 9` stayed (`fb-init.test.ts` cites it).
    - M5.1.1 EXTENDS (`init_extends_interleaving`): per class, in declaration order — base field 1, base FB_Init 2,
      derived field 3, derived FB_Init 4 (the base's FB_Init runs BEFORE the derived fields' initializers, not "all fields
      first"); a derived FB without its own FB_Init: base field 5, base FB_Init 6, its field 7. One instance completes
      before the next starts (`plain` 5-7 after `inst` 1-4).
    - M5.1.2 A STRUCT field instance (`init_struct_field_fb_init_scope`): declaration order inside the struct — `before`
      1, `viaGlobal`'s FB_Init 2, `viaLiteral`'s 3, `after` 4 (PLC_PRG's `rec`), then `holder.h` 5-8; a global argument
      gives 6, a literal 3. The scope: an argument naming a local of the POU declaring the struct variable is REFUSED on
      both vendors ("Identifier 'sfslSeed' not defined", `_local`); one naming an EARLIER field of the same struct gives
      its initial value (4, `_sibling`). So the arguments resolve in the struct's scope (its fields, then globals), never
      the declaring POU's (appendix item, 5.8). Gate 5a's twins pin the rest: a field named like a global (global
      `sfsgFirst` 11, field 4, `_shadow`) gives the FIELD's 4 — fields before globals; an earlier field with a DYNAMIC
      initializer (`first : INT := F_stamp()`, `_dynamic`) gives `got` 1 and the clock stays at 1 — the argument reads the
      field's runtime value, the initializer runs once; a static fold of the type's declared initializer is not the
      model. `_local` is an `lsp-gap` (the LSP checks no STRUCT field's FB_Init
      arguments) — niche: accepted loss (0 occurrences in the corpora: no STRUCT field declares FB_Init arguments),
      `deferred.lsp`; `map.test.ts` lsp-gap 82 -> 83.
    - M5.1.3 cited above (FB_Init first, then the structured initializer).
    - M5.1.4 Across frames (`init_gvl_program_slot_order`): the GVL first, in declaration order (`gBefore` 1, the GVL
      instance's field 2 and FB_Init 3, `gAfter` 4); then PLC_PRG (5, `local` 6/7, 8); then the PROGRAM PLC_PRG calls,
      `PRG_LANG_gps` (9, `inst` 10/11, 12); then every `call_after_global_init_slot` method after every initializer and
      FB_Init: `PRG_LANG_gps.inst` 13, the GVL instance 14, `PLC_PRG.local` 15 — the slot methods' order among
      themselves is neither declaration nor frame order (one recording; 5.2 does not guess beyond it). `seqAtScan` 15:
      nothing runs again in the first scan. Gate 5a's twin `init_gvl_program_slot_order_renamed` (the GVL `Z_GVL_LANG_gpsn`
      sorts AFTER PLC_PRG, the called PROGRAM `A_PRG_LANG_gpsn` BEFORE it): the frames' stamps are the same — GVL 1-4,
      PLC_PRG 5-8, PROGRAM 9-12 — so the frame order is the GVL, then PLC_PRG, then the PROGRAM it calls, not
      alphabetical or object-tree order. The slot methods MOVED with the names: the GVL instance 13, the PROGRAM's 14,
      `PLC_PRG.local` 15 (the original: the PROGRAM's 13, the GVL's 14) — their order among themselves follows the
      names in some way two recordings do not settle; 5.2 keeps it unmodelled (no fixture reads two slot methods'
      order against each other beyond these two).
    - M5.1.5 THIS (`init_this_in_initializer`): `THIS^.n` in a field initializer reads an earlier field's value (7) and a
      later field's default (0, its 9 not yet applied) — the declaration-ordered walk, THIS legal there. As FB_Init
      arguments of an inner instance (`_argument`): `THIS^.n` by value 7, and `THIS` as a pointer the inner FB_Init reads
      through, 7 — the owner's earlier fields are initialized when its inner instance's FB_Init runs.
    - M5.1.6 A METHOD's and a FUNCTION's VAR (`var_temp_dynamic_init_method`, `_function`): re-evaluated on every call
      (method: 9 then 10, `* 2 + 1` 19 then 21 in the second scan; function: global 9/10, 19/21, an input `k * 3` 6/15).
      Found while recording: CODESYS refuses VAR_TEMP in a FUNCTION too, so both probes use VAR, the routine's temporary
      section. Gate 5a recorded it as its own fixture, `type_var_temp_in_function` (both vendors: "VAR_TEMP declaration
      not allowed in this place", TwinCAT quoting the kind; record:exec "does not compile" alike) — the LSP's
      `var-section-placement` allowed it ("allowed in FUNCTION (live-calibrated)", no recording behind it) and its src
      test pinned that; both corrected (the src test red first), the fixture `refused`, not an lsp-gap (0 VAR_TEMP in a
      FUNCTION in the six corpora, so no corpus diagnostic moved). `type_var_temp_in_method`'s note corrected.
    - M5.1.7 A dynamic VAR_TEMP aggregate (`var_temp_dynamic_aggregate_init`, an FB called with `k := 3` then `k := 5`):
      every element and field is re-evaluated on every call — `[k, 0 + F(k), g]` gives [3, 6, 9] then [5, 10, 10], `(a :=
      k, c := F(g))` gives (3, 4, 18) then (5, 4, 20), the unwritten `b` its type's 4 each call. So §3.4's reset form is
      STATEMENTS, not `IrFresh` with a folded init. Found while recording: inside an ARRAY initializer `F(k)` is CODESYS's
      repeat count ("Number 'F' of array initialisations is no constant value", even as `F(n := k)`), so the call is
      written `0 + F(k)`; and a variable named `st` is refused as a token ("Unexpected token 'st'") — renamed `rec`.
    - Lowering today (each fixture's first refusal): `init_extends_interleaving` fb-init-order; `init_struct_field_fb_init_scope`,
      `init_gvl_program_slot_order`, all three `var_temp_dynamic_*` init-not-constant (the method's also call-body);
      `_local`, `_sibling`, `init_this_in_initializer_argument` fb-init-argument; `init_this_in_initializer` expr-member.
      All nine the vendor runs are `not-lowered` — no divergence mark.
    - Front-end leads (recorded, not worked on): a VAR_GLOBAL list binds no scope in the front-end dumps, so a GVL
      initializer is NOSCOPE (fold-dump decl, type-dump literal and call, resolution-dump bare name) — pinned as named
      ceiling exceptions in `test/frontend/baseline.ts` (none raises a ceiling); `namesFixture` also matches resolution's
      `fixture <vendor> <name>:` lines. (A variable named `s` or `r` is NOT a lead — gate 5a corrected this note: the
      parser REPORTS errors on such a declaration (`r : INT;` gives 5 errors and a failed declaration, not a silent
      drop), CODESYS's refusal is already recorded by `cc_reserved_name_r`, `_s_upper` and `_s_string` (all `refused`;
      `docs/reserved-il-operators.md`), and no ceiling exception names it.)
    - M (`rate:fixtures`): 5415 -> 5425 fixtures; confirmed 2863 (unchanged), refused 1990, not-lowered 377 -> 386,
      lsp-gap 82 -> 83, diverges 11, unaskable 92; tiers and edge unchanged (edge agree 3097, disagree 3, not-run 185).
    - Numbers (end of step, no VOLT_FIXTURES): `bun test test/conformance` 6321 pass, 386 todo, 0 fail (341 s); `bun test
      test/frontend` 45 pass; `bun test test/analysis` 13 pass (fixtures baselines rewritten: +10 measured, +2 GAP per
      vendor excepted for `_local`); `bun typecheck` clean; `bun run lint` (package) green but the pre-existing
      `last-binding.ts` size warning. Full suite: the gate's.
  - Gate 5a (2026-10-09). Review fixes, each recorded first (one batch per vendor: `record:exec`, `record:language` on
    CODESYS and on TwinCAT Project13): `type_var_temp_in_function` (VAR_TEMP in a FUNCTION refused on both vendors; the
    LSP's `var-section-placement` now flags it, src test red first; M5.1.6), `init_gvl_program_slot_order_renamed` (the
    frame order holds under reordered names; the slot methods' order moves with them; M5.1.4),
    `init_struct_field_fb_init_scope_shadow` and `_dynamic` (fields before globals; the runtime value, the initializer run
    once; M5.1.2); the front-end lead about `s`/`r` corrected (no gap). Named ceiling exceptions for the twins' GVL
    NOSCOPE cells; front-end and analysis baselines rewritten (analysis: `checkVarSectionPlacement` TP 9 -> 10 per vendor,
    corpus unchanged).
    - M (`rate:fixtures`): 5425 -> 5429 fixtures; confirmed 2863 (unchanged), refused 1990 -> 1991, not-lowered 386 -> 389,
      lsp-gap 83, diverges 11, unaskable 92; edge agree 3097 -> 3098, disagree 3, not-run 185.
    - Numbers: `bun typecheck` clean; `bun run lint` green but the pre-existing `last-binding.ts` size warning; full suite
      (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES) 8754 pass, 35 skip, 432 todo, 0 fail (9221 tests, 585 s).
- [x] 5.2 Design "§3.4 Decision: initialization".
  - What: the one ordered walk, the static-versus-dynamic split, the VAR_TEMP reset form decided by `var_temp_dynamic_aggregate_init`,
    the lift of `init-reads-instance`, the IR doc corrections.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 5.1.
  - Done 2026-10-09 (step 5b, design only — no product code; committed as a2b42f56e7). design.md "§3.4 Decision:
    initialization" answers each item of What on 5.1's measurements: the ONE declaration-ordered walk `init/step.ts`
    (frames GVL, POU, called PROGRAMs — M5.1.4; per class of the EXTENDS chain base first, own fields then FB_Init with
    arguments evaluated in the containing frame — M5.1.1; the structured initializer right after that FB_Init — M5.1.3; a
    STRUCT field instance's arguments in the struct's scope — M5.1.2; THIS legal — M5.1.5; slot methods last); the
    static-versus-dynamic split (constants folded into `IrSlot.init` unless an earlier step statement reads the slot, then a
    statement at its position — `cfold_non_constant_argument`, `init_this_in_initializer`; dynamic elements as assignments
    after the static part); the VAR_TEMP reset form decided by `var_temp_dynamic_aggregate_init` (M5.1.7: `IrFresh` with the
    resolved static `IrInit` PLUS the dynamic elements as statements, every call, METHOD/FUNCTION VAR included — M5.1.6);
    `init-reads-instance` kept to its present scope (an instance with a structured initializer; `fb_init_and_structured_initializer`
    pins it only against its own FB_Init), `fb-init-order` lifted, `init-slot-order` new (niche: accepted loss, 0
    occurrences in the corpora — no `call_after_global_init_slot`); the IR doc corrections for `IrPou.init` and `IrSlot.init`
    (applied by 5.10); the rejected alternatives and the 5.3-5.10 migration. Checked against the code at a2b42f56e7: every
    refusal code it keeps exists (`init-reads-instance`, `fb-init-order`, `fb-init-argument`, `attr-init-unreached` in
    `lower/diagnostics/codes.ts`; the structured-initializer scope in `lower/init/sequence.ts`), and every fixture it cites is
    in `map.generated.ts`. No fixture, recording or test changed; M unchanged from gate 5a (5429 fixtures, confirmed 2863,
    not-lowered 389, lsp-gap 83, diverges 11).
  - Gate 5b (2026-10-09). Review fixes, design only (no fixture, recording or code changed):
    - EXTENDS with a field instance running FB_Init (`fb-init.ts` EXTENDS site) is NOT recorded by `init_extends_interleaving`
      (scalar fields only) and is common — a text census of the six corpora finds about 800 FBs that extend a base and
      hold such a field — so it is not niche: §3.4 no longer lifts that site by extrapolation; 5.6 records it first and
      lifts it to the recording. The nested-structured-initializer site stays `fb-init-order`: niche: accepted loss (0
      occurrences in the corpora — no declaration combines FB_Init arguments with any initializer).
    - The constant fold is by POSITION: folded only while no step statement precedes it in its frame; after the first
      one, every constant is a statement at its position — exact for reads AND writes through any path (THIS, a pointer
      handed to an FB_Init, a called body). A later INSTANCE's fields (folded per type) stay refused by `init-reads-later`,
      kept and widened from by-name to any path; §3.4 now names it.
    - `init-slot-order` widened to more than one slot method anywhere (same frame, other frame, other slot value) —
      niche: accepted loss (0 `call_after_global_init_slot` in the corpora).
    - The order among several GVLs and several called PROGRAMs is unrecorded: new `init-frame-order` refuses step
      statements in more than one GVL / called-PROGRAM frame until 5.7 records it.
    - 5.7's Accept corrected: `init-reads-instance` stays at its present scope (§3.4); design.md's pre-decision bullet
      points to the Decision.
    - M unchanged (5429 fixtures, confirmed 2863, not-lowered 389, lsp-gap 83, diverges 11).
    - Numbers: `bun typecheck` clean; `openspec validate` valid; full suite (`VOLT_REQUIRE_FULL=1 bun test`, no
      VOLT_FIXTURES) 8754 pass, 35 skip, 432 todo, 0 fail (9221 tests, 581 s).
- [x] 5.3 Element defaults (RC 25).
  - What: `types/defaults.typeDefault` covers enum (via `types/enums`), alias initializer, alias array and elements;
    `init/initial-values.ts` fills `IrInit` completely; `semantics/instantiate.ts` and `emit/rust/values.initOf` no longer call `typeZero`
    for an element.
  - Where: `types/defaults.ts`, `lower/init/initial-values.ts`, `semantics/instantiate.ts`, `emit/rust/values.ts`.
  - Accept: F(`array_element_type_default`); partial tails stay zero (r_alias_part2 = 0); G+LSP; M.
  - Depends: 5.2.
  - Done 2026-10-09 (step 5c; design.md "§3.4 Decision (step 5c, as built)"). Recorded first, one batch per vendor
    (`record:exec`, `record:language` on CODESYS and on TwinCAT Project13, all six of the step's fixtures; both build clean):
    `array_element_enum_partial_tail` — an ENUM array's partial tail is the enum's DEFAULT (`[E.B]` gives 4, 3, 3), not the
    family zero the plan said; `array_element_alias_of_alias` — an alias of an initialized alias takes its own `:=` only
    (`Plain : Base` 0, `Own : Base := 6` 6; the `aliasInit` ponytail was right, now cited). `IrInit`'s array form is
    `{ elements, rest }` (`ir/program.ts` `IrArrayInit`), complete: `lower/core` `zeroInit` is every slot's default (no scalar
    placeholder for an array); `aggregateInit` states `rest` by `tailStart` — the element's start without an alias's `:=`,
    read from the DECLARED element type (storage erases an enum; `arrayWritten`, `fieldWritten`), an elementary tail with no
    declaration at hand refused by name; `elementDefaults` compact. `instantiate` and `initOf` read `rest` and THROW on an
    array init without elements — which found `arr : ARRAY[0..1] OF INT := 1` (and a struct's, an FB's: `litc_*_init_*`,
    `arrinit_scalar_into_struct_array`, `cc3_input_defaults`) lowering with the scalar dropped in silence: now
    `init-composite-scalar` (invalid; all `refused` by CODESYS already, so only their Rust columns go). The element fact
    stays in `lower/init/initial-values.ts` (`typeDefault` not built — §3.4 step 5c). Src tests: `initial-values.test.ts`
    (the tail, alias-of-alias, the compact `IrInit`, the composite refusal).
- [x] 5.4 RC 30 verified in the new home; the free `initOf` folded in.
  - What: RC 30 was fixed upstream (e06405f97c: `fresh` prints the init-aware `initOf`). The free `initOf(t, IrValue)` becomes a case of
    the one `initOf(t, IrInit)`.
  - Where: `emit/rust/values.ts`, `expr.ts`.
  - Accept: `decl_temp_array_init_resets`, `decl_temp_struct_init_resets` stay confirmed, edge agree; S-out; one `initOf` left (grep).
  - Depends: 5.3.
  - Done 2026-10-09 (step 5c, with 5.3). One `initOf(layouts, t, IrInit)` left (grep: `initOfValue` gone); it prints a
    stated-nothing array as `[x; N]` / `from_fn`, so only fixtures whose undeclared array takes a non-zero element default
    moved shape (`array_element_type_default`), values unchanged; `decl_temp_array_init_resets`, `decl_temp_struct_init_resets`
    confirmed, edge agree. S-out was not measured apart from 5.3 (the two landed as one edit).
- [x] 5.5 A dynamic VAR_TEMP initializer runs on every call (RC 24).
  - Where: `lower/init/temp-resets.ts`, per 5.2's form.
  - Accept: F(`var_temp_dynamic_init`, `var_temp_dynamic_init_method`, `_function`, `var_temp_dynamic_aggregate_init`); M.
  - Depends: 5.4.
  - Done 2026-10-09 (step 5c). `declare.ts` defers a METHOD's/FUNCTION's VAR and VAR_TEMP (`routines.ts` passes
    `deferInit`; every local of a routine runs per call) into `tempInits` (now a list per slot, by LOCAL slot); `routineLocalInits`
    runs them after the VAR_OUTPUT resets, a read of its own or a later local `init-reads-later`. An aggregate's dynamic
    elements and fields (`DynamicLeaves`) are statements after the `IrFresh` of its static part (VAR_TEMP: every run; an
    FB/PROGRAM VAR: once, at its position); one inside `n(…)` refused. Front-end fix found on the way: the parser read a
    STRUCT field's `F(g)` as a repeat with count `F` — the name-then-group repeat is an array element's rule only
    (`parse/initializer.ts`, src test first). F: `var_temp_dynamic_init`, `_method`, `_function`, `var_temp_dynamic_aggregate_init`
    confirmed (Rust and interpreter); also lifted: the 22 `initord_*` fixtures (a FUNCTION's VAR initialized from a global —
    they were `init-not-constant`), `var_input_constant_default_in_init`. Src test: `temp-resets.test.ts`.
- [x] 5.6 Field initializers before FB_Init (RC 22).
  - Where: `lower/init/step.ts`, `init/instance-init.ts`.
  - Accept: F(`tr_22_fb_init_reads_adr_field`, `tr_22_fb_init_reads_call_field`); `tr_22_fb_init_reads_this_field` passes if 5.2 lifts THIS,
    else stays not-lowered with its reason written here; the EXTENDS order per `init_extends_interleaving`; FIRST recorded
    (one batch per vendor, §3.4): an EXTENDS chain holding a field instance that runs FB_Init (field in the derived class,
    with and without the derived FB_Init; field in the base) — `fb-init-order`'s EXTENDS site lifted only to the order
    recorded; its nested-structured-initializer site stays (niche); M.
  - Depends: 5.2.
  - Done 2026-10-09 (step 5c). Recorded first (the 5.3 batch): `init_extends_field_instance` — a derived class's field
    instance's FB_Init at its position, after the base's FB_Init and before the derived FB_Init (1-6), the same without a
    derived FB_Init (7-11); `init_extends_field_instance_in_base` — the base's field instance between its fields, before the
    base's FB_Init (1-6). `visitFields` walks per class of the chain, base first: its own fields (`classRanges`), then its
    FB_Init (`mine` by class); both `fb-init-order` EXTENDS sites gone; the nested-structured site stays (niche, 0). Three
    findings: a bare `THIS` is `ADR(THIS^)` (`adrOperand`); a type's init sequence is built after its layout is set
    (`buildLayout`; THIS in an initializer was `layout-recursive`); a base's initializers run on a derived instance as a
    routine OF THE DERIVED TYPE (`instanceInitRoutine` `on` — the Rust called a method the derived struct lacks). F:
    `tr_22_fb_init_reads_adr_field`, `_call_field` stay confirmed; `tr_22_fb_init_reads_this_field` passes (THIS lifted);
    `init_extends_interleaving`, both new fixtures, `initseq_this`, `expr_this_as_pointer`, `mem_private_method_of_same_type_instance` confirmed.
    `init_this_in_initializer_argument` stays not-lowered: `fb-init-argument` (`THIS^.n` / `THIS` as an FB_Init argument —
    neither a constant nor a variable; 5.8's scope). Src test: `fb-init.test.ts` (the per-class order; the pinned
    `fb-init-order` refusal replaced by the recorded order).
- [x] 5.7 Declaration-ordered interleaving (RC 23).
  - Where: `lower/init/step.ts`, `init/sequence.ts`, `init/fb-init.ts`.
  - Accept: F(`tr_23_fb_init_argument_from_pending_init` got = 4, `tr_23_fb_init_argument_from_pending_init_reversed` got = 0);
    `init-reads-instance` stays at its present scope (§3.4: an instance with a structured initializer); `init-reads-later`
    kept for a later instance's field, by any path (§3.4); the constant fold by position (a constant after the frame's
    first step statement is a statement); FIRST recorded (one batch per vendor): two GVLs and two called PROGRAMs, each
    with a stamping initializer, and a renamed twin — the frame order lifted to it, `init-frame-order` refusing until
    then; `init-slot-order` for more than one slot method; `initseq_*` fixtures stay confirmed; M.
  - Depends: 5.6.
  - Done 2026-10-09 (step 5c). Recorded first (the 5.3 batch): `init_frame_order_several{,_renamed}` — called PROGRAMs
    initialize in the order the POU's body first CALLS them (b, a; A, Z), GVLs in the order they were CREATED (a, b; Z, A),
    which no text states. `init/step.ts` is one declaration-ordered walk: the POU's frame (an initializer that runs, a
    constant once started, an instance's whole init then its structured initializer), then the called PROGRAMs in call order
    (`calledOrder`; more than one not called by the POU's body: `init-frame-order`), then the slot methods. The position rule
    (`init/position.ts`) in the POU's frame and in each instance's frame (the TYPE's field cleared to zero, the constant a
    statement at its position); a VAR CONSTANT, a slot at its zero, and an instance's/struct's own fields are never one.
    `init-reads-later` narrowed to a later struct/instance slot read by name or `THIS^`, or its address (or `THIS`) handed to a
    call. `init-slot-order` (not-measured): several slot methods whose order could show (one calls anything, writes a global,
    or touches a PROGRAM's/dereferenced/in-out storage) — narrower than §3.4's "more than one" so the recorded
    `state_call_after_global_init_counts`, `fb_init_before_slot_method_*` stay confirmed (design.md as built (f)). GVL frames
    stay unwalked (`init-not-constant`, `attr-init-unreached`), so `init_frame_order_several{,_renamed}` and
    `init_gvl_program_slot_order{,_renamed}` stay not-lowered. F: `tr_23_*` (4, 0) and `initseq_*` (8 confirmed;
    `initseq_fb_init_declared_last` not-lowered as before) unchanged; `cfold_non_constant_argument` (0) and
    `init_this_in_initializer` (`THIS^.m` before `m := 9` reads 0) confirmed; `init-reads-instance` unchanged. Src tests:
    `step.test.ts` (position rule in an instance frame, call order both ways, both refusals), `sequence.test.ts` and
    `totality.test.ts` (the pinned scalar `init-reads-later` replaced by the recorded 0; a later struct/instance still refused).
  - M (`rate:fixtures`, steps 5.3-5.7): 5429 -> 5435 fixtures; confirmed 2863 -> 2900, refused 1991, not-lowered 389 -> 358,
    lsp-gap 83, diverges 11, unaskable 92; edge agree 3098 -> 3105, disagree 3, not-run 185 -> 207; no confirmed fixture lost.
  - Gate 5c (2026-10-09). Review fixes, each src test red first:
    - (high) The position rule in an instance's frame wrote the TYPE's layout to zero, so every construction the walk does
      not follow (a VAR_TEMP's per-run reset) started the field at 0 (`tmp.k` 0, was 5), and a structured initializer on the
      instance or struct (`i : FB := (k := 7)`, `sv : ST := (late := 9)`) was overwritten by the type's constant. Now the
      instance's field is zeroed by a statement at the start of ITS walk, the layout untouched, and the instance's own
      structured initializer (or an enclosing one's for a field) re-applied after its whole init — the recorded order after
      FB_Init (`fb_init_and_structured_initializer`). `fb-init.test.ts`.
    - (medium) `calledOrder` ordered by the first call anywhere; now only a PROGRAM first NAMED by a top-level call
      statement (what the recordings show) is ordered — read first, called first in a branch or an expression:
      `init-frame-order` (`leadingCalls` replaces `firstCalls`). `step.test.ts`.
    - (medium) A dynamic leaf inside a repeated NESTED aggregate (`[2([F_Next(), 7])]`) is `aggregate-init`, as a repeated
      dynamic value is. `initial-values.test.ts`.
    - (low) `init-reads-later` also catches a read through a dereference while an initializer of the frame aims a pointer
      or reference at a later struct/instance (`p : POINTER TO T_P := ADR(cfg); i : INT := p^.n;`). `sequence.test.ts`.
    - (low, skipped) The baseline's ceiling exceptions for `init_frame_order_several{,_renamed}` are the known dump limit
      (a VAR_GLOBAL list binds no scope in the front-end dumps, 5.1's lead), not a second GVL unresolved: both NOSCOPE
      lines are the two VAR_GLOBAL lists of the fixture's ONE .gvl file. The comment in `baseline.ts` says so now.
    - M (`rate:fixtures`): unchanged (5435 fixtures, confirmed 2900, not-lowered 358, edge agree 3105); six confirmed
      fixtures' Rust shape moved (the zeroing statement): `tr_22_fb_init_reads_this_field`, `init_this_in_initializer`,
      `cfold_non_constant_argument`, `initseq_adr_of_later`, `initseq_this`, `refdecl_target_after`.
    - Second review (2026-10-09), each src test red first, all three refused by name (no recording; not measured):
      - (medium) A type's running initializer reading a field the instance's structured initializer names answered by the
        field's POSITION (declared before the type's first running initializer: 7, the structured value; after: 5, the
        declared one); `fb_init_and_structured_initializer` records only what FB_Init sees. Now `init-reads-instance`
        (`position.ts` `structuredUnread`; by name, THIS^ or address, every class of the chain; with or without FB_Init).
        Corpora: 5 structured initializers on a declaration in all six, two on an FB (`TON (PT := …)`, a library
        `L_IMHP_ModuleHandler`) — library types, no user initializer reads them. `fb-init.test.ts`.
      - (medium) An ENCLOSING structured initializer reaching a nested instance that runs FB_Init (`o : Outer := (inner :=
        (k := 9))`) was in place at construction, FB_Init saw 9 (on the instance's own declaration: 0, recorded). Now
        `fb-init-order`, as the instance's own nested structured value — niche: accepted loss (0 occurrences in the
        corpora: no nested structured initializer). `position.ts` `enclosingStructuredFree`; `fb-init.test.ts`.
      - (medium) `calledOrder`'s doc promised `init-frame-order` for a PROGRAM reached through another POU; the code looked
        at the root's own statements only (`Mid(); A_Prg(); Z_Prg();`, Mid calling Z_Prg: A before Z in silence). Now any
        lowered body other than the root's (a PROGRAM's, an FB's, a METHOD's, an ACTION's, a FUNCTION's) that CALLS one of
        the ordered PROGRAMs, or runs an action/method on it, is `init-frame-order`. A READ from another POU still orders
        by the root's calls: a first cut on the touched sets (reads included) lost the seven confirmed `initord_chain*`
        (each PROGRAM's initializer reads the next one's instance), so it was narrowed to calls. `step.test.ts`.
    - M (`rate:fixtures`): unchanged (5435 fixtures, confirmed 2900, refused 1991, not-lowered 358, lsp-gap 83, diverges
      11, unaskable 92, edge agree 3105, disagree 3, not-run 207).
    - Numbers: `bun typecheck` clean; `bun run lint` green but the pre-existing `last-binding.ts` size warning; full suite
      (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES) 8837 pass, 35 skip, 401 todo, 0 fail (9273 tests, 618 s).
- [x] 5.8 Appendix init items.
  - What: the scope of a STRUCT field's FB_Init arguments (per `init_struct_field_fb_init_scope`); `insideInstance` refusing
    `holder.started` while allowing `holder.Get()`, made consistent.
  - Where: `lower/init/fb-init.ts`, `init/sequence.ts`, `places/path.ts`.
  - Accept: fixtures plus F or a named refusal.
  - Depends: 5.7.
  - Done 2026-10-09 (step 5d; design.md "§3.4 Decision (step 5d)", followed as written). No recording (every fact is
    M5.1.2's). A STRUCT field instance's FB_Init argument naming a bare name resolves in the STRUCT's scope
    (`fb-init-args.ts` `structField`): a field declared before the instance is read as `holder.field` at that point of the
    walk, before a global of the same name; a later field `init-reads-later`; a variable of the POU declaring the struct
    variable `fb-init-argument` (whatever global shares its name); otherwise a constant or a global, read as
    `fb_init_argument_from_global` reads one. `insideInstance` (`places/path.ts`) now also answers a place stopping ON an
    instance declared with a structured initializer — a METHOD run on it (`holder.Get()`, also through a struct field), the
    instance copied — `init-reads-instance`, as `holder.started`; `ADR(holder)` stays no read. The FB_Init argument code
    moved out of `fb-init.ts` (440 lines with the branch, over the 400 limit) into `lower/init/fb-init-args.ts`
    (`recordedArgument`, `fbInitInput`, `structField`; the refusal tail split out as `refuseInput` to keep `fbInitInput`
    within 80 lines); the move changes no logic. F: `init_struct_field_fb_init_scope_sibling` (4) and `_shadow` (the
    field's 4) confirmed (Rust and interpreter, edge agree). Stay `not-lowered`, with `deferred.transpile` "niche: accepted
    loss (0 occurrences in the corpora)": `init_struct_field_fb_init_scope{,_dynamic}` (`init-not-constant`: a STRUCT
    field's dynamic initializer — a STRUCT has no init frame; the 7 corpus candidates are `SIZEOF(THIS^)`) and
    `init_this_in_initializer_argument` (`fb-init-argument`: `THIS^.n` / `THIS` as an argument; every corpus FB_Init
    argument is a literal). `_local` stays the vendors' refusal (`lsp-gap`, unchanged). Src tests (red first):
    `fb-init.test.ts` (earlier field, field before global, a global in PLC_PRG and in an FB, a later field
    `init-reads-later`, a POU local `fb-init-argument` even where it shadows a global), `sequence.test.ts` (`holder.Get()`
    and `holder.inner.Get()` refused; without a structured initializer it lowers: 6; `ADR(holder)` no read).
- [x] 5.9 The init-sequence read walk no longer skips `select` and freezes (appendix).
  - What: drop the skip option kept in 1.7.4.
  - Where: `ir/walk.ts`, `lower/init/sequence.ts`.
  - Accept: a src test with a select or freeze read in an initializer; S-out.
  - Depends: 5.7.
  - Done 2026-10-09 (step 5d). `initReadChildren` is `childrenOf` with no skip: a select reads its tag and every arm; a
    call its inputs, its freezes, its in-out bindings, its lent places, then its instance. What stays is semantics: `ADR(x)`
    reads only its indices, a freeze its value (its temp is written), a copy binding its value (its `back` is written
    after the call). Src tests (red first): `ir/walk.test.ts` (the order; a select's tag and arm), `sequence.test.ts`
    (`F_Io(x := arr[cfg.n], v := F_Next())` with `cfg` a later struct: `init-reads-later` — it lowered clean and answered
    arr[0] + 1; an earlier index still lowers: 4). `test/conformance/ir-walk.test.ts`'s 1.7.4 oracle (`handReads`, the old
    walk) now checks that every place the old walk read is still read, in its order (a subsequence) — its premise "the
    same walk" ended with this task by design; 11 fixture expressions read more (selects, freezes, lent places). S-out:
    `rate:fixtures` moved no fixture's shape or rating beyond 5.8's two lifted fixtures — no fixture moved to a refusal
    (no hidden read in the fixtures).
- [x] 5.10 Model delta.
  - What: `ir/program.ts` docs (`IrPou.init`, `IrFresh`) corrected; architecture.md initialization paragraph; the map delta.
  - Where: `ir/program.ts`, `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 5.3-5.9.
  - Done 2026-10-09 (step 5d). `IrPou.init` (`ir/program.ts`): the ordered init step — frames in recorded order, per
    declaration a dynamic initializer, a constant after the first statement, or an instance's whole init (per class: fields,
    FB_Init; then its structured initializer); then the slot methods (it named the slot methods only). `IrSlot.init`: the
    folded constant, or the type's start when the step assigns it. `IrFresh` (`ir/expr.ts`): the complete static
    `IrInit`, the dynamic elements the statements after it. `docs/architecture.md`: an *Initialization* paragraph beside
    *Loops*, *Strings* and *Pointers* (the walk, the position rule, the struct scope, the per-call restart, the read walk,
    every refusal by name), and `init/`'s file list (`fb-init-args.ts`, `position.ts`).
  - M (`rate:fixtures`, steps 5.8-5.10): 5435 fixtures; confirmed 2900 -> 2902, refused 1991, not-lowered 358 -> 356,
    lsp-gap 83, diverges 11, unaskable 92; edge agree 3105 -> 3107, disagree 3, not-run 207; no confirmed fixture lost.
    Model 4 over 5.1-5.10: confirmed 2863 -> 2902, not-lowered 377 -> 356 (with 5.1's and 5c's new fixtures counted).
  - Numbers (end of step, no VOLT_FIXTURES): `bun test test/conformance` 6399 pass, 356 todo, 0 fail (340 s); `bun test
    test/frontend` 45 pass; `bun test test/analysis` 13 pass; `bun test src/transpile` 482 pass; `bun typecheck` clean;
    `bun run lint` (package) green but the pre-existing `last-binding.ts` function-size warning. Full suite: the gate's.
  - Gate 5d review fixes (2026-10-09; src tests red first — `fb-init.test.ts` "refused where the struct's scope gives no
    recorded answer", `sequence.test.ts` "an instance handed to a call as an interface", the copy line in the 5.8 test):
    - (medium) An ENCLOSING structured initializer setting the sibling a STRUCT field instance's FB_Init argument reads (`rec :
      DUT := (first := 7)`, an FB's `rr : DUT := (first := 9)`, an outer struct's `inner : DUT := (first := 9)`) was in the
      slot at construction — FB_Init saw 7/9, unrecorded (on an FB instance's own declaration applied after FB_Init). Now
      `fb-init-order` (`fb-init-args.ts` `siblingsUnset`, called from `visitFields` per struct field); a structured
      initializer setting another field still lowers (4). niche: accepted loss (0 STRUCT fields with FB_Init arguments in
      the corpora).
    - (medium) A STRUCT field instance's argument that is an EXPRESSION naming anything (`first + 0`, `-first`, `seed + 0`)
      folded in the declaring POU's scope — the global constant's 11 for a field `first`, a POU constant the struct cannot
      see. Now `fb-init-argument`, as design.md §3.4 step 5d keeps any expression; a literal expression still folds (`-3 +
      1`: -2). niche: accepted loss (every corpus FB_Init argument is a literal).
    - (medium) An instance handed to a call BY NAME as an interface (`F_Get(itf := later)`) lowers to a tag, its place lent
      only after the guards ran (`interfaces/lend.ts`), so the read walk never met it: a later instance with a structured
      initializer gave 3. `sequence.ts` `handedSlots` judges a call's bare-name arguments (operators such as `ADR`,
      `SIZEOF` excepted): a later struct/instance `init-reads-later`, an instance declared with a structured initializer
      `init-reads-instance`; an earlier plain instance still lowers (7).
    - (low) `insideInstance` refused a place stopping ON an FB but not on the STRUCT (or array) holding one: `copy : T_H :=
      holder` copied the structured-initialized state (9). Now any place whose type holds an instance (`path.ts`
      `holdsInstance`) — `init-reads-instance`.
    - (low) `structField` passed a STRUCT- or FB-typed sibling to an elementary input (`{A: 1n}` in an INT). Now
      `fb-init-argument`, as `recordedArgument` requires an elementary variable.
    - (low) The src test pinning `fb-init-argument` for a POU local shadowing a global (`gSeed`) claimed a vendor fact: the
      struct's scope would give the global (6), unrecorded. Kept as a conservative refusal, named so in the test and in
      `structField`'s doc — niche: accepted loss (0 occurrences in the corpora).
    - M (`rate:fixtures`): unchanged (5435 fixtures, confirmed 2902, refused 1991, not-lowered 356, lsp-gap 83, diverges
      11, unaskable 92, edge agree 3107, disagree 3, not-run 207) — no fixture moved.
    - Numbers: `bun typecheck` clean; `bun run lint` green but the pre-existing `last-binding.ts` size warning;
      `bun test src/transpile` 484 pass; full suite (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES) 8846 pass, 35 skip, 399
      todo, 0 fail (9280 tests, 605 s).

## 6. Remaining open root causes (one task each, in the new structure)

Each task: a src test red first, the fix, then F and M. A RC closed upstream or by frontend-conformance (0.1) becomes "verify in the
new home": its test and fixture stay green, nothing else. RC 26 is task 4.0; RC 30 is task 5.4.

- [x] 6.1 RC 2.3: a CONSTANT reference lowers to its folded value.
  - Where: `lower/places/names.ts`, `values/fold.ts`, `types/const/fold.ts` (`asConstant`).
  - Accept: F(`named_const_expression_keeps`) (d2 = 128 and e = 258 read); `named_const_literal_wrap` stays confirmed; G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6a, verify). Closed upstream (cf95980537): `named_const_expression_keeps` and `named_const_literal_wrap`
    confirmed (rust vendor, edge agree); the fold is `types/const/fold.ts` (`frontend/types/const/fold.test.ts`), the lowering
    test `pipeline/arith.test.ts`. No code change.
- [x] 6.2 RC 6: an out-of-range literal keeps its own type.
  - Where: `types/literal.ts` `contextLiteralType` (range rule), `values/convert.adopt`, `values/promote.meet`.
  - Accept: F(`tr_6_literal_beyond_dint_neighbour`) (gNegLint TRUE, sumNegLint -2999999995, sumUdLint 5000000005, …);
    F(`lt_literal_negative_in_comparison_unsigned`) (`ui > -1` FALSE as CODESYS records it: an untyped negative literal beside
    an unsigned operand is not converted into the unsigned type — rule LT12; filed by 0a, see 0.2);
    `cc_literal_3e9_into_dint` stays confirmed; G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6a). `tr_6_literal_beyond_dint_neighbour` and `cc_literal_3e9_into_dint` stay confirmed (lowering's
    `values/convert.ts` `beside`, src `values/promote.test.ts`). F(`lt_literal_negative_in_comparison_unsigned`): new
    `expressions/operators.ts` `negativeBesideUnsigned` — an untyped NEGATIVE literal compared with a narrower UNSIGNED operand
    converts into the type the front-end's `negativeLiteralComparisonTarget` names (UDINT on CODESYS, rule LT12) before the
    meet, as an explicit `convert` of the literal at its own type (SINT), so the pair meets in UDINT and the IR fold
    still reads the literal as -1 (`fold-agreement.test.ts`); `ui > -1` is FALSE as recorded (was TRUE). Src `values/promote.test.ts` "…converts into UDINT (LT12)" (red first:
    b2/b3 TRUE). The fixture's `deferred.transpile` is gone; it rates confirmed (rust vendor, edge agree; the one fixture whose
    Rust changed in 6a-6d). The shared `contextLiteralType` home (H5) stays open: LT14 still pins the classes where it and
    `literalCheckType` disagree, each needing a recording before a switch — not this task's Accept.
    - Corpus (`probe-lowering-refusals.ts`, a HEAD worktree vs the 6a-6d tree): identical, 304 POUs, 250 refused.
    - M (6a-6d together, `rate:fixtures`): mapped 5441 (+6 new fixtures); confirmed 2902 -> 2904 (`lt_literal_negative_in_
      comparison_unsigned`, `tr_38_ref_store_explicit_conversion`), refused 1991 -> 1994 (the three `tr_38_ref_store_*`), not-lowered
      356 -> 357 (`tr_43_routine_output_word_to_int`), lsp-gap 83 -> 84 (`tr_43_routine_output_dint_to_int`), diverges 11 -> 10,
      unaskable 92; tier `indirect` 446 -> 447 (441 -> 442 clean); edge agree 3107 -> 3108, disagree 3, not-run 207; pedantic
      32633 -> 32677; allowed `dead_code` 5654 -> 5670; median size 3.1; shapes 1799 -> 1800, constructs 2064 -> 2065, noted
      constructs 681. Only `lt_literal_negative_in_comparison_unsigned`'s Rust changed among existing fixtures. No note resolved.
    - Tests (end of 6a-6d, once each): `bun typecheck` clean; `bun run lint` (package) green but the pre-existing `last-binding.ts`
      size warning; `bun test src/transpile src/frontend src/analysis scripts` 1808 pass / 0 fail; `bun test test/conformance`
      6414 pass, 357 todo, 0 fail; `bun test test/frontend` 45 pass (baselines rewritten for the six new fixtures: counts only, no
      disagreement row moved); `bun run test:corpus` 19 pass, 1 skip.
    - Gate 6a+6d (2026-10-10), three findings on 6.2, each failing test first, decided by RECORDINGS (five new fixtures
      `tr_6_negative_{int,dint,lint,paren,expression}_beside_unsigned`, `fixtures/semantics/execution.ts`; CODESYS
      record:exec, then record:language on CODESYS and TwinCAT, one batch each):
      - (medium) LT12 applied to every negative literal class though only -1 (SINT) was recorded. Recorded now: -200 (INT)
        and -40000 (DINT) beside a UINT/USINT convert into UDINT, -3000000000 (LINT) into ULINT, every one FALSE on CODESYS;
        TwinCAT converts into UINT / UDINT / ULINT. So the rule holds for every class, its target being the unsigned type as
        wide as the WIDER of the literal's own class and 32 bits (CODESYS) / the operand (TwinCAT):
        `types/arith/operators.ts` `negativeLiteralComparisonTarget` (it gave UDINT for the LINT literal — the same run value,
        the wrong type). Src `analysis/checks/types/narrowing.test.ts` "…of a wider class…" (red first: no LINT warning),
        `lower/values/promote.test.ts` "LT12 for every negative literal class…".
      - (medium) the transpiler's dialect branch: lowering now asks the rule with `EXEC_ORACLE_DIALECT` (new,
        `lower/conditions.ts`, the one `prepareProject` binds every lowering project with — it already bound "codesys",
        so the TwinCAT branch was unreachable there; now it is said by name, not read back off the project). No
        `dialectOf` in `src/transpile`.
      - (low) a parenthesised literal: CODESYS `ui > (-1)` is FALSE with the SINT → UDINT warning (TwinCAT: SINT → UINT), as
        the bare literal; `ui > 0 - 1` is TRUE, no CODESYS warning — a constant expression is no literal. Both halves read
        the operand through `types/literal.ts` `unparenthesised` (new); the bound census's LT12 explainer too. The
        transpiler was TRUE on the paren form (red first). TwinCAT warns "unsigned Type 'UINT' to signed Type 'INT'" on
        `0 - 1`, which the LSP cannot type (an operation on untyped numbers is context-typed, LT14): niche: accepted loss
        (0 occurrences in the corpora — no comparison of an unsigned operand with a constant expression of untyped numbers),
        a named GAP exception in `test/frontend/baseline.ts`.
      - The five rate confirmed (rust vendor, edge agree). Corpus (`probe-lowering-refusals.ts`): 304 POUs, 250 refused,
        unchanged.
- [x] 6.3 RC 12: LDT/LDATE/LTOD → STRING.
  - Where: `semantics/text.ts` + `text.cases.ts` (the 11 recorded cells, incl. the wrap past 2262), `runtime/text.ts`, `emit/rust/convert.ts`,
    `types/predicates.hasTextFormat` for the gate in `builtins/conversions.ts`.
  - Accept: F(`tr_12_fmt_long_dates`) (the Rust compiles); twin test green.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6a, verify). Closed upstream (2564e50b83): `tr_12_fmt_long_dates` confirmed (rust vendor), the 11
    `LONG_CALENDAR_TEXT_CASES` twin green. `builtins/conversions.ts` `hasText` now asks `types/predicates.hasTextFormat` (it
    asked `isTemporal` of the name — the same predicate; output-neutral).
- [x] 6.4 RC 19: a METHOD's in-out shadows a field or VAR_STAT.
  - Where: `lower/places/names.ts`.
  - Accept: F(`tr_19_method_inout_shadows_member`, `tr_19_method_inout_shadows_var_stat`) (res = v = 101).
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6a, verify). Closed upstream (ad6825592f): both `tr_19_*` confirmed (rust vendor); src
    `places/names.test.ts`. No code change.
- [x] 6.5 RC 21: a FUNCTION keyed and scoped by symbol identity.
  - What: bare calls use `symbols/precedence.pickForAsker`; `resolveNamedType` requires an asker, its callers (entry/lower-unit,
    places/globals, storage/layout, storage/bytes, types/infer `enumValueType` — appendix) pass one.
  - Where: `lower/calls/variants.ts`, `calls/namespace.ts`, `types/resolve.ts`.
  - Accept: F(`tr_21_namespace_qualified_first`, `tr_21_namespace_bare_first`) (a = 1020, b = 3); G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6a). Bare calls already pick by `pickForAsker` (`calls/invoke.ts`, closed upstream cf64cc0ba2;
    `tr_21_namespace_*` confirmed, src `calls/namespace.test.ts`). `resolveNamedType(name, project, askerUri, depth = 0)`: the
    asker is REQUIRED (no default; a caller with no file says `undefined` — tests, the compiler's own structs). Callers: lowering
    `entry/lower-unit`, `builtins/sizeof`, `pointers/image` (`scopeUri(lw.scope)`), `places/globals` (`sym.uri`),
    `storage/layout` (the type's own `sym.uri` for its EXTENDS base); `types/infer/expr` (`scopeUri(scope)`),
    `types/infer/member` `enumValueType` (the value's own `sym.uri` — the appendix line); the analysis callers through
    `ctx.uri` (`analysis/shared/hole.ts` `enumTypedLiteral`/`literalHole`/`literalHoleWithin` take it, `isHole` passes
    `scopeUri(scope)`); `test/frontend/bound-census.ts`. H3 for 6.5: `calls/invoke.ts` (a namespace FUNCTION) and
    `init/fb-init.ts` (`FB_Init`) read `lookupLocal`, not the map. Src `frontend/types/resolve.test.ts` "an enum value is of
    the enum its own library declares…" (red first: CBML's FROMCBML typed as CBM's E_X). design.md §6.1 row 14 updated.
- [x] 6.7 RC 28: MAX/MIN/LIMIT on REAL.
  - What: compare-select `IF a>b THEN a ELSE b` (MIN: `a<b`), LIMIT = MIN(MAX(mn, in), mx).
  - Where: `ir/expr.ts` contract, `semantics/builtins.ts` + `numeric.cases.ts`, `emit/rust/builtins.ts`.
  - Accept: `semantics/builtins.test.ts` on the recorded NaN and ±0 cells; twin test; F(`tr_28_minmax_limit_nan_signed_zero_{real,lreal}`)
    once 4.12 lowers them.
  - Depends: 1.9.4, 4.12.
  - Done 2026-10-09 (step 6b). Closed upstream in both backends (7da3814d3d). New case table `semantics/numeric.cases.ts`
    `SELECT_CASES` — the 18 recorded cells of `tr_28_minmax_limit_nan_signed_zero_{real,lreal}` (w1-w9 as bits, each naming the
    NaN or -0 bits it ran on); new `semantics/builtins.test.ts` runs them through `builtinValue` (values, `Object.is`); the twin
    (`test/conformance/runtime-twins.test.ts`) holds them to the recording and runs `iec_fmax`/`iec_fmin` (LIMIT as
    MIN(MAX)) — the bits, the NaN's sign included. The two `tr_28_*` keep their marks: 4.12 decided the interpreter's REAL stays
    a JavaScript number (niche: accepted loss, the NaN's sign bit); the Rust keeps every bit (the twin shows it).
    `scripts/check-citations.ts` PLANNED loses the `semantics/builtins.test.ts` entry.
- [x] 6.8 RC 29 verified in the new home.
  - What: closed upstream (3dd773b9d7): `RESERVED_FN_NAMES` (new, call, scan, clone, to_owned, clone_into, into, try_into) in `names.ts`.
  - Where: `emit/rust/names.ts`, `names.test.ts`.
  - Accept: all eight `tr_29_method_named_{clone,to_owned,into,try_into}_{result,no_result}` stay confirmed, edge agree.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6b, verify). `RESERVED_FN_NAMES` in `emit/rust/names.ts` (`names.test.ts`); all eight
    `tr_29_method_named_*` confirmed, rust vendor, edge agree. No code change.
- [x] 6.9 RC 31: BIT conversions decide bool-ness via `isBoolValued`.
  - Where: `emit/rust/convert.ts`.
  - Accept: F(`tr_31_bit_conversions`) (compiles; 'TRUE'; INT_TO_BIT(2) = TRUE).
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6b). `tr_31_bit_conversions` confirmed (rust vendor); src `emit/rust/convert.test.ts`.
    `emit/rust/types.ts` `emittedFamily` — the one place the emitter decides bool-ness — asks `isBoolValued` (it asked
    `isBit` and the family; the same answer, output-neutral).
- [x] 6.10 RC 32: `iec_ltime_text(ns: u64)`, no `i64` cast for LTIME (the LDT/LDATE `as i64` stays, per RC 12).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: F(`tr_32_fmt_ltime_past_i64`); twin test.
  - Depends: 6.3.
  - Done 2026-10-09 (step 6b). Closed upstream (2bb72d5428): `tr_32_fmt_ltime_past_i64` confirmed; `iec_ltime_text(ns: u64)`
    and the uncast LTIME in `emit/rust/convert.ts` (`convert.test.ts`). New `LTIME_TEXT_CASES` (`semantics/text.cases.ts`,
    the four recorded cells either side of 2^63 ns and at the u64 maximum), run by `text.test.ts` (`ltimeText`) and the twin
    (recording and input held; `iec_ltime_text(<n>u64)`).
- [x] 6.11 RC 33: LREAL_TO_STRING rounds a tie half-up (17 exact digits).
  - Where: `runtime/text.ts`; the cells in `text.cases.ts`.
  - Accept: F(`tr_33_fmt_lreal_tie`); twin test.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6b, verify). Closed upstream (69caa32921): `tr_33_fmt_lreal_tie` confirmed; `LREAL_TIE_CASES` in
    `text.test.ts` and the twin. No code change.
- [x] 6.12 RC 37: CASE labels out of type or inverted are refused (CODESYS refuses all four).
  - Where: `lower/statements/case.ts`.
  - Accept: `tr_37_case_label_wraps_300`, `_wraps_minus_212`, `tr_37_case_range_inverted`, `_beyond_type` refused by the transpiler; the
    LSP half is already met (all four rate `refused`; lsp-transpile-review-gaps 1.3, ticked by 0.7).
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6c, verify). Closed upstream (194319e648): the four `tr_37_*` refused; src
    `statements/case.test.ts`. No code change.
- [x] 6.13 RC 38: implicit STRING↔WSTRING and non-string→STRING refused via `types/compat.classifyConversion`.
  - What: stores, chain links, stores through a REFERENCE (appendix), arguments and compares; LEN(WSTRING) (appendix).
  - Where: `lower/statements/assign.ts`, `expressions/operators.ts`, `calls/outputs.ts`, `calls/binding.ts`.
  - Accept: `string_wstring_mixing` and `uop_*` refused (rows lose tier and rust; the `uop_neg_real` edge disagreement gone);
    `standard_len_wstring_rejected` refused; any LSP half Filed; M.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6c). Stores, chain links, arguments and compares closed upstream (8531164eca); `string_wstring_mixing`,
    every `uop_*` and `standard_len_wstring_rejected` stay refused. The open line — a store THROUGH A REFERENCE — recorded FIRST
    (CODESYS record:exec, one batch with 6.17's two): `tr_38_ref_store_string_into_int`, `_int_into_string`,
    `_string_into_wstring` ("Cannot convert type 'STRING' to type 'REFERENCE TO INT'" …) and `_explicit_conversion` (12).
    `statements/assign.ts` `storeValue` asks `refuseImplicitString` of the reference's target (all three lowered);
    `refuseImplicitString` decides through `types/compat.classifyConversion` (`incompatible`, a string side) — the same answers.
    Src `statements/assign.test.ts` "a store through a REFERENCE refuses…" (red first). The three rate refused — the LSP objects
    already, so there is no LSP half (lsp-transpile-review-gaps 1.5 ticked with that); `_explicit_conversion` confirmed.
- [x] 6.14 RC 40: DATE/DT/TOD ± LTIME is refused.
  - Where: `types/arith/temporal.ts`, `lower/expressions/calendar.ts`.
  - Accept: `tr_40_date_plus_ltime`, `tr_40_dt_plus_ltime`, `tr_40_tod_minus_ltime`, `tr_40_ltime_plus_date` refused by the transpiler and the
    LSP (the lsp-gap closes); G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6c, verify). Closed upstream (1d84643239): the four `tr_40_*` refused by the transpiler
    (`expressions/operators.ts` via `narrowDateWideDuration`; src `expressions/calendar.test.ts`) and the LSP. No code change.
- [x] 6.15 RC 41: MUX/SEL evaluate only the selected input; LIMIT follows the recorded order.
  - Where: `ir/expr.ts` (evaluation contract per builtin), `semantics/builtins.ts`, `lower/builtins/value-functions.ts`, `emit/rust/builtins.ts`.
  - Accept: F(`tr_41_mux_side_effects`, `tr_41_sel_side_effects`, `tr_41_limit_evaluation_order`) (x = 4); both edge disagreements gone.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6c, verify). Closed upstream (03b9de81e9): the three `tr_41_*` confirmed, edge agree; SEL/MUX
    evaluate only the selected input in `interp/machine.ts` (`selectedArg`) and `emit/rust/builtins.ts` (`builtins.test.ts`).
    No code change.
- [x] 6.16 RC 42: `typeKey` keys arrays by element plus bounds, recursively.
  - Where: `lower/calls/variants.ts`.
  - Accept: F(`tr_42_any_array_variant_key`) (the Rust compiles).
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6c, verify). Closed upstream (62ebd765b1): `tr_42_any_array_variant_key` confirmed (rust vendor);
    `calls/variants.ts` `typeKey` keys element and bounds recursively (`calls/specialize.test.ts`). No code change.
- [x] 6.17 RC 43: output bindings use `isAssignable`, on both paths.
  - Where: `lower/calls/outputs.ts`.
  - Accept: F(`tr_43_output_word_to_int` a = -1, `_word_to_udint` 65535, `_int_to_real` -3.0); `tr_43_output_dint_to_int` refused.
  - Depends: 4.11.
  - Done 2026-10-09 (step 6d). The FB path closed upstream (900c8c30b6): the three `tr_43_output_*` confirmed,
    `tr_43_output_dint_to_int` refused. The ROUTINE path (`calls/outputs.ts` `bindOutputArgument`) decides by `isAssignable`
    too: one an assignment refuses stays `call-output-type`; one it converts is refused by name, `call-output-convert` (new,
    not-modelled) — its copy-out stores the callee's type unconverted; niche: accepted loss (0 occurrences in the corpora: no
    corpus POU is refused `call-output-type` or `call-output-convert`, `probe-lowering-refusals.ts`). Recorded (CODESYS
    record:exec): `tr_43_routine_output_word_to_int` (t = -1; not-lowered, its `deferred.transpile` gives the reason) and
    `tr_43_routine_output_dint_to_int` ("Cannot convert type 'DINT' to type 'INT'"; the LSP accepts it — lsp-gap,
    `MEASURED_SILENT`, the map.test ceiling 83 -> 84, Filed lsp-transpile-review-gaps 2.4). Src `calls/outputs.test.ts` "a
    routine output binding decides by the assignment relation…" (red first).
  - Gate 6a+6d (2026-10-10), two findings on 6.17:
    - (low) the niche count was a count of REFUSED POUs, not of the pattern. Counted now as the bindings themselves (every
      `=>` in a call of a FUNCTION / METHOD / PROGRAM across the six corpora, the callee's VAR_OUTPUT type against the
      target's): 35 routine output bindings — FUNCTION 1, METHOD 14, interface METHOD 17, PROGRAM 3 — none converting (the
      179 converting ones are all FB outputs, the path that converts; 6 more are FB array elements `arr[i](q => …)`). The
      reason now says so (`outputs.ts`, `outputs.test.ts`, `tr_43_routine_output_word_to_int`'s `deferred.transpile`).
      This task's title is met as: both paths DECIDE by `isAssignable`; the FB path converts, the routine path refuses
      the converting half by name (`call-output-convert`, niche) — its copy-out does not carry a `convert`.
    - (low) the six fixtures (`tr_38_ref_store_*`, `tr_43_routine_output_*`) had run recordings only. Now record:language on
      CODESYS and TwinCAT (one batch each, with the five `tr_6_negative_*`): the three `tr_38_ref_store_*` are "Cannot
      convert type 'STRING' to type 'REFERENCE TO INT'" (and twins) on both, and the LSP agrees; `_explicit_conversion`
      builds clean on both; `tr_43_routine_output_dint_to_int` is "Cannot convert type 'DINT' to type 'INT'" on both and
      `_word_to_int` the WORD → INT sign warning on both — neither said by the LSP (lsp-transpile-review-gaps 2.4, named GAP
      exceptions in `test/frontend/baseline.ts`). "unrecorded, no LSP parse error" back to 152 (CODESYS) / 163 (TwinCAT).
- [x] 6.18 RC 46: EXPT.
  - What: a correctly rounded pow with C semantics for the edge cells, and a stop on 0 ** finite-negative in both backends. Measure first
    whether `1e19**8` needs an exact integer-exponent path.
  - Where: `semantics/math.ts` + `numeric.cases.ts`, `ir/faults.ts` (`exptDomain`), `runtime/numeric.ts` `iec_expt`, `emit/rust/builtins.ts`.
  - Accept: F(the seven diverging `tr_46_exptdom_*`); `_nan_pow_zero` and `_zero_pow_minus_inf` stay confirmed; `op_math_expt` and
    `expt_mixed_width` edge ULP agreement; twin test.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6d, verify). Closed upstream (c581ac19e3): all nine `tr_46_exptdom_*` confirmed (the two
    zero-to-a-finite-negative as a stop match); `op_math_expt` and `expt_mixed_width` confirmed (edge not-run: libm). Measured:
    1E19 ** 8 NEEDS the exact integer-exponent path in the interpreter (JavaScriptCore's pow is ULPs out; `semantics/math.ts`
    `integerPower`); the Rust's `powf` answers 1E+152 as recorded. New `EXPT_CASES` (`numeric.cases.ts`, the nine cells, a
    value or `stop`), run by `math.test.ts` and the twin (recording held; `iec_pow`'s bits, its panic caught as `stop`).
- [x] 6.19 RC 47: int→REAL rounds once (the bigint rounded to 24 bits with a sticky bit).
  - Where: `semantics/convert.ts` `toReal`; the cell in `numeric.cases.ts`.
  - Accept: F(`tr_47_i2r_lint_to_real_double_round`); the edge disagreement gone.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6d, verify). Closed upstream (bc17d0a441): `tr_47_i2r_lint_to_real_double_round` confirmed, edge
    agree. New `INT_TO_REAL_CASES` (`numeric.cases.ts`, its four recorded cells), run by `convert.test.ts` (`coerce`) and the
    twin (recording held; Rust `as f32`, the emitter's conversion).
- [x] 6.20 RC 48: the vendor oracle only for discriminating recordings.
  - What: rate all-default recordings `compiles` (exempting `prim_default_*`), or give the `cc_` fixtures discriminating initializers and
    re-record — choose, and write the reason here. Also closes the appendix line "UDINT op DINT fixtures run only on zeros".
  - Where: `test/conformance/support/transpile/correctness.ts`, `fixtures/batches/check-coverage.ts`.
  - Accept: M (the 158 affected rows move as chosen).
  - Depends: 1.8.4.
  - Done 2026-10-09 (step 6d, verify). Chosen upstream (0ca79f7bae) and kept: an all-default recording from all-default constants
    rates `compiles`, `prim_default_*` exempt (`support/transpile/correctness.ts`). The reason: re-recording the `cc_` fixtures
    with discriminating initializers would change the question each one asks, while the rating makes the claim honest at no
    cost. It closes "UDINT op DINT fixtures run only on zeros" too. Today 168 confirmed rows rate `compiles` (41 `cc_`).
- [x] 6.21 The trig vendor-routine divergences stay named (design.md §7.2).
  - What: `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` keep their expected-failure marks, each with the x87 argument-reduction
    reason in `support/divergences.ts` and a pointer to `semantics/math.ts`.
  - Where: `test/conformance/support/divergences.ts`, `semantics/math.ts`.
  - Accept: G; the three marks carry the reason; 8.2 counts them as accepted.
  - Depends: 1.9.4.
  - Done 2026-10-09 (step 6d). The three reasons live in `test/conformance/support/divergences.ts` `X87_TRIG_DIVERGENCES`
    (the x87 kernel / the 66-bit argument reduction, each pointing at `semantics/math.ts`); each fixture's `deferred.transpile`
    reads its entry. All three still diverge (expected failures). design.md §7.2 updated.
  - Gate 6a+6d end (2026-10-10): `bun typecheck` clean; `bun run lint` green but the pre-existing `last-binding.ts` size
    warning; M (`rate:fixtures`): mapped 5441 -> 5446 (the five `tr_6_negative_*`), confirmed 2904 -> 2909, refused 1994,
    not-lowered 357, lsp-gap 84, diverges 10, unaskable 92; arith 1545 lowered (1543 clean); edge agree 3108 -> 3113, disagree
    3, not-run 207. Baselines rewritten (counts; the analysis census's three new GAP rows named). Full suite
    (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES) 8883 pass, 35 skip, 400 todo, 0 fail (9318 tests, 579 s).
    One commit for 6a-6d and this gate, as with 1.6a-1.6d: the four steps share files (`numeric.cases.ts`,
    `runtime-twins.test.ts`, `execution.ts`, the recordings, the map and every baseline) and no intermediate tree was kept.

### 6.A Appendix A and B items (LOW, unverified: record first, then fix, refuse, or close with the recording as the reason)

- [x] 6.A.1 LTIME_TO_TIME / LDT_TO_DT sub-unit truncation.
  - Where: `lower/builtins/conversions.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Aa). Recorded first (CODESYS record:exec, one batch with every 6.A fixture):
    `tr_a1_ltime_to_time_subunit`, `tr_a1_ldt_to_dt_subunit`, `tr_a1_ldt_to_tod_date_subunit`, `tr_a1_ltod_to_tod_dt_subunit`
    (fixtures/semantics/execution.ts) — a remainder just below one target unit, half of one and below half, every coarser pair
    (LTIME→TIME, LDT→DT/TOD/DATE, LTOD→TOD/DT). CODESYS TRUNCATES everywhere (LTIME#1s500ms999us999ns → T#1s500ms,
    LTOD#23:59:59.999999999 → TOD#23:59:59.999, LDT …23:59:59.999999999 → the same DATE). `tickConversion`'s `div` already does:
    closed with the recording, no code change; all four confirmed (TwinCAT has no LDT/LTOD: its three build recordings refuse
    them, as the existing `xf_ldt_*` do).
- [x] 6.A.2 REAL intermediates rounded per step (`real-overflow.ts`).
  - Where: `semantics/arith.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Aa). Recorded `tr_a2_real_intermediate_per_step`: `(big + one) - big` 0, `huge * three / three`
    Infinity, a REAL sum stored into an LREAL 1E8 — every REAL intermediate rounded to f32 per step (SSE). `fit` already rounds
    each node: closed with the recording (confirmed), no code change.
- [x] 6.A.3 MIN MOD -1 (live run; Appendix B mod-min-by-minus-one).
  - Where: `semantics/arith.ts`, `runtime/numeric.ts`.
  - Accept: recording plus F or close; the answer written here (7.3.13 reads it).
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Aa). Recorded `arithedge_{sint,int,dint,lint}_mod_min_by_minus_one` (operators/arithmetic-edges.ts,
    beside `div_min_by_minus_one`; the two that stop recorded each alone, a fault poisoning a batch). THE ANSWER (7.3.13 reads
    it): DINT and LINT `MIN MOD -1` STOP THE TASK, as `MIN / -1` does (x86's `idiv`); SINT and INT answer 0 (computed in DINT,
    where -128 / -32768 are no minimum). Both backends answered 0. `semantics/arith.ts` throws `division-overflow` for MOD as
    for `/` in the computation width; `emit/rust/expr.ts` prints `%` (which panics on exactly that overflow) instead of
    `wrapping_rem`. Src `semantics/arith.test.ts` (new, red first); `emit/rust/expr.test.ts`, `names.test.ts` read the new `%`.
    All four confirmed. The MOD construct changed in every fixture holding one: 24 NOTES re-keyed to the `x % x` construct
    (support/notes/notes.data.ts, text unchanged).
- [x] 6.A.4 SHL/SHR/ROL counts through BigInt.
  - Where: `semantics/builtins.ts`.
  - Accept: a src test with a count above 2^53; S-out.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Aa). `semantics/builtins.ts` `bitValue` masks / reduces the count as the exact bigint it is
    (`countOf`; a non-integer count is a LoweringBug); `Number()` rounded a ULINT count above 2^53. Src
    `semantics/builtins.test.ts` "SHL / SHR / ROL / ROR read a count above 2^53 exactly" (2^53 + 1 and 2^64 - 1; red first).
    S-out ✓ (`snapshot:transpile check --layers outputs,edge` against a baseline written from the HEAD source: no fixture's
    output or edge verdict moved but the 6.A fixtures' own).
  - Gate review fix (6Aa+6Ae gate, 2026-10-10): `countOf` threw its LoweringBug for a count that is no integer, which
    lowering let through — SHL(dw0, 2.0) threw out of the scan, and out of `lowerSource` itself in an initializer (6.A.9's
    `constantValue` re-throws it); at HEAD `Number()` quietly gave 4. What CODESYS does with a REAL count is unrecorded:
    `lower/builtins/value-functions.ts` `lowerShift` refuses a count of any type but an integer or bit string by name,
    `shift-count` (not-measured, `lower/diagnostics/codes.ts`). Src `value-functions.test.ts` (body and initializer, red first).
- [x] 6.A.5 `x := F(o => x)`: which write wins.
  - Where: `lower/calls/outputs.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
  - Done 2026-10-10 (step 6Aa). Recorded `tr_a5_function_output_and_result_same_variable` (`x := F(o => x)` 1, `y := F(o => y) +
    10` 11) and `tr_a5_method_output_and_result_same_variable` (1) — calls/call-shapes.ts. The RESULT wins: the output is copied
    out, then the call's value stored. Both backends already do (F: both confirmed); no code change.
- [x] 6.A.6 Const-generic in-out names colliding (`<x>_<n>`).
  - Where: `emit/rust/names.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ab). `emit/rust/types.ts` `inoutType`: an open array's dimension generics are `D_<NAME>_<d>` beside a
    STRING's `N_<NAME>` — `grid : ARRAY[*, *]` (`N_GRID_2`) beside `grid_2 : STRING` (`N_GRID_2`) declared one generic twice
    (E0403). Within the arrays the names cannot meet (distinct fields; the dimension is the digits after the last `_`). Src
    `emit/rust/types.test.ts` (red first). The only fixtures touched are the ones with an open-array in-out of 2+ dimensions
    (`N_GRID_2` → `D_GRID_2`).
- [x] 6.A.8 Exact refusal codes contradicting their prefix families.
  - Where: `lower/diagnostics/codes.ts`.
  - Accept: `codes.test.ts` asserts each code's kind agrees with its prefix or carries a written reason.
  - Depends: 1.2.2.
  - Done 2026-10-10 (step 6Ab). `lower/diagnostics/codes.ts` `FAMILY_EXCEPTIONS`: each exact code inside a prefix family whose
    kind differs carries its reason — `expr-call`, `stmt-call_stmt` (unsorted call shapes, not a missing kind), `layout-base`
    (inherits the base's own refusal), `layout-union` (two refusals under one code), `layout-unmeasured` (not-measured),
    `layout-recursive` (invalid); `routine-var_output` classified `not-measured` (its own message says so — the family's kind),
    so the unclassified ratchet 84 → 83. `codes.test.ts`: every exact code in a family agrees or has a reason; every reason
    names a code that still differs.
- [x] 6.A.9 `constantValue` swallows non-LoweringBug throws.
  - Where: `semantics/fold.ts`.
  - Accept: a src test; S-out.
  - Depends: 1.3.3.
  - Done 2026-10-10 (step 6Ab). `semantics/fold.ts` `constantValue` answers "not constant" only on a FAULT — a `RangeError`, as
    every fault the interpreter throws is (`IecFault`, and the index / character-position faults whose text names a number; the
    conformance harness's fault test is the same) — and re-throws anything else (a `TypeError` out of a value function, a
    `LoweringBug`). Src `semantics/fold.test.ts` (new; the TypeError case red first). S-out ✓ (as 6.A.4): no fold in the
    fixtures threw anything else.
- [x] 6.A.10 STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5'.
  - Where: `semantics/parse.ts`, `runtime/parse.ts`.
  - Accept: recording plus F; twin cells.
  - Depends: 3.5.
  - Done 2026-10-10 (step 6Ab). Recorded in three rounds, each answer asking the next (`tr_a10_string_to_int_literal_forms`,
    `_bits_literal_forms`, `_dint_based_edges`, `_int_based_wider_than_target`, `_dint_underscore_sign_edges`, `_64bit_based`;
    48 cells). The rule (`semantics/parse.ts` `parseInteger`, mirrored line for line by `runtime/parse.ts` `iec_parse_int`):
    after spaces and tabs, with NO sign a based number written `2#`, `8#` or `16#` reads its digits in that base ('16#FF' 255,
    '2#101' 5, '8#17' 15, '16#ff' 255), no other base ('3#12' 3, '10#99' 10, '016#F' 16) and none after a sign ('-16#F' -16,
    '+16#F' 16); else a sign and decimal digits; an underscore anywhere among the digits skipped ('1_000' 1000, '_5' 5, '-_5'
    -5, '16#_F' 15), any other character ending them ('16#G' 0, 'INT#5' 0, '1 0' 1); 64-bit wrap, then the target's ('16#FFFF'
    INT -1, '16#123456789' DINT 591751049). It read decimal digits only ('16#FF' was 16). The bit-string targets parse the same
    (`STRING_TO_BYTE`/`WORD`/`DWORD`/`LWORD`, measured here): `lower/builtins/conversions.ts` `parses` admits them — which
    lowers the eight `xp_{string,wstring}_to_{byte,word,dword,lword}` (not-lowered → confirmed). Twin cells:
    `semantics/parse.cases.ts` (48 cells, each naming its recording), `parse.test.ts` (red first), `runtime-twins.test.ts` (each
    cell and its input held to `codesys.run.json`; `iec_parse_int` built and run). Unasked: a base written with an underscore in
    it ('1_6#F'). All six confirmed.
  - Gate review (6Aa+6Ae gate, 2026-10-10): "wraps at 64 bits" was written as recorded, but the one recorded number past
    2^64 ('16#1FFFFFFFFFFFFFFFF' → all ones, `lPast`) has its low 64 bits all ones, where wrapping, saturating and dropping the
    extra digits agree. Recording a number where they part needs a new fixture recorded on CODESYS and built on both vendors —
    not trivial — and the corpora hold no STRING_TO_LWORD/_ULINT/_LINT call: niche: accepted loss (0 occurrences in the
    corpora). `semantics/parse.ts` `parseInteger`'s doc now says so instead of claiming the wrap as recorded.
- [x] 6.A.11 `overridesCalled` resolves SUPER^.M() against the frame.
  - Where: `lower/core/ast-walk.ts`, `calls/super.ts`.
  - Accept: a src test plus F.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ab). Recorded `tr_a11_super_method_on_overriding_leaf` (call-shapes.ts): a middle FB's METHOD calling
    `SUPER^.Hit()`, run on a leaf that overrides Hit and leaves its VAR_IN_OUT unbound — CODESYS runs it (hits 1; it warns the
    leaf's Hit accesses the in-out from outside). `lower/core/ast-walk.ts` `overridesCalled`: `SUPER^.M()` is the BASE's M, a
    member of the chain, never an override — looked up against the frame it bound the leaf's in-out into the middle METHOD and
    the call faulted ("call through an interface that holds no instance", 6.A.28's message). Src `lower/core/ast-walk.test.ts`
    (new, red first). F: confirmed. A base METHOD reached through SUPER^ that itself calls an override using the leaf's in-out
    stays refused `call-fb-inout`, as before (checked, unchanged).
- [x] 6.A.12 A bare METHOD call with an unconnected VAR_OUTPUT in an FB body.
  - Where: `lower/calls/invoke.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
  - Done 2026-10-10 (step 6Ac). Recorded `tr_a12_bare_method_call_unconnected_output` (call-shapes.ts): an FB body calling its
    own METHOD bare (`Count();`) and with the output bound to its own field (`Count(o => seen)`) — CODESYS runs both (calls 4,
    seen 40 after two scans). Both were refused `call-inout-alias`: the unconnected output's temp was a FIELD of the instance
    the call holds, and the bound field aliased it. `lower/calls/outputs.ts` `bindUnconnectedOutputs`: a copy of the output's
    initial value lent `&mut` and written back nowhere (`IrCopy.discarded`, `ir/expr.ts`; `emit/rust/printer.ts`
    `lend`/`lentCopies`), no frame temp; `calls/binding.ts` `bindPlace`: a VAR_OUTPUT copied out after the call is no lent
    `&mut`, so a place the call holds is no alias. Src `lower/calls/outputs.test.ts` (red first). F: confirmed — and five more
    lower and confirm (`oopb_abstract_method_output_default`, `oopb_concrete_method_output_default`,
    `oopb_implicit_abstract_output_default`, `sym_method_output_param_bound`; `inh_override_input_as_output`,
    `oopb_base_output_type_mismatch` lower too, refused by the vendor). Three NOTES about the persistent `__output_N` field
    resolved (deleted: `1647895e3b`, `782a04d94c`, `f1b8c2a1e6`).
  - Gate review fix (6Aa+6Ae gate, 2026-10-10): `docs/data-model.md` documents `IrCopy.discarded` on `IrBinding`'s copy.
- [x] 6.A.13 The stale `calledLayout` doc about VAR_TEMP.
  - Where: `lower/calls/routines.ts`.
  - Accept: doc fixed.
  - Depends: 1.6.18.
  - Done 2026-10-10 (step 6Ac). `lower/calls/routines.ts` `calledLayout`'s doc: an FB's VAR_TEMP starts over on every call
    (`resetTemps`, conformance `life_fb_var_temp_calls`) — no longer "refused, until recorded".
- [x] 6.A.14 SHL/SHR of an untyped literal into a 64-bit destination.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ac). Recorded `tr_a14_shift_untyped_literal_wide` and `_variable_count` (execution.ts): SHL(1, 40)
    into an LWORD or LINT is 2^40, into a DWORD 0; SHL(1, 65) into an LWORD 2; with a VARIABLE count SHL(1, n40) into an LWORD
    is 2^40 and SHL(1, n33) into a DWORD 2; `SHR(SHL(1, 40), 8)` 2^32. So an untyped literal shifted by a constant count folds
    in 64 bits (count masked to 63), and by a variable count shifts in the destination's width when that is 64 bits (DINT
    otherwise). Lowering shifted every one in DINT (SHL(1, 40) was 256). `lower/builtins/value-functions.ts`
    `untypedShiftOperand` (the expected type flows `lowerExpr` → `lowerBuiltin` → `lowerValueFunction`); ROL/ROR untouched
    (6.A.30). F: both confirmed. The AST fold leaves a body's untyped shift unfolded (no context, frontend-conformance 4.6.1's
    `UNTYPED_OPERAND`): the eight new fold disagreements are `fold-agreement.test.ts` KNOWN — niche: accepted loss (0
    occurrences in the corpora: the 268 `SHL/SHR(<literal>, …)` there are all declaration initializers, where the context types
    them and the folds agree).
  - Gate review fixes (6Aa+6Ae gate, 2026-10-10): `untypedShiftOperand` used `lowerExpr`'s `expected` as "the type it is
    stored into", but a binary operator hands its right operand the LEFT operand's type — `lw0 + SHL(1, n40)` shifted in 64
    bits (2^40) and `SHL(1, n40) + lw0` in DINT (256), and the same unrecorded widening reached call arguments, FOR bounds and
    comparisons. And a negative literal was guessed LINT (SHR(-8, 1) into a LINT -4, where an LWORD reading gives 2^63 - 4),
    a named CONSTANT count took the variable-count path (SHL(1, C40) into a DWORD 256, where the literal-count fold gives 0).
    None of it recorded, all niche (0 body shifts of an untyped literal in the six corpora; the 268 initializers there all
    have a literal count and a non-negative literal): only the recorded shapes lower — a non-negative literal by a literal
    count anywhere (the compile-time fold), by a plain variable count only as the WHOLE value of a `:=` store (`lowerExpr`'s
    new `stored`, passed by `statements/assign.ts` alone) — and the rest is refused by name, `shift-untyped-width`
    (not-measured). Src `value-functions.test.ts` (the recorded stores' values; both operand orders, a MAX argument, a
    negative literal, a named constant count refused; red first). No fixture moved.
- [x] 6.A.15 A huge repeat count builds every leaf before the size check.
  - Where: `lower/init/initial-values.ts`.
  - Accept: a src test (check first); S-out.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ac). Checked first: `[100000000000(1)]` into ARRAY[0..1] hung (killed at 60 s).
    `lower/init/initial-values.ts` checks a repeat against the array's capacity BEFORE building its leaves. Src
    `initial-values.test.ts` "a repeat count past the array refuses before it builds a leaf" (< 1 s). S-out ✓ (as 6.A.4).
- [x] 6.A.16 An X address bit index above 7.
  - Where: `lower/storage/addresses.ts`.
  - Accept: recording plus refusal.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ac). Recorded `tr_a16_mx_bit_index_8`, `_qx_bit_index_15`, `_ix_bit_index_9`
    (declarations/addresses.ts): CODESYS (and TwinCAT) ACCEPT a bit index above 7 and count it on into the next byte — `%MX0.8`
    is bit 0 of `%MB1` (next 1). No refusal to add: `storage/addresses.ts` `addressBits` already counts `n * 8 + bit`. Closed
    with the recording: the QX and IX cells confirmed; the MX cell is not-lowered by the existing alias refusal (`var-at`: a
    BOOL overlapping a BYTE needs the byte-addressable area), not by the bit index.
- [x] 6.A.17 GVL1.x / GVL2.x sharing one slot.
  - Where: `lower/places/globals.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ad). Recorded `tr_a17_two_lists_one_name_both_qualified` (names/name-rules.ts, two plain lists each
    declaring `g_a17`): outA 3, outB 5, and writing list a's leaves b's 5 — two variables. `lower/places/globals.ts`
    `listPrefix`: a list's variable is keyed `<list>.<name>` when the list is `qualified_only` or another list declares the name
    (bare, such a name is ambiguous and refused, `ambg_*`); it was keyed by the bare name, one slot. `emit/rust/module.ts`
    numbers the second Rust field (`g_a17_2`) where it threw. Src `lower/places/places.test.ts` (red first). F: confirmed.
  - Gate review fix (6Aa+6Ae gate, 2026-10-10): `emit/rust/module.ts` had turned `fieldNames`' contract-name refusal off for
    EVERY global, so two different ST names snaking to one field (GVL_a.myVal, GVL_b.my_val) were silently suffixed `_2`,
    and which list kept the plain name followed which body reached it first (globals are declared lazily). Now a slot of a
    name another list declares carries its list (`IrSlot.list`, set by `places/globals.ts` `listVariable`; `ir/program.ts`,
    `docs/data-model.md`) and its field is `<list>_<name>` (`gvl_one_g`, `gvl_two_g` in either reach order); the refusal is
    back for everything else. Src `emit/rust/module.test.ts` (both reach orders; myVal/my_val refused; red first).
- [x] 6.A.18 Uniform write guards.
  - What: every store applies the full `guardWrite` set, removing the per-site lists of 1.7.5; the differences recorded first.
  - Where: `lower/places/access-guards.ts`.
  - Accept: a src test per store kind; M.
  - Depends: 1.7.5, 1.9.4.
  - Done 2026-10-10 (step 6Ad). The differences recorded first: a character stored through a REFERENCE TO STRING
    (`tr_a18_char_store_through_reference`: 'aXc', already right) and a FOR loop counting a REFERENCE TO INT
    (`tr_a18_for_counter_through_reference`: CODESYS counts the referenced variable, v 4; lowering counted the reference's own
    slot, v 0). The per-site lists are gone: every store names one of three (`places/access-guards.ts`) — PLAIN_WRITE
    (`open-array`, `constant`) for a plain `:=`, a reference's target and an FB input stored into its instance (the stores that
    model an interface and a union member themselves); FULL_WRITE (`interface`, `through-reference`, `union`, `constant`) for a
    lent place (in-out binding, ANY argument); STORE_WRITE (`open-array` + FULL_WRITE) for every other store (chain link, latch,
    FB output, FOR variable, character). Behaviour moved only where recorded (the FOR variable); the rest of each change is a
    check that cannot fire (an integer is no interface, a STRING place no ARRAY[*]). The character store now writes the place
    `guardWrite` returns. Src: `statements/loops.test.ts` (FOR through a REFERENCE, red first), `places/access-guards.test.ts`
    (every store kind into a VAR_IN_OUT CONSTANT refused: latch, character, output, input into a lent instance, a reference's
    target, in-out binding, ANY argument; the `:=`, chain and FOR in the test above). M (whole run, at the end).
  - Gate review (6Aa+6Ae gate, 2026-10-10): beside the recorded FOR change, the uniform sets ADD checks no recording stands
    behind — an FB output `q => target`, a latch S=/R= and a chain link now also check `open-array`; a character store
    `s[i] :=` (was `constant` only) also checks `interface`, `through-reference`, `union` and `open-array`; a FOR variable
    also `interface` and `open-array`. They are UNRECORDED REFUSALS, never a changed value, and no fixture moved; the review's
    example (a character store into a UNION's STRING member) is refused before the store by `layout-union` at HEAD and now
    alike (probed). Kept, and named here as unrecorded refusals: none of them fires in a fixture.
- [x] 6.A.19 An FB body call stores its inputs before binding its in-outs.
  - Where: `lower/calls/fb-call.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ad). Recorded `tr_a19_fb_call_inout_beside_moving_input` (call-shapes.ts): `fb(io := arr[i], inp :=
    Bump(i))` binds arr[0] (101), `fb(inp := Bump(j), io := arr[j])` arr[1] (201) — an in-out is bound WHERE IT IS WRITTEN, on
    the FB path as on the routine path (`callshape_inout_binding_order`). It was refused `call-inout-order`.
    `lower/calls/fb-call.ts` `fbArguments`: an in-out written before an input holding a call has its runtime parts frozen into
    temps there (`calls/binding.ts` `frozenWhereWritten`, factored out of `bindWhereWritten`; `movedInOut` deleted); a copied
    value stays refused. Src `lower/calls/fb-call.test.ts`. F: confirmed.
- [x] 6.A.20 The const fold accepts `**`, `&` and REAL MOD.
  - What: remove them; `const/fold.test.ts` drops the `**` case (its premise is contradicted by the input contract).
  - Where: `types/const/fold.ts`.
  - Accept: G+LSP (or verified closed by frontend-conformance).
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ad). `**` and `&` closed by frontend-conformance 2.5a (verified: the parse refuses them;
    `const/fold.test.ts` holds no `**` case). REAL MOD recorded: `tr_a20_real_mod_in_initializer` (`rl : REAL := 5.5 MOD 2.0`)
    "MOD is not defined for REAL", both vendors. `types/const/fold.ts` `foldNumber` no longer folds MOD; the LSP was silent
    there (an untyped real literal is UNKNOWN beside another, and `binaryOpError` skipped the operand):
    `analysis/shared/rules.ts` names an untyped real literal LREAL for MOD (only MOD — the other operators beside a string or
    BOOL are unrecorded). Src `const/fold.test.ts`, `checks/types/binary-operators.test.ts` (red first). G+LSP: the fixture
    rates refused; corpus gate, lsp-replay, build oracle green.
- [x] 6.A.21 REAL_MAX_MAGNITUDE below f32::MAX, and the second constant in infer.
  - Where: `types/elementary.ts`, `types/infer/*`.
  - Accept: G+LSP; one constant.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ad). Recorded `tr_a21_typed_real_below_max` (REAL#3.4028234E38 builds, holds 3.40282347E+38),
    `_rounds_to_max` (3.4028235E38), `_rounds_to_infinity` (3.4028236E38), `_negative_rounds_to_max` — the last three "too large
    for type 'REAL'", both vendors: the bound is f32's largest EXACTLY. `types/literal.ts` `REAL_MAX_MAGNITUDE` REAL is
    3.4028234663852886e38 (was 3.402823e38, so the first was called too large), and `literalCheckType` reads it — ONE constant.
    The same recordings showed an LSP false positive beside the error (an LREAL → REAL warning for a TYPED literal): the "beyond
    REAL's largest is an LREAL" rule is the untyped literal's only. `primitive-bounds.ts` writes doc 06's 3.402823E38 out
    (`DOCUMENTED_LARGEST`) so its recorded texts stay. Src `types/literal.test.ts` (two tests, red first). G+LSP.
- [x] 6.A.22 Inferred STRING(N)/ARRAY[1..N] folded in project scope.
  - Where: `types/infer/expr.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
  - Done 2026-10-10 (step 6Ae). Verified closed by frontend-conformance 4.6.2 (62bcb30d65, rule CE8: `infer/expr` resolves a
    variable's type, its STRING(n) and array bounds, in its declaring scope): `ce_string_length_constant_assign` / `_init`
    confirmed, `checks/types/string-constant.test.ts` holds it. G+LSP green.
- [x] 6.A.23 A negated or parenthesised real literal in SIN/SQRT infers UNKNOWN.
  - Where: `types/infer/expr.ts`, `types/literal.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
  - Done 2026-10-10 (step 6Ae). Recorded `tr_a23_bare_real_literal_sin_into_int`, `_negated_…_sin_into_int`,
    `_parenthesised_…_sqrt_into_int` (each "Cannot convert type 'LREAL' to type 'INT'", both vendors) and
    `tr_a23_signed_real_literal_in_math` (the values; LREAL → REAL warned). `types/literal.ts` `isUntypedNumber` (negated or
    parenthesised at any depth); `infer/expr.ts` hands `mathResultType` "a literal" for one — SIN(-1.5), SQRT((2.0)),
    COS(-(0.5)), EXP((-1.0)) are LREAL (were UNKNOWN). Src `infer/expr.test.ts` (red first). The two refusals the LSP missed
    rate refused. G+LSP.
- [x] 6.A.24 Member access does not walk EXTENDS.
  - Where: `types/infer/member.ts` on `lookupMember` / `extendsChain`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
  - Done 2026-10-10 (step 6Ae). Verified closed by frontend-conformance 3.2.3 (461b70fc4d: `infer/member` uses `lookupMember`,
    which walks EXTENDS). G+LSP green.
- [x] 6.A.25 Subrange bounds dropped.
  - Where: `types/resolve.ts`.
  - Accept: recording (`a : INT(3..9)`), then refuse the subrange by name or model it; G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ae). Recorded `tr_a25_subrange_defaults` (grammar/type-expressions.ts): a subrange with no
    initializer starts at 0 when its range holds 0, else at its LOWER bound — INT(3..9) 3, INT(-5..5) 0, DINT(-10..-2) -10 (not
    the bound nearer 0), INT(0..9) 0, an ARRAY's elements, a STRUCT's field and a named subrange DUT 3
    (`decl_subrange_unsigned`: UINT(1..5) 1). Modelled in `types/defaults.ts` `typeZero` (the slot default every backend reads).
    Src `lower/init/initial-values.test.ts` (red first). F(`decl_subrange_unsigned`): its divergence mark removed, confirmed
    (partial-run.test.ts's "diverges" row now `op_math_trig`); `tr_a25_subrange_defaults` confirmed. `decl_subrange_reversed`
    (refused) now starts at its written lower bound 10 — outside the input contract. G+LSP.
- [x] 6.A.26 Qualified `Lib.T` resolved by its bare name.
  - Where: `types/resolve.ts` (qualifiers).
  - Accept: G+LSP.
  - Depends: 6.5.
  - Done 2026-10-10 (step 6Ae). Verified closed by frontend-conformance 3.4.2 (1bdaf58172: `types/resolve` `namespaceOf`,
    `resolveQualifiedType`; `resolve.test.ts` "a qualified type name", `lib_ns_type_qualified*`). G+LSP green.
  - Steps 6Aa-6Ae end (implement agent, 2026-10-10; the gate commits). Recorded in ONE CODESYS record:exec batch (29 fixtures)
    and two follow-ups (the 6.A.10 / 6.A.14 second and third rounds, the two MIN MOD -1 cells that stop), then every new fixture
    build-recorded on CODESYS and TwinCAT (`ide.ps1 -Instance transpile-restructure`, CODESYS fixture copy, TwinCAT
    `-Fixture 13`; both IDEs closed). 38 new fixtures: 31 confirmed, 7 refused (the LSP objects to each), 1 not-lowered
    (`tr_a16_mx_bit_index_8`, the alias refusal). M (`rate:fixtures`): mapped 5446 -> 5484, confirmed 2909 -> 2952, refused
    1994 -> 2001, not-lowered 357 -> 346, lsp-gap 84, diverges 10 -> 9, unaskable 92; lowered/clean decl 748/748, arith
    1575/1573, control 158/147, aggregate 135/135, call 297/294, indirect 460/455; edge agree 3113 -> 3160, disagree 3, not-run
    207 -> 210; median size 3.1; pedantic 32694 -> 33578; surviving lints unchanged; ALLOWED excused: dead_code 5670 -> 5883,
    the rest unchanged; 73 existing rows changed (the MOD construct's Rust, 6.A.3; the newly lowered and re-rated ones); NOTES
    681 -> 678 (3 resolved by 6.A.12, 24 re-keyed by 6.A.3); shapes 1805 -> 1844. Baselines rewritten: `test/frontend`
    (counts; the new fixtures' context-typed untyped numbers, SHL/SHR of untyped literals and one `s[i]` are named
    `CEILING_EXCEPTIONS` in `frontend/baseline.ts`, no ceiling raised) and `test/analysis` (TP counts only, no new FP or
    GAP). Runs at the end: `bun typecheck` clean; `bun run lint` green but the pre-existing `last-binding.ts` size warning;
    `bun test src scripts` 2233 pass; `test/frontend` 45 pass; `test/analysis` 13 pass; `test/conformance` (whole, no
    VOLT_FIXTURES) 6509 pass, 0 fail; `test/corpus` + `test/catalog` + `test/libraries` 189 pass. S-out against a baseline
    of the HEAD source: only the 6.A fixtures, the four MIN MOD -1, `decl_subrange_unsigned`/`_reversed` and the newly lowered
    ones moved.
    Per step, for separate commits — 6Aa: `semantics/arith.ts`(+test), `semantics/builtins.ts`(+test), `emit/rust/expr.ts`,
    `expr.test.ts`, `names.test.ts`, `support/notes/notes.data.ts` (re-key), fixtures `tr_a1_*`, `tr_a2_*`, `tr_a5_*`,
    `arithedge_*_mod_min_by_minus_one`. 6Ab: `emit/rust/types.ts`(+test), `lower/diagnostics/codes.ts`(+test),
    `semantics/fold.ts`(+new test), `semantics/parse.ts`, `parse.cases.ts`, `parse.test.ts`, `emit/rust/runtime/parse.ts`,
    `runtime-twins.test.ts`, `lower/builtins/conversions.ts`, `lower/core/ast-walk.ts`(+new test), fixtures `tr_a10_*`,
    `tr_a11_*`. 6Ac: `lower/calls/outputs.ts`(+test), `calls/binding.ts` (the VAR_OUTPUT alias), `ir/expr.ts`
    (`IrCopy.discarded`), `emit/rust/printer.ts`, notes.data.ts (3 deleted), `lower/calls/routines.ts` (doc),
    `lower/builtins/value-functions.ts`, `builtins.ts`, `expressions/expressions.ts`, `fold-agreement.test.ts` (UNTYPED_SHIFT),
    `lower/init/initial-values.ts`(+test), fixtures `tr_a12_*`, `tr_a14_*`, `tr_a16_*` (declarations/addresses.ts). 6Ad:
    `lower/places/globals.ts`, `emit/rust/module.ts`, `places.test.ts`, `places/access-guards.ts`(+test),
    `statements/assign.ts`, `statements/loops.ts`(+test), `calls/fb-call.ts`(+test), `calls/binding.ts`
    (`frozenWhereWritten`), `types/const/fold.ts`(+test), `analysis/shared/rules.ts`, `binary-operators.test.ts`,
    `types/literal.ts` (REAL bound, typed-literal rule)(+test), `fixtures/types/primitive-bounds.ts`, fixtures `tr_a17_*`
    (names/name-rules.ts), `tr_a18_*`, `tr_a19_*`, `tr_a20_*`, `tr_a21_*`. 6Ae: `types/literal.ts` (`isUntypedNumber`),
    `types/infer/expr.ts`(+test), `types/defaults.ts`, `initial-values.test.ts` (subrange), `grammar/type-expressions.ts`
    (`tr_a25_*`, `decl_subrange_unsigned`'s mark), `partial-run.test.ts`, fixtures `tr_a23_*`. Shared by all five (one commit
    is the honest unit, as for 6a-6d): `fixtures/semantics/execution.ts`, `calls/call-shapes.ts`, the three recordings,
    `map.generated.ts`, `frontend/baseline.ts` + `frontend/baselines/*`, `analysis/baselines/*`, design.md (§4 fold.ts row,
    §6 status rows 6.A.20/21/23/25).
  - Gate 6Aa+6Ae (2026-10-10): the review's seven findings, each written under its task — fixed: 6.A.4 (`shift-count`),
    6.A.14 (`shift-untyped-width`: only the recorded shapes lower), 6.A.17 (`IrSlot.list`, the field-name refusal back),
    6.A.12 (data-model.md `discarded`); niche, documented: 6.A.10 (a number past 2^64, 0 in the corpora); noted: 6.A.18 (the
    unrecorded refusals the uniform sets add). Two new codes, both not-measured. `bun typecheck` clean; package lint green
    but the pre-existing `last-binding.ts` size warning. M (`rate:fixtures`): unchanged from the steps' run — mapped 5484,
    confirmed 2952, refused 2001, not-lowered 346, lsp-gap 84, diverges 9, unaskable 92; edge agree 3160, disagree 3, not-run
    210. Full suite (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES, rustc cache sampled): 8995 pass / 0 fail (35 skip, 389
    todo; 9419 tests, 313 files; was 8883 at 6a+6d). Committed one commit per step, 6Aa → 6Ae; a file two steps touch goes
    with the later one, and the files every step shares (execution.ts, call-shapes.ts, the three recordings, map.generated.ts,
    the baselines, design.md, tasks.md) with 6Ae — so 6Aa-6Ad alone are the code, and the tree is green at 6Ae.
- [x] 6.A.27 Unsigned counter with a negative constant step.
  - Where: `lower/statements/loops.ts`.
  - Accept: absorbed by 2.4; closed with a reference to it.
  - Depends: 2.4.
  - Done 2026-10-10 (step 6Af). Closed by reference to 2.4 / RC 35 (8f6ae481e6: `tr_35_for_byte_step_minus_one`,
    `_uint_step_minus_two` confirmed). Rule by rule, the counters RC 35 did not record: `tr_a27_for_unsigned_counters_negative_step`
    (USINT 5 TO 1 BY -1, WORD 9 TO 2 BY -3, UDINT 100 TO 50 BY -45, DWORD 7 TO 3 BY -2, ULINT 20 TO 5 BY -5, LWORD 4 TO 1 BY -1:
    5, 3, 2, 3, 4, 4 runs, each counter ending past its limit without wrapping), `tr_a27_for_byte_named_constant_step` (a SINT
    CONSTANT -2 on a BYTE counter: 3 runs, b = 2), `tr_a27_for_uint_negated_parenthesised_step` (BY -(3): 3 runs, u = 0) —
    all build on both vendors, all confirmed with no code change. No code.
- [x] 6.A.28 An unbound FB VAR_IN_OUT from a METHOD panics with the "interface" message.
  - Where: `ir/faults.ts` (its own kind), `lower/calls/last-binding.ts`, both backends.
  - Accept: a src test; both backends print the new message.
  - Depends: 1.2.4, 1.9.4.
  - Done 2026-10-10 (step 6Af). `ir/faults.ts` `FaultKind` `unbound-inout` ("a METHOD or ACTION reached its FB's VAR_IN_OUT
    before any call of the FB bound it"); `IrDispatch.fault` names which stop a tag no arm names is (`no-instance` from
    `interfaces/dispatch.ts`, `unbound-inout` from `calls/last-binding.ts`); the interpreter (`interp/machine.ts`) throws and the
    emitted Rust (`emit/rust/calls.ts` `exprDispatch`) panics with `e.fault`. `docs/data-model.md` IrExpr row. Src
    `lower/calls/last-binding.test.ts` "an in-out reached before any call bound it stops with its own fault" (red first: the
    interface text), both backends. `callshape_inout_method_before_binding` (the vendor stops, no message) confirmed.
- [x] 6.A.29 A named DINT/LINT constant folds unbounded in an initializer but wraps at run time (`types/const/fold.ts`, Appendix A grouped).
  - What: record the case (a CONSTANT whose initializer overflows its declared width, used in another initializer and read at run time);
    fold it at its declared width in the initializer too, or close with the recording.
  - Where: `types/const/fold.ts`, `lower/values/fold.ts`.
  - Accept: recording plus F or close; G+LSP.
  - Depends: 6.1.
  - Done 2026-10-10 (step 6Af). Recorded (codesys.run + both builds) a CONSTANT whose expression overflows its type, read in
    an initializer, at run time and through another constant: `tr_a29_dint_constant_expression_overflow` (K DINT max, D := K + 1,
    F := D - 1: the monitor shows D DINT#2147483648 and F DINT#2147483647, but x1 : LINT := D and x2 := D are -2147483648),
    `_dint_constant_overflow_into_dint`, `_udint_…` (U monitored 4294967296, read 0), `_int_…` (32768 read 32768), `_byte_…`
    (B : BYTE := 255 + 1 monitored and read 256), `_dword_…` (W monitored 2^32, read 0). So a constant EXPRESSION is held
    unwrapped (what the monitor shows) and every READ of it is the value in its type's RUN-TIME width — DINT for a narrower
    type (`named_const_expression_keeps`'s 128 survives), the type itself from 32 bits — while another constant's initializer
    folds on from the held value. Lowering read the wide slot (x1 2147483648, u 4294967296). Past 64 bits
    (`tr_a29_lint_constant_expression_overflow`, `_ulint_…`, `_dint_constant_overflow_past_lint`, `Q := K * K * 4`): CODESYS
    builds clean and fails to log in (code generation; each recorded alone), TwinCAT refuses "Initialisation of constant
    variable 'D' not constant" (and the constant naming it): `execSkip` (unaskable), lowering refuses `constant-overflow`
    (invalid). Code: `types/const/fold.ts` `read` (a constant read outside a constant's own initializer, `FoldContext.inConstant`),
    `constantSlotType` takes a bit string too (BYTE 256 → WORD); `IrSlot.readAs` (`ir/program.ts`, data-model.md),
    `storage/declare.ts` `constantSlot` (+ `constant-overflow`, and `constant-unsigned-negative` not-measured for an unsigned
    fold below 0, unrecorded), `places/access-guards.ts` `loadValue` converts a `readAs` slot's load, `core/lowering.ts` `slot`
    carries it. THE LOWERING HALF of the design §6 row: an initializer is folded with its declared type as the context
    (`constEval(…, declared)`, `values/fold.ts` `foldConstant`, `init/initial-values.ts` `scalarInit`) — `ce_fold_untyped_in_context_values`
    (`c1 : WORD := NOT 0`, 65535) not-lowered "init-not-constant" → confirmed. Src `pipeline/arith.test.ts` (two tests, red
    first), `const/fold.test.ts` (two tests + two `constantSlotType` lines, red first). `fold-agreement.test.ts`: a `readAs`
    load with its conversion is the read (`irBySpan`). F: all nine value fixtures confirmed. The TwinCAT refusal of a constant
    past 64 bits is not said by the LSP — niche: accepted loss (0 occurrences in the corpora: such a constant runs on neither
    vendor), 4 TwinCAT GAPs named CEILING_EXCEPTIONS. G+LSP.
  - Gate review fixes (6Af gate, 2026-10-10): (1) a NOT, shift or rotation of a constant HELD past its type gave two
    silent answers — the front-end took the operand's 8-bit pattern (ROL(B, 1) 0), lowering rotated its DINT read with the
    bits above riding along (256) and NOT inverted 32 bits (4294967039). Recorded (`tr_a29_widened_constant_reads`, run;
    `tr_a29_rol_bound_widened_byte_constant`, both vendors): ROL(B, 1) 2, ROR 128, SHR 128, NOT 255, in a body, a VARIABLE's
    and a CONSTANT's initializer alike — the held value, cut to the declared width after. `types/const/fold.ts` `shift` works
    on the non-negative held value; `places/access-guards.ts` `heldConstantOperation` (NOT in `expressions/operators.ts`, the
    shifts in `builtins/value-functions.ts` `lowerShift`) lowers such an operation as the front-end's fold, and refuses one
    the fold has no value for `held-constant-operand` (not-measured). (2) SIZEOF of such a constant measured the wide slot
    (D 8, B 2); recorded `tr_a29_sizeof_bound_widened_dint_constant` 4 and `_byte_constant` 1, both vendors — the declared
    type: `IrSlot.declared` (`ir/program.ts`, data-model.md), set with `readAs`, read by `builtins/sizeof.ts`. Src
    `const/fold.test.ts` "a shift or rotation of a constant held past its type works on the held value",
    `builtins/value-functions.test.ts` "… folds on the held value", `builtins/sizeof.test.ts` "SIZEOF of a CONSTANT held in a
    wider slot is its declared type's" (each red first).
- [x] 6.A.30 Appendix B rotate-in-promoted-width (an ANY-argument ordering bug, no recording).
  - What: record a live case (ROL/ROR with an ANY argument whose evaluation order matters); fix or close with the recording.
  - Where: `lower/builtins/value-functions.ts`, `semantics/builtins.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Af). The ordering question recorded: `tr_a30_rotate_argument_order` (semantics/execution.ts, ROL /
    ROR / SHL / SHR with both arguments calls that change one variable, and ROL of a promoted BYTE sum into a WORD): the value
    runs first (x = 4 everywhere; ROL 32, ROR 32, SHL 32, SHR 0, the sum 40) — confirmed, no code. The width question 6.A.14
    left here (ROL / ROR of an UNTYPED literal): `tr_a30_rotate_untyped_literal` / `_variable_count` (ROL(129, 1) 3 into a BYTE
    and 258 into a WORD, DWORD, LWORD; ROR(1, 1) 2^(width - 1); ROL(16#80000001, 1) 3 into a DWORD, 2^32 + 2 into an LWORD; a
    literal and a variable count alike), `_initializer` (the same as VAR and VAR CONSTANT initializers), `_into_int` (258 into
    an INT, -2^31 into a DINT), `_in_expression` (`ROL(129, 1) OR w0` 258, `d0 OR ROR(1, 1)` 2^31). Lowering rotated the
    literal in its own 8 bits (3, 128): `value-functions.ts` `untypedRotateOperand` — the whole value of a store into an
    integer type that holds the literal rotates in that type; an operand of an operator (the destination's width or the other
    operand's — no recording tells them apart), a negative literal, a destination too narrow refused `shift-untyped-width`
    (`_in_expression` not-lowered: niche, 0 ROL / ROR of an untyped literal in the six corpora); the initializers fold with
    their declared type as the context (6.A.29's `constEval(…, declared)`). Src `lower/builtins/value-functions.test.ts`
    "ROL / ROR of an untyped literal" (three tests, red first). F: the four lowered fixtures confirmed. `fold-agreement`: the
    five body rotations the AST fold leaves without a context are KNOWN `UNTYPED_ROTATE` (niche, 0 in the corpora).
  - Gate review fixes (6Af gate, 2026-10-10): (1) the refused shapes were refused in a store only — an initializer folds
    with its declared type as the context and gave them a silent value (`b1 : BYTE := ROL(16#1FF, 1)` 255, a CONSTANT's the
    same, `w : WORD := ROL(16#1FFFF, 1)` 65535). `builtins/value-functions.ts` `refusedRotateInInitializer`, called by
    `init/initial-values.ts` `scalarInit`: the whole initializer is a store's value, a rotation under an operator in it is
    not — refused `shift-untyped-width` as the store is. Src "an initializer is refused the shapes a store is" (red first).
    (2) `_in_expression` could not tell the destination's width from the other operand's; recorded
    `tr_a30_rotate_untyped_literal_operand_width` (ROR(1, 1) OR w0 into a DWORD 2^31 both orders, OR d0 into an LWORD 2^63):
    the DESTINATION's width. (`w5 := ROR(1, 1) OR d0` into a WORD does not build: "Cannot convert type 'UDINT' to type
    'WORD'", dropped from the case.) Carrying the destination into an operator's operand is not built: not-lowered, niche:
    accepted loss (0 ROL / ROR of an untyped literal in the six corpora); the reason in `untypedRotateOperand` names it.

- [x] 6.A.31 The AST fold sizes no STRUCT, FB instance, ARRAY or packed DUT (SIZEOF); the IR fold does.
  - What: found by the fold-agreement test (1.8.9): 24 SIZEOF expressions the front-end calls constant fold to nothing in
    `types/const/fold.constEval` and to the recorded size in `semantics/fold.constantValue` (lowering's layout model,
    `lower/storage/layout.ts`, `builtins/sizeof.ts`). The LSP then skips a check that needs the value (an array bound or a
    CASE label written as a SIZEOF). Give the front-end the layout facts it needs (the layout model's home, P1), or keep
    the AST fold silent with a written reason; either way each `KNOWN` entry in `fold-agreement.test.ts` goes.
  - Where: `types/const/fold.ts`, `types/infer/expr.ts` (`sizeofOperandBytes`), `lower/storage/layout.ts`.
  - Accept: the 24 marks removed (the test fails on a stale one); G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Af). Not niche (lenze-mid writes `ARRAY [1..SIZEOF(L_MC4P_PathData)] OF BYTE` and
    `[0..((SIZEOF(…) + SIZEOF(…)) - 1)]`). Recorded as array bounds on both vendors (`fixtures/types/constant-evaluation.ts`,
    the 30000 probe): `tr_a31_sizeof_bound_struct_type` 8, `_struct_var` 24, `_struct_nested` (a STRING(5) and a nested
    STRUCT) 16, `_struct_packed` (pack_mode 1) 5, `_struct_bits` (nine BITs, an INT) 4, `_array_of_struct` 24, `_fb_instance`
    16 — the LSP gave none of the seven errors (lsp-gap). The layout's home is the front-end: `frontend/types/layout.ts`
    `typeBytes` (elementary, enum, array, union — moved from `infer/expr.ts` —, STRUCT, FB instance; undefined for a derived
    STRUCT / FB, VAR_IN_OUT, a METHOD's VAR_INST, an interface that EXTENDS, a pack mode other than 1, RETAIN / PERSISTENT,
    pointers) and `packFields` (the packing rule — BIT runs, alignment, the packed tail), which `lower/storage/bytes.ts`
    `fieldBytes` now packs with (one home; its loop deleted; `alignUp` moved). `infer/expr.ts` `sizeofOperandBytes` reads
    `typeBytes`; a SIZEOF's TYPE is still measured for a STRUCT (UINT) alone, so `storageBytes` keeps a layout's size a value,
    never a type; `sizedOperandType` sizes a DUT's or an FB's NAME as a type (it was read as a value: the corpora's 48
    `SIZEOF(<type name>)` UNKNOWNs are typed, the census key seeded at 0). architecture.md ownership row. Src
    `frontend/types/layout.test.ts` (two tests). F: the seven rate refused. `fold-agreement.test.ts`: the 31 SIZEOF marks (24
    at 1.8b, 7 more since) removed; the one left, `dt_library_enum_storage_values: SIZEOF(w)`, is no layout — a library
    enum's base is not materialized — re-filed under `LIBRARY_ENUM_BASE_NOT_MATERIALIZED`. 505 constant expressions compared,
    30 disagree, 30 known (was 56). G+LSP.
  - Step 6Af end (implement agent, 2026-10-10; the gate commits). Recorded in two CODESYS record:exec batches (12, then 6)
    plus the two past-64-bit cases alone (contaminated in the first batch), every new fixture build-recorded on CODESYS and
    TwinCAT (`ide.ps1 -Instance transpile-restructure`, TwinCAT `-Fixture 13`; both IDEs closed). 25 new fixtures: 15
    confirmed, 7 refused, 3 unaskable (and `tr_a30_rotate_untyped_literal_in_expression` not-lowered by name). M
    (`rate:fixtures`): mapped 5484 -> 5509, confirmed 2952 -> 2967, refused 2001 -> 2008, not-lowered 346 -> 346
    (`ce_fold_untyped_in_context_values` out, `_in_expression` in), lsp-gap 84, diverges 9, unaskable 92 -> 95; lowered/clean
    decl 748/748 -> 751/751, arith 1575/1573 -> 1583/1581, control 158/147 -> 161/150, aggregate 135/135 -> 142/142, call
    297/294 -> 298/295, indirect 460/455; edge agree 3160 -> 3175, disagree 3, not-run 210 -> 217 (the seven refused bound
    probes, whose Rust does not build); pedantic 33578 -> 33719; dead_code 5883 unchanged; shapes 1844 -> 1860; NOTES 678.
    Baselines rewritten: `test/frontend` (counts; the new fixtures' FOR steps and ROL / ROR of untyped literals named
    `CEILING_EXCEPTIONS` in `frontend/baseline.ts`, LT14's literal classes +6 for `tr_a27_…`; ceilings fell: corpus Library
    Manager binary / paren UNKNOWN 216 -> 194, SIZEOF or ADR 128 -> 87, SIZEOF of a type name 48 -> 0) and `test/analysis`
    (TP +7 each vendor, the bound probes; the four TwinCAT GAPs of 6.A.29 excepted). Corpus (`probe-lowering-refusals.ts`):
    54 lower / 250 refused, unchanged; no `constant-overflow`, `constant-unsigned-negative` or `shift-untyped-width`. Runs at
    the end: `bun typecheck` clean; package lint green but the pre-existing `last-binding.ts` size warning; `bun test src
    scripts` 2249 pass; `test/frontend` 45 pass; `test/analysis` 13 pass; `test/conformance` (whole, no VOLT_FIXTURES) 6539
    pass, 0 fail; `test/corpus` + `test/catalog` + `test/libraries` 189 pass.
  - Gate review fixes (6Af gate, 2026-10-10): (1) the layout answered every project as the 64-bit target — an FB's header
    and interface slots are pointers, an 8-byte field's place in a STRUCT on a 32-bit target is unmeasured, and the LSP binds
    most workspaces with no target. `types/layout.ts` `typeBytes`: a STRUCT or an FB instance has a size only where
    `targetOf` states 64 bits (compat.ts's precedent); an elementary type, an array of one, an enum, a UNION keep theirs. Corpus
    folds where no device is measured fell (Library Manager decl folds 94414 -> 94380, body 4684 -> 4678); the recording
    environment states 64 bits, so no fixture moved. Src `layout.test.ts` "a STRUCT or an FB instance has no size where the
    target is not the measured 64-bit one" (red first). (2) A VAR_INPUT CONSTANT was skipped as a replaced constant; recorded
    `tr_a31_sizeof_bound_fb_var_input_constant` (both vendors) and `tr_a31_sizeof_fb_var_input_constant` (run): 24 — it is a
    parameter and takes its room. Fixed in both homes, `types/layout.ts` `fbFields` and `lower/storage/bytes.ts`
    `replacedConstants`. Src `layout.test.ts`, `builtins/sizeof.test.ts` (red first).
  - Gate 6Af (2026-10-10): the review's six findings, each written under its task — fixed: 6.A.31 (no layout off the 64-bit
    target; a VAR_INPUT CONSTANT laid out), 6.A.30 (an initializer refused the shapes a store is; the operand width recorded,
    the destination's — not built, niche), 6.A.29 (an operation on a held constant folds on the held value; SIZEOF of one
    its declared type's). Seven new fixtures (four bound probes, three run cases), every one build-recorded on CODESYS and
    TwinCAT (`ide.ps1 -Instance transpile-restructure`, TwinCAT `-Fixture 13`, both IDEs closed) and the three run cases in one
    `record:exec` batch. One new code, `held-constant-operand` (not-measured). M (`rate:fixtures`): mapped 5509 -> 5516,
    confirmed 2967 -> 2969, refused 2008 -> 2012, not-lowered 346 -> 347 (`_operand_width`), lsp-gap 84, diverges 9,
    unaskable 95; lowered/clean decl 751/751 -> 753/753, arith 1583/1581, control 161/150, aggregate 142/142 -> 146/146,
    call 298/295, indirect 460/455; edge agree 3175 -> 3177, disagree 3, not-run 217 -> 221 (the four bound probes).
    Baselines rewritten: `test/frontend` (counts; the new fixtures' UNKNOWNs named `CEILING_EXCEPTIONS`) and `test/analysis`
    (TP +4 each vendor, the bound probes). `bun typecheck` clean; package lint green but the pre-existing `last-binding.ts`
    size warning. Full suite (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES, rustc cache sampled): 9046 pass / 0 fail (35 skip, 390 todo; 9471 tests, 314 files; was 8995 at 6Aa+6Ae). Committed as one commit, 6Af.

(6.A.7, runtime helpers colliding with a user FUNCTION, needs the registry of 7.1.2 and is task 7.1.5.)

### 6.B Leftovers of the neutral consolidations (every parameter phase 1 kept has a removal task)

- [x] 6.B.1 BIT-is-BOOL: the sites 1.1.5 did not switch.
  - What: each listed site uses `isBoolValued`, or keeps its own test with a written reason; RC 31's emitter site is 6.9.
  - Where: the sites listed under 1.1.5.
  - Accept: S-out; a grep finds no hand-written BIT/BOOL test outside `types/predicates.ts` without a reason.
  - Depends: 6.9.
  - Done 2026-10-10 (step 6Ba). Switched to `isBoolValued` / `isBit` / `isIntegral` (identical answers): `values/convert.ts`
    `convert` (the BIT/BOOL pair is one `isBoolValued` test), `storage/bytes.ts` (a BIT field packs: `isBit`),
    `builtins/conversions.ts` `hasText` (`isBoolValued`; `isInt(t, true)` already held a BIT), `expressions/operators.ts`
    NOT's operand (`isBoolValued || isIntegral` = bool/bitstring/int), `semantics/memory.ts` (three `family === "bool"`),
    `semantics/convert.ts` `coerce`, `semantics/store.ts` `fit` (a BOOL holds a BOOLEAN as a BIT does), front-end
    `types/defaults.ts` `typeZero`, `types/arith/operators.ts` `shortCircuitType` (its `bits === 1` test), `types/layout.ts`
    (its private `isBit` copy deleted). Kept, with the reason written at the site: `builtins/conversions.ts` `integral` (by
    NAME; a BIT beside a duration is unrecorded), `types/compat.ts` `bitToBool` (the assignment table is keyed by name).
    Not BIT-is-BOOL sites (a BOOL-only rule, or a family set that includes BIT, as 1.1.5 listed): `types/arith/checked.ts`,
    `arith/operators.ts` `notResultType` / `bitwiseResultType` (over an enum's base ElementaryType), `types/builtins.ts`,
    `const/fold.ts`'s conversion to BOOL, `literal.ts`, `compat.ts`'s ANY_BIT; the emitter decides in `emit/rust/types.ts`
    (6.9). S identical (all four layers, 5516 fixtures, against a baseline written at the step's start).
  - Gate review (6Ba+6Bb, 2026-10-10): NOT output-neutral for one input no fixture covered — `coerce` now sends a BIT target
    through `toBool`, so `REAL_TO_BIT(0.4)` is TRUE where it left the REAL in a BOOL (0.4000000059604645). Recorded:
    `tr_b1_real_to_bit_into_bool` and `tr_b1_real_to_bit_field` (0.4 TRUE, 0.0 FALSE, -1.5 TRUE, into a BOOL and into BIT
    struct fields; build clean on both vendors, CODESYS run) — both confirmed, the new answer is the vendor's. (Recorded in
    the 6Bb commit: the recordings are shared files.)
- [x] 6.B.2 The integer wrap: remove the per-caller family guards 1.1.6 listed.
  - What: `wrapToWidth` callers go through one `storeInteger(value, type)` rule, or keep a guard with a written reason.
  - Where: `types/width.ts`, `types/const/fold.ts`, `lower/values/convert.ts`, `semantics/store.ts`.
  - Accept: S-out; G+LSP.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ba). `types/width.ts` `storeInteger(v, t)` is the one rule — wrapped at the width when
    `holdsIntegerBits(t)`, unchanged otherwise — on the types index. `values/convert.ts` `stored` is
    `typeof v === "bigint" ? storeInteger(v, to) : v` (its BIT and no-elem guards were `holdsIntegerBits`'s already);
    `semantics/store.ts` `fit` stores an integer through it (`inWidth` kept in front only to spare the allocation). Kept,
    each with its reason written: `fit`'s REAL (fround), BIT/BOOL (a BOOLEAN) and STRING (capacity) — other families' store
    rules, not integer guards; `const/fold.ts` `declaredValue` keeps `integerType` (the front-end holds only an INTEGER's
    value at its width; `storeInteger` would also wrap a duration's, unrecorded); the rotate (`semantics/builtins.ts`) is a
    bit pattern, not a store. Test: `types/width.test.ts` "storeInteger" (red first). S identical.
- [x] 6.B.3 EXTENDS: remove the documented parameters 1.7.3 listed.
  - What: each site uses the default chain, or the parameter stays with the recorded fixture that needs it.
  - Where: `lower/core/chain.ts` and its callers.
  - Accept: S-out.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Ba). The one parameter, `declaredChain`'s `limit` (`implementsInterface`'s 32-unit cap), is
    gone: the cycle guard ends every walk. The three mechanisms stay, each answering its own question (written in
    `core/chain.ts`'s header): the binder's link is the TYPE's chain (field order, FB_Init order), the queued bodies what
    lowering can RUN (a base with no body is `call-base`, not a shorter chain), name lookup the DECLARATION a scope does not
    carry (a field's FB_Init arguments, IMPLEMENTS and an interface's EXTENDS lists). Tests: `interfaces/tags.test.ts` "an FB
    implements an interface its base implements, however deep the EXTENDS chain" (40 levels; red first); `core/chain.test.ts`
    loses its `limit` case. S identical.
  - Gate note (6Ba/6Bb): 6Bb edits `builtins/conversions.ts` and `expressions/operators.ts` again, so 6Ba's diff alone is
    saved as `6Ba.patch` in the step's scratchpad; 6Ba's files are those named under 6.B.1-6.B.3.
- [x] 6.B.4 Lowering's parameter view delegates to `types/infer/callee`.
  - What: for every difference 1.7.18 wrote down, either the two agree (lowering delegates) or the difference is a recorded CODESYS fact
    and stays with its reason.
  - Where: `lower/calls/parameters.ts`, `types/infer/callee.ts`.
  - Accept: S-out; G+LSP; the differential test of 1.7.18 reports only reasoned differences.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Bb). Recorded first: `tr_b4_positional_past_output` (F with a IN, o OUT, b IN; `F(3, 4)` builds
    on both vendors and CODESYS runs it to 304 — the output is SKIPPED, `b` binds) and `tr_b4_positional_into_output`
    (`F(3, x, 5)`: "Function 'F_LANG_tr_b4_into' requires exactly '2' inputs", both vendors). The front-end's rule was the
    vendors'. `types/infer/callee.ts` exports `isPositionalSection` (VAR_INPUT, VAR_IN_OUT; on the types index); lowering's
    `positionalParameters` filters by it and `positionalBinding` answers the parameter at the position or `past-parameters`
    (the `across-output` refusal and the `output` field are gone; `positionalOf`, `pointers/any.ts`, `pointers/cursor.ts`
    read the same list). The differential `test/conformance/call-parameters.test.ts` keeps no exception: every positional
    argument of the direct calls agrees, any difference fails. Tests: `calls/parameters.test.ts` (rewritten to the
    recording), `calls/invoke.test.ts` (`WithOutput(1, 2)` binds `second`; `(1, 2, 3)` is `call-positional`). The past
    fixture rates confirmed (indirect), the into fixture refused (the LSP reports it, `functionRequiresInputs`: TP +1 each
    vendor).
- [x] 6.B.5 Lowering's NOT, duration-scaling and platform-conversion rules read the front-end (hand-off H4, split from 1.1.8
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
  - Done 2026-10-10 (step 6Bb). NOT: a signed operand types as `notResultType` (USINT/UINT/UDINT/ULINT, was BYTE to
    LWORD); S-out holds (the ir layer moves in 9 lowered fixtures — `not_result_width`, `cc_not_*`, `expr_*not*`,
    `bitwise_on_narrow_types`, `cv_strict_enum_arithmetic` — and the four `uop_not_*` refusals now name the unsigned type;
    outputs and edge identical). Duration scaling reads `durationScaleConversion`: an integer wider than the duration makes
    the DURATION convert, which both vendors refuse — new code `duration-scale` (invalid), "Cannot convert type 'TIME' to
    type 'LINT'". F: the one fixture whose answer changes is `ar_duration_scaled_stores` (recorded refused on both vendors;
    lowering ran it), now refused by the transpiler too (it loses tier and rust); `ar_time_scaled_by_wide_or_unsigned_int_type`'s
    first refusal moves `assign-string` -> `duration-scale`. A narrower or same-width integer converts straight into the
    duration (the same bits as through the signed integer of its width, so one conversion is emitted:
    `time_multiply_divide`, `xo2_time_across_objects` unchanged). Platform names: `builtins/builtins.ts` reads
    `parseConversionName(name, targetOf(project))` (the `PLATFORM_ALIASES` left-side rewrite deleted), and in the SAME step
    `values/fold.ts` `convertedConstant` and `builtins/arity.ts` `isConstantCallee(name, target)`. Recorded first:
    `tr_b5_platform_conversion_initializers` (CODESYS run: `DINT_TO___XINT(5)` 5, `__XINT_TO_DINT(7)` 7,
    `5 + __XINT_TO_DINT(5)` 10, `DINT_TO___UXINT(-1)` 18446744073709551615, `INT_TO___UXINT(3)` 3, all in VAR initializers;
    builds clean on both vendors) — confirmed. `ty_dint_to_uxint` not-lowered -> confirmed; `ty_xint_to_dint_result_type`'s
    refusal `expr-call` -> `assign-string` (still refused). LSP gap found and fixed on the way: an initializer LEADING with a
    platform conversion (`b : DINT := __XINT_TO_DINT(7)`) was refused "';' expected instead of '__XINT_TO_DINT'"
    (`syntax/parse/initializer.ts` `isUnknownSystemName` took it for an unknown `__` name); src `parse/initializer.test.ts`
    (red first). Tests: `values/fold.test.ts` (the initializer lowers at the recorded values; rewritten from the refusal it
    pinned), `builtins/conversions.test.ts` (a platform name on either side), `expressions/operators.test.ts` (NOT's type,
    the duration refusal).
  - Gate review (6Ba+6Bb, 2026-10-10), three findings, each fixed against a new recording (16 fixtures, build-recorded on
    both vendors with `ide.ps1 -Instance transpile-restructure` (TwinCAT `-Fixture 13`), run-recorded in one `record:exec`
    batch; `s` renamed `si` in one, an IL word):
    (1) A duration scaled by a BIT STRING was refused `type-unknown` (`durationScale` took only `family === "int"`; HEAD's
    `isIntegerType` covered both). Recorded: a bit string is the UNSIGNED integer of its width — TIME × / ÷ BYTE, WORD,
    DWORD (either order) and LTIME × DWORD, LWORD compute in the duration (`t / 16#FFFFFFFF` is 0: an unsigned divisor;
    CODESYS warns DWORD -> DINT as for UDINT), and TIME × LWORD (either order) and TIME ÷ LWORD are refused "Cannot convert
    type 'TIME' to type 'ULINT'" (`tr_b5_time_times_{byte,word,dword,lword}`, `tr_b5_{dword,lword}_times_time`,
    `tr_b5_time_div_{word,dword,lword}`, `tr_b5_ltime_times_{dword,lword}`). Fixed in the front-end rule
    (`types/arith/temporal.ts` `durationScale`: a bit string scales as `integerOfWidth(bits, false)`, a BIT not asked), so
    the LSP and lowering agree (the LSP now reports the three LWORD refusals: census TP +20 CODESYS / +6 TwinCAT). Test:
    `expressions/operators.test.ts` "a duration scaled by a bit string …" (red first: `type-unknown`).
    (2) The `duration-scale` refusal on an untyped literal past 32 bits: recorded refused on both vendors
    (`tr_b5_time_times_wide_literal`, "Cannot convert type 'TIME' to type 'ULINT'"), and `t * 3000000000` computes
    (`tr_b5_time_times_udint_literal`, confirmed) — so the refusal is the vendors'. The vendors name ULINT where lowering
    names the literal's LINT, and the LSP passes it (lsp-gap): niche: accepted loss (0 occurrences in the corpora) — the
    fixture's `deferred.lsp`, the lsp-gap ceiling 84 -> 85 and the census / type-dump exceptions name it.
    (3) The comment's "same bits" for `/` by a negative signed integer: recorded — `T#3S / SINT#-1`, `/ INT#-2`, `/ DINT#-1`
    are 0 and `T#3S * SINT#-1` 4294964296 ms (`tr_b5_time_by_negative_signed`, confirmed): the arithmetic is the
    duration's, unsigned, as lowering computes it; the comment (and `temporal.ts`'s doc) now say so and cite it.
    Gate numbers. M (`rate:fixtures`): mapped 5519 -> 5535, confirmed 2972 -> 2984, refused 2013 -> 2016, not-lowered 346,
    lsp-gap 84 -> 85, diverges 9, unaskable 95; arith 1583/1581 -> 1594/1592, aggregate 146/146 -> 147/147; edge agree
    3179 -> 3191, disagree 3, not-run 221. Baselines rewritten: `test/analysis` (TP CODESYS 5665 -> 5685, TwinCAT 6861 ->
    6867; GAP +2 each, excepted), `test/frontend` (counts; type-dump exceptions for the new fixtures' untyped numbers).
    `bun typecheck` clean; package lint green but the pre-existing `last-binding.ts` size warning. FULL suite
    (`VOLT_REQUIRE_FULL=1 bun test`, VOLT_FIXTURES unset, test/corpus included): 9084 pass / 0 fail / 35 skip / 389 todo.
- [x] 6.B.6 The three rule-4b edges the design placed against its own rule (checkpoint review 1.9.4).
  - What: each `KNOWN_TRANSPILE_VIOLATIONS` entry reported to the gate rather than owned by a task gets a home that keeps
    the leaves acyclic, or design.md P2's rule 4b is amended for it with the reason: `core/shared.ts` reads
    `project/prepare.ts` `AttributeLookup` (§4.2's placement); `project/prepare.ts` reads `lower/conditions.ts` (§4.9 moves it into
    `project/`, which would make `calls/` import `project/`); `values/fold.ts` `foldedCall` lowers through
    `expressions/expressions.ts` (§2.4's placement). The fourth entry (`values/enums.ts` → `storage/layout.ts`) is 3.3's.
  - Where: `lower/core/shared.ts`, `lower/project/prepare.ts`, `lower/conditions.ts`, `lower/values/fold.ts`,
    `scripts/check-layering.ts` (`KNOWN_TRANSPILE_VIOLATIONS`), design.md P2.
  - Accept: G, S; the three entries gone from the list (or the rule amended in design.md and the lint together).
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 6Bb). `KNOWN_TRANSPILE_VIOLATIONS` is empty. `AttributeLookup` is declared in `core/shared.ts`
    (`project/prepare.ts` types its field by the shape, no import); `lower/conditions.ts` is a LEAF FILE (`LOWER_LEAF_FILES`,
    beside `builtins/arity.ts`); `foldedCall` moved to `init/initial-values.ts`, its one caller. design.md P2 amended (the
    leaf-file rule and the three homes), with the §2.4 and §4.9 rows and the old -> new map. Output-neutral (moves only; the
    step's S differences are all 6.B.4's and 6.B.5's).
  - 6Bb numbers. Fixtures: 3 new (`tr_b4_positional_past_output`, `tr_b4_positional_into_output`,
    `tr_b5_platform_conversion_initializers`), build-recorded on CODESYS and TwinCAT (`ide.ps1 -Instance
    transpile-restructure`, TwinCAT `-Fixture 13`, both IDEs closed) and run-recorded in one `record:exec` batch (the two b4
    re-run once: a variable named `r` is an IL word CODESYS refuses, renamed `res`). M (`rate:fixtures`): mapped 5516 ->
    5519, confirmed 2969 -> 2972 (the two new run cases, `ty_dint_to_uxint`), refused 2012 -> 2013, not-lowered 347 -> 346,
    lsp-gap 84, diverges 9, unaskable 95; lowered/clean decl 753/753 -> 754/754, indirect 460/455 -> 461/456, arith
    1583/1581 (`ar_duration_scaled_stores` out, `ty_dint_to_uxint` in), control 161/150, aggregate 146/146, call 298/295;
    edge agree 3177 -> 3179, disagree 3, not-run 221; pedantic 33748 -> 33753. S (all layers, against the step-start
    baseline): 6Ba identical; after 6Bb 19 fixtures differ, all named above; S-out (`--layers outputs,edge`): only
    `ar_duration_scaled_stores` (now refused), `ty_dint_to_uxint` (now lowered) and the three new. Baselines rewritten:
    `test/frontend` (counts; `tr_b5`'s `-1` named in `CEILING_EXCEPTIONS`), `test/analysis` (TP +1 each vendor,
    `tr_b4_positional_into_output`). Targeted: `bun test src` 2224 pass / 0 fail, `test/frontend` 45 / 0, `test/conformance`
    6549 / 0, `test/analysis` 13 / 0; `bun typecheck` clean; package lint green but the pre-existing `last-binding.ts` size
    warning. Left to the gate: the full suite and `test:corpus` (the initializer parse fix can only remove LSP errors).

## 7. Lean groups (same program output, less Rust: every step S-out + M)

Each sub-task names its notes, deleted from the authored table when resolved. The counts come from 0.6's tags; the keyword
pre-classification gave group 1 ≈ 11 notes / 576 rows, 2 ≈ 179/5178, 3 ≈ 129/751, 4 ≈ 135/1404, 5 ≈ 38/1201, 6 ≈ 62/391, 7 ≈ 86/575,
8 ≈ 29/186, 9 ≈ 72/549.

### 7.10 Transpiler source cleanup (leftovers after 1.7)

- [x] 7.10.1 Verify lean 10.1 (EXTENDS, holdsFbInit/reaches), 10.3 (convertValue) and 10.4 (every orphan doc named in the maps,
  incl. the old `infer` module's :258, deleted by 1.1.13) are dissolved.
  - Where: `src/transpile/**`, `src/types/**`.
  - Accept: a grep list is empty.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 7.10). The grep list is empty: no hand-written EXTENDS walk in `src/transpile/**` or
    `src/frontend/types/**` (`for (let … extends|baseScope` / `while (… extends|baseScope`: none; 1.7.3's `core/chain.ts`
    holds them), no `holdsFbInit` or second `reaches` walk (1.7.13's `reachesFbInit`; `statements/case.ts`'s `reaches` is
    a CASE label's own), one `convertValue` (`semantics/convert.ts`, read by `interp/machine.ts` and `semantics/fold.ts`;
    no `fit(coerce(…))` outside it and its tests), and no `infer.ts` (dissolved by 1.1.13). Orphan docs, by a scan for a
    `/** … */` followed by a blank line, another comment or a `}`: two found and dissolved — `emit/rust/module.ts`'s stale
    "1-based emitted line" doc stacked on `sourceMap`'s own, and `lower/calls/binding.ts`'s line comment between
    `holding`'s doc and its declaration (folded into the doc). No section banner is left.
- [x] 7.10.2 One typed const fold (lean 10.2).
  - What: `foldBigInt` and `foldNumber` merge into one width-carrying fold, sharing the identifier resolver between `constancyOf` and `fold`.
  - Where: `types/const/fold.ts`, `types/const/constancy.ts`.
  - Accept: G+LSP; S-out; `fold-agreement.test.ts` unchanged or better.
  - Depends: 6.1, 6.A.20, 6.A.29.
  - Done 2026-10-10 (step 7.10). `foldBigInt` and `foldNumber` are one `ARITHMETIC` table in `types/const/fold.ts`:
    each operator once, its integer rule and its real rule side by side (no real rule: MOD, AND, OR, XOR do not fold on
    a real); two integers fold exactly as bigint, a real on either side folds both as a number, the width the wider
    operand's (`fold`'s `binary`, unchanged). The identifier resolver was already shared: `constancy.ts` reads
    `constancyIn`, the same walk (`fold`/`constRef`/`symbolValue`), since frontend-conformance 4.6.2. `fold.test.ts` +
    `constancy.test.ts` + `fold-agreement.test.ts` 41 / 0, unchanged. S identical (below). Left to the gate: the LSP
    corpus gate and the build-conformance oracle (G+LSP).
- [x] 7.10.3 The `transpile/index.ts` doc carries the rule only (no numbers or taxonomy copy); `emit/rust/index.ts`'s temp list is
  generated from `names.ts` purposes.
  - Where: `transpile/index.ts`, `emit/rust/index.ts`, `names.ts`.
  - Accept: G.
  - Depends: 1.9.4.
  - Done 2026-10-10 (step 7.10). `transpile/index.ts`'s doc states the input contract and the reach contract and points
    at `lower/diagnostics/codes.ts` (the refusal codes and kinds) and `test/corpus/corpus.test.ts` (`REACH`, `ROUTINES`)
    for the figures — no number and no refusal list is copied; `corpus.test.ts`'s comments and the REACH test's title
    say the figures live there alone ("REACH — the documented figures are what the corpus measures"). `names.ts`
    `TEMP_PURPOSES` is the table of every printer temporary's purpose (18 rows), `tmp` takes only a `TempPurpose`, and
    `emit/rust/index.ts`'s INTERNAL list names that table and `lower/core/temps.ts` instead of a hand list (which still
    named `__c`, `_chain_value_N` and `_property_N`, none printed any more). New `names.test.ts` test: every `tmp("…")` in
    the printers is a row and every row is used.
- [x] 7.10.4 `dead-exports.ts --scope src/transpile` (filtered, design.md §8) finds nothing.
  - Where: `src/transpile/**`.
  - Accept: G; empty list.
  - Depends: 7.10.1.
  - Done 2026-10-10 (step 7.10). The list was 11 names (+ 7.10.3's `TempPurpose`), each read only inside its own file:
    `RuntimeId`, `ANY_ADDRESS`, `anyByAddress`, `anyAddressInputsOf`, `addressKey`, `refusedStores`, `MemoryStore`,
    `MemoryRead`, `imageSize`, `IntToRealInput`, `StringOp` — their `export` dropped (the declaration build,
    `tsc -p tsconfig.build.json --emitDeclarationOnly`, is clean). Now "no finding", pinned by a new
    `scripts/dead-exports.test.ts` test over the real tree; the scanner reads each file's words once (`packageTexts`),
    8 s -> 0.6 s. Step 7.10: S identical over 5535 fixtures (`snapshot:transpile check`, all layers, against the
    step-start baseline written at 00996a7db0).

### 7.1 Prelude on demand (lean 1; dead_code 5658, uninlined_format_args 4192, format_push_string 1048, many_single_char_names 527)

- [x] 7.1.1 The registry has real dependencies.
  - What: the IecStr core, each `iec_*_text`, `iec_parse_*` and `iec_max/min` become separate entries with `deps`.
  - Where: `emit/rust/runtime/index.ts`, `runtime/*.ts`.
  - Accept: G, S (still today's gating).
  - Depends: 1.5.11.
  - Done 2026-10-10 (step 7.1, with 7.1.2: the intermediate gating state was not committed on its own). `runtime/index.ts`
    `HELPERS` is one entry per Rust item group: the IecStr core (`string`), `iec_max`, `iec_min`, each `iec_*_text` and its
    helpers (`iec_civil`, `iec_lclock` — a comment above a group rides with its first entry), `iec_parse_real`,
    `iec_parse_int`, the numeric and pointer helpers, and the byte image split by method (`mem`, `mem_region`, `mem_at`,
    `mem_ld`, `mem_ld_bool`, `mem_st`, `mem_order`, `iec_ix`). `deps` are what a text CALLS (`iec_ldt_text` ->
    `iec_civil`, `iec_lclock`; `mem_ld` -> `mem_at` -> `mem_region`; `mem` -> `mem_ld`, `mem_st`, the harness's access to
    an image-held variable, `support/rust-access.ts`, so they are `pub` and ride with every `Mem`). The string blob's three
    riders are gone. `runtime/index.test.ts`: every helper whole items, FRONT + BACK the whole registry, the closure, a
    test that every fn (and `self.<method>`) a text calls is in its closure, `frontLines`, `withoutRuntime`.
- [x] 7.1.2 The printer records `use(id)`; `module.ts` appends the dependency closure; the `code.includes` sniffing (six sites) is deleted.
  - Where: `emit/rust/printer.ts`, `module.ts`, `runtime/index.ts`.
  - Accept: S-out; M (dead_code excused count falls; the target is 0 excused by runtime code).
  - Depends: 7.1.1.
  - Done 2026-10-10 (step 7.1). `printer.ts` `use(p, id)` records a helper and answers its name
    (`${use(p, "iec_div")}(a, b)`), `typeOf(p, t)` records the string core wherever a type holding a string is spelled
    (struct fields, routine parameters, locals, results, lent instances, a dispatch's type; a VAR_IN_OUT string in
    `bodyParams`), and a string constant, a fresh string composite and a conversion to or from a string record it too;
    `image.ts` `mem(p, method)` records the image's methods, `module.ts` records `mem` when the POU has an image. `module.ts`
    prints `closure(p.uses)`: the FRONT ones (the string family) in front in registry order, the source map shifted past
    them; the BACK ones after the code, each once (`helperText`). `usedIn`, `INLINE` and every `code.includes` are deleted.
    S-out identical over 5535 fixtures (all layers but `rust`; the `rust` layer differs on 466). M (`rate:fixtures`):
    `dead_code` excused 5883 -> 42; the share on runtime lines, measured by compiling every lowered fixture's Rust and
    attributing each finding to the registry text it falls in, 5768 -> 0 (target met). Pedantic 33788 -> 27701
    (`uninlined_format_args` 3519 -> 1217, `unreadable_literal` 2995 -> 1443, `cast_sign_loss` 3771 -> 3425,
    `cast_possible_wrap` 749 -> 400, `format_push_string` 782 -> out of the ten; on runtime lines
    `many_single_char_names` 394 -> 3, `bool_to_int_with_if` 391 -> 6). Rows changed: `pedantic` 394, `shape` 73 (the
    byte-image fixtures: `Mem`'s methods are separate `impl Mem` blocks now), `notes`/`lints`/`edge`/`evidence` 0.
- [x] 7.1.3 ALLOWED `dead_code`: its reason narrowed to "fixture variables", its excused count recorded.
  - Where: `test/conformance/support/transpile/lint-policy.ts`.
  - Accept: M.
  - Depends: 7.1.2.
  - Done 2026-10-10 (step 7.1). Reason now "fixture variables: …. Not the runtime: the module prints only the helpers the
    code calls (lean 1, 7.1.2), so no registry item is ever unused". Excused count 42 (was 5883), all on fixture lines.
- [x] 7.1.4 Redefine the map's `size`.
  - What: "emitted Rust lines per ST line, runtime-registry lines not counted" (design.md §8); re-baseline in this commit with the old and
    new median both written here; every later size delta uses the new definition.
  - Where: `test/conformance/support/transpile/row.ts` (size), `scripts/rate-fixtures.ts`, the map header text.
  - Accept: M (only `size` values and the header definition change; both medians recorded).
  - Depends: 7.1.2.
  - Done 2026-10-10 (step 7.1). `shape.ts` `sizeRatio` counts the non-blank lines of `withoutRuntime(code)` (every registry
    text the code holds removed, wherever printed); the generator's header and doc say "runtime-registry lines not
    counted". Medians: old definition (string prelude in front not counted) 3.1 at step start and 3.1 after 7.1.2; new
    definition 3.1. 368 rows' `size` moved between the step-start map and this one (the byte-image and numeric-helper
    fixtures, whose appended helpers no longer count); the ten largest now include `string_escapes_named` 13 and
    `tr_a10_string_to_dint_based_edges` 12.2 in place of `tr_a18_for_counter_through_reference` and
    `tr_38_ref_store_explicit_conversion`. Every later size delta uses this definition.
- [x] 7.1.5 Runtime helpers colliding with a user FUNCTION (`iec_div`, …; Appendix A, was 6.A.7).
  - What: reserve the registry's ids in `names.ts` (a user FUNCTION named like a helper gets a suffixed fn) or namespace the helpers.
  - Where: `emit/rust/names.ts`, `runtime/index.ts`.
  - Accept: a src test with a user FUNCTION `iec_div` plus a fix; S-out.
  - Depends: 7.1.2.
  - Done 2026-10-10 (step 7.1). `runtime/index.ts` `RUNTIME_ITEMS` is every top-level item name the registry can print
    (read off the texts); `names.ts` `baseFnName` suffixes a FUNCTION's fn with `_` when it names one (a METHOD's fn is
    inside its impl and cannot collide). Test-first: `names.test.ts` "a user FUNCTION named like a runtime helper gets a
    suffixed fn" — red (two `fn iec_div`, E0428), green after. S-out identical. Not covered (no fixture, a different
    surface): a DUT or FB named `Mem` or `IecStr` keeps its contract struct name and would collide with the runtime type.

### 7.9 Prelude helpers (lean 9)

- [x] 7.9.1 `iec_r2i64/32`: `let c = v.round();`, the NaN and ≥2^63 returns merged, the redundant `is_nan()` in `contains` dropped.
  - Notes: 02a72c2e83, 693c14b0bd, b7286c7932, de283d0ef6, 0ab1e9c511, 5383e1c9ac, 6f8ef8f0bd, f44fb59407, fe6af35845, c5844eabe9.
  - Where: `emit/rust/runtime/numeric.ts`.
  - Accept: twin test on `numeric.cases.ts` (the 192 cells of 1.3.8); S-out; M.
  - Depends: 7.1.2, 1.5.15.
  - Done 2026-10-10 (step 7.9). `let c = v.round();` in both (f64::round is half away from zero on both signs, -0.0 and
    NaN kept); `iec_r2i64`'s `c.is_nan() ||` dropped (`contains` is false for a NaN); `iec_r2i32`'s NaN and >= 2^63 returns
    one test, after the below-minimum one. Twin: the 192 cells of `REAL_TO_INT_CASES` pass. Notes resolved and deleted
    (11): 02a72c2e83, 0ab1e9c511, 5383e1c9ac, 693c14b0bd, 6f8ef8f0bd, b7286c7932, c5844eabe9, de283d0ef6, eeb4929f34,
    f44fb59407, fe6af35845. S-out identical; M under 7.9.5.
- [x] 7.9.2 An `iec_trunc_i32` helper replaces the TRUNC inlined 38 times.
  - Where: `runtime/numeric.ts`, `emit/rust/builtins.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.1.2.
  - Done 2026-10-10 (step 7.9). `runtime/numeric.ts` `IEC_TRUNC_I32` (a BACK registry entry), `builtins.ts`' `trunc`
    prints `iec_trunc_i32(x)` (`as T` for TRUNC_INT). Test-first: `semantics/numeric.cases.ts` `TRUNC_CASES` (5 recorded DINT
    cells: `trunc_functions` t27/tn27, `trunc_out_of_range`, `trunc_beyond_dint`, `conversion_trunc_real_to_dint`), run by
    `semantics/builtins.test.ts`, held to the recordings and run against the helper in `runtime-twins.test.ts` (red before:
    no `iec_trunc_i32`). Note b532048eaa deleted. 7.2.7's TRUNC-of-a-constant note 3e1e32f963 re-keyed to the new line
    (97e71b49fa, `self.f = m(-Lf64);`).
- [x] 7.9.3 `iec_deref` as `assert!`/`assert_ne!` (note dd94ff18a2); one guard per statement for a single-target pointer (notes
  01ef1b756d, e496034f7b, 1fa78ccf62).
  - Where: `runtime/pointer.ts`, `emit/rust/printer.ts` guards.
  - Accept: S-out, M.
  - Depends: 7.1.2, 4.16.
  - Done 2026-10-10 (step 7.9). `fn iec_deref(at: usize) { assert!(at != 0, "<fault>"); }` (same panic text). One guard
    per statement: `Printer.checked` holds the pointer an assignment's line checked (`guardLine`), and `guarded` prints a
    read through that same pointer in the value unchecked — only when the value holds no call (`ir/walk.holdsCall`: a call
    may move the pointer); new `stmt.test.ts` test (a RMW through a pointer: one check; with a call in the value: the read
    keeps its own). Notes resolved and deleted: dd94ff18a2 (assert), c6dbfd854f, ce1d8df0a5, dfe7ec241e, f7cd52625c (the
    doubled check; 20_15's ANY-diSize half is 7.7.9's dd28a02e7e); the 7.9.3 items of a29db6178b (6_3) and f7ea0fc7a1
    (11_3, 11_4) removed. DECIDED, not done: eliding the guard of a pointer only ever stored non-zero constants (11_3,
    12_9, 6_3) — the guard is lowering's (`Place.guard`), and dropping it needs a store-dominance proof lowering does not
    make (a field starts 0 and may be read in a later scan; a wrong elision turns a CODESYS fault into a silent wrong
    index). Re-tagged to the task that owns the rest of their text: 12_9 (01ef1b756d, 3fed555c25, e496034f7b, ef4db7eb51)
    -> 7.7.7 (the dead pointer parameter), 17_1 (3b433bdec0, 62c7abffa7, ca823a2c56) -> 7.4.4 (a cursor read borrows, one
    guard per statement). The cursor stores whose inner guard went (0bb816a185, 0cea56d7e0, 36d2a5dd78, 3b433bdec0,
    3bbed3930d, 50421700bd, 974fbd1aae, c1db7399d8, e6fd2dc9fd, f6f7b781df) re-keyed to their new lines (7.4.3/7.4.4/7.2.4
    items kept).
- [x] 7.9.4 `iec_*_text` write into IecStr with no String allocation (clears `uninlined_format_args`, `format_push_string` in the runtime).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: twin test on `text.cases.ts`, S-out, M.
  - Depends: 6.3, 6.10, 6.11, 3.5.
  - Done 2026-10-10 (step 7.9). `runtime/text.ts`: `IEC_STR_WRITE` (registry `string_write`: `std::fmt::Write` for
    `IecStr<u8, N>`, appending and cutting at the capacity as `lit` cut) and every formatter `fn iec_*_text<const N:
    usize>(…) -> IecString<N>` writing into the STRING it answers (`write!`, inlined format args; `iec_lclock` writes into
    any `fmt::Write`; `iec_lreal_text` takes its exact 800-digit expansion into an `IecString<820>` — no `String`
    anywhere). `convert.ts` prints `iec_x_text::<N>(arg)` at the target's capacity (a WSTRING target is refused by name:
    no formatter answers one). Twins (`text_lreal` incl. the ties, `text_long`, `text_ltime`) and `emit-build.test.ts`'s
    LREAL tie and LDT tests read the written units. The formatter conversions' 7.4.2 notes (2a5436bd78, 5564cd017c,
    57f6f7d814, 5cefb347f0, 6f19035a22, a0672773fa, aeb527c9e6: "built at the target capacity, no second copy") are
    resolved for these lines and deleted.
- [x] 7.9.5 Runtime lint hygiene: `many_single_char_names`, `return_self_not_must_use`, `bool_to_int_with_if`, `must_use` on the IecStr methods.
  - Where: `emit/rust/runtime/*.ts`.
  - Accept: M (pedantic count attributed to runtime reaches 0).
  - Depends: 7.9.4.
  - Done 2026-10-10 (step 7.9). Test-first: `runtime-twins.test.ts` "the registry is clippy-pedantic clean" compiles
    every registry helper under the map's lint flags and lists each pedantic/perf finding with its line — 58 at the start
    of 7.9, 0 now: `#[must_use]` on IecStr's `new`/`lit`/`units`/`to`/`char_at`/`with_char`/`narrow`/`widen`, `# Panics`
    docs and `let … else { panic!("character {i} of a string of capacity {N}") }` over `usize::try_from` in
    `char_at`/`with_char` (no sign-losing cast), `u16::from` in `widen`, an `allow` with its reason where the cast IS the
    measured conversion (`narrow`, `iec_r2i64`, `iec_r2i32`, `iec_parse_int`, `iec_trunc_i32`), digit separators, `assert!`
    in `iec_log`/`iec_pow`/`iec_div`, `i64::from(month <= 2)` and named bindings in `iec_civil`. Step 7.9 numbers. S-out
    identical over 5535 fixtures. M (`rate:fixtures`, against 7.1's map): pedantic 27701 -> 16332; on runtime lines
    (every lowered fixture compiled and each finding attributed to the registry text it falls in) 11255 -> 0
    (`cast_possible_truncation` 3227, `cast_sign_loss` 2448, `uninlined_format_args` 1217, `must_use_candidate` 1173,
    `manual_assert` 927, `missing_panics_doc` 782, `unreadable_literal` 571, `return_self_not_must_use` 391,
    `cast_lossless` 391, `cast_possible_wrap` 99, `format_push_string` 20, `bool_to_int_with_if` 6,
    `many_single_char_names` 3 -> 0 each). Rows changed: `shape` 485, `pedantic` 784, `notes` 414, `size` 0, `lints`/
    `edge`/`evidence` 0; median size 3.1; constructs 2153 -> 2146, noted constructs 678 -> 654.

### 7.2 Constants folded in lowering, in one place (lean 2)

- [x] 7.2.1 Negation of a constant folds to a typed literal (lean 2.1): done by RC 7; verify and delete the remaining notes.
  - Where: `lower/expressions/operators.ts`.
  - Accept: M (notes deleted).
  - Depends: 0.6.
  - Done 2026-10-10 (step 7.2a). Verified: `expressions/operators.ts` lowers a negative literal as the constant it is
    (RC 7, `negative_literal_constant_fold`), and any `neg` left over a constant now folds with every other all-constant
    expression (7.2.2). No note was left owned by 7.2.1.
- [x] 7.2.2 An all-constant integer or real expression prints as its folded literal.
  - Notes: 63d29bd1a0, 57a8f5a4c8, 09eeda28bb, 24588decbd, 58988cbee9.
  - Where: `lower/values/fold.ts` via `semantics/fold`; `expressions/operators.ts`.
  - Accept: S-out, M.
  - Depends: 6.2.
  - Done 2026-10-10 (step 7.2a). `lower/values/fold.ts` `foldPou`, the last thing `entry/lower-unit.ts` does (after the
    image rewrite, so every rule above it saw the expression as written): every unary, binary, conversion and pure builtin
    (MAX, MIN, LIMIT, SEL, MUX, TRUNC, the shifts and rotates, ABS — not the libm functions, whose Rust is the platform's)
    over constants becomes the constant `semantics/fold.constantValue` gives — the interpreter's own functions; one that
    faults (`7 / 0`), one whose value is no finite number or boolean, and a string are kept; a conversion of a constant
    into a POINTER is its constant handle when non-negative (`ADR(arr[2])` -> `self.p = 2;`). `ir/walk.ts` `mapExprs` is
    the bottom-up expression rewriter it runs on (beside `mapPlaces`). New `values/fold.test.ts` tests (the LINT-width
    fold, a shift, a faulting division kept). Notes resolved (their constructs are gone): 0e60621ff1, 09eeda28bb,
    24588decbd, 2f368e2e5b, 57a8f5a4c8, 58988cbee9, 58d4f235fd, 63c4ea9498, 63dc3d3963, 6e95d900d2, 745a764511,
    924a0fdb2f, 9a4cb2346e, 9b7b8014c4, d365a76953, d46e26c2aa, f5a6eb5ecf; the 7.2.2 items of 4a6baf16b3 and 63d29bd1a0.
    The same fold resolved notes other tasks own, deleted with their constructs: 7.2.7's 21672c09ea, 8cd84736a1,
    97e71b49fa, faa5102f23; 7.2.10's 14a38342eb, 395880371f, 63f801635e, 83389dfa8a, 9d8cd15435, 9fb47c3123, b6a5a933fb,
    f2987aca6a; 7.3.3's 907aa92bfc; 7.2.14's 250357816b (a constant index). The two allowed lints the fold emptied are
    deleted from `lint-policy.ts` (the generator refuses an entry that excuses nothing): `clippy::unnecessary_min_or_max`
    (10 -> 0, 7.2.7's M) and `clippy::manual_clamp` (1 -> 0); `absurd_extreme_comparisons` and `unused_comparisons` 4 -> 6
    each, their reasons widened by name (a negative literal beside an unsigned operand folds to its maximum:
    `lt_literal_negative_in_comparison_unsigned`, `tr_6_negative_paren_beside_unsigned`). `fold-agreement.test.ts`: 513 ->
    492 constant expressions compared (21 sub-expressions are now inside the constant their parent folded to), 30 -> 29
    disagreements — `tr_a14_shift_untyped_literal_variable_count: SHL(1, 40)` is no longer an IR node of its own (its
    parent `SHR(SHL(1, 40), 8)` keeps its mark), so its mark is removed as the test demands.
    Gate 7.10+7.2b review: that removal lost coverage, not a disagreement — the AST fold still answers nothing for
    `SHL(1, 40)` (UNTYPED_SHIFT). `fold-agreement.test.ts` now walks the IR BEFORE the fold (`lowerSource`'s new `fold`
    argument, false: `lowerPrepared` / `lowerUnit` skip `foldPou`), so every constant sub-expression is compared again:
    492 -> 513 compared, 29 -> 30 disagreements, the `SHL(1, 40)` mark back.
- [x] 7.2.3 A constant array index prints as a usize literal, the lower bound subtracted at lowering; the index offset printed one way.
  - Notes: 3d737b5821, 7886e7bd17, 03b3e8b80c, 2506fd8442, 4e213fd264, 6a2b5f2826, eb533b340b; 5dcbae07c6, 7918d10820, d8a5dd49a9.
  - Where: `lower/places/places.ts`, `emit/rust/place.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2a). `fold.ts` `foldedPlace`: an index step whose index folded to a constant inside the array
    becomes its 0-based position (the lower bound subtracted there, once; `lower` 0, a LINT index), and `emit/rust/place.ts`
    prints it bare (`self.a[2]`); one outside the array keeps its run-time check (a bare one rustc refuses to build — 44
    `out_of_bounds_indexing` fixtures said so before that guard). The offset printed one way: an `ARRAY[*]` dimension's
    `sub` of two values widened from 32 bits or fewer prints `[((i as i64) - (lower as i64)) as usize]`, the fixed array's
    form, not `wrapping_sub` (it cannot overflow). A constant character position prints bare (`char_at(1)`,
    `with_char(1, …)`). New tests: `values/fold.test.ts` (position, lower 0), `place.test.ts` (bare index, the ARRAY[*]
    form, an out-of-range index kept). Notes resolved: 03b3e8b80c, 191ba38aad, 2506fd8442, 3d737b5821, 44a9549a6b,
    4e213fd264, 5dcbae07c6, 628bc6e2ed, 67c71ff35c, 6d48208e3e, 7073e4cc28, 7886e7bd17, 789e5223f1, 7918d10820,
    91f6be3675, 9b12fdbfc8, 9ca82cec1d, a0d3389a70, a4ff08580b, abe3ae1f0b, ae08e85841, b4183b4f7f, c0e245211c,
    c52c7994ca, d8a5dd49a9, e02b80c3c1, eb533b340b, ebc60e2668, f07cf2da87, f59561bd3c, fcc10694ff; the 7.2.3 items of
    1e5d67a16e, 45292dbd9c, 6a2b5f2826, 75cc82a569, 9804d49d82, da046bfcbb, e91195fc19. Re-tagged: the ARRAY[*] bounds
    carried as fields (15_13: 43449862b7, debabdec0d, e37b53617c, fd16368fa8) -> 7.7.8; a RUNTIME index's form (19_3:
    848701ece2, 8d7dcea3f3, 9f8b867884, acb72c4272, d04295d4c8) -> 7.2.14. Re-keyed to their new lines (items kept):
    29a005f929, 8b00400a34, 9804d49d82, e91195fc19 (7.2.6/7.8.4), 1be212b44b, 5d3437b284, 9edcbf6da4 (7.2.14),
    1e5d67a16e (7.3.1), da046bfcbb (7.4.3).
- [x] 7.2.4 Constant ADR tags and constant cursor or pointer offsets fold.
  - Notes: 41d2232599, 0c7c4434c4.
  - Where: `lower/pointers/address.ts`, `pointers/cursor.ts`.
  - Accept: S-out, M.
  - Depends: 4.16, 7.2.2.
  - Done 2026-10-10 (step 7.2a). A constant ADR handle folds (7.2.2's pointer conversion: `ADR(arr[1])` was
    `1i64.wrapping_sub(-1i64) as usize`). A byte cursor plus a constant is `p + (c - 1)` (`pointers/cursor.ts`: `(p - 1) +
    c` in LINT's wrapping arithmetic is the same value), `p` itself for `p^[1]`. The 11_1 form (an element pointer's index
    adding then subtracting its lower bound) is no longer emitted since model 3 (no fixture has it). Notes: f7ea0fc7a1
    deleted (both its items 7.2.4's); the 7.2.4 items of 54a84537d5, 569d2b7a40, 7cfee53212, a021273b0d, b4c569e1b3,
    e6075a580f removed (their cursor extra is not a constant — no fold applies); 7cfee53212 re-keyed to its new line.
- [x] 7.2.5 A constant shift or rotate count prints bare; partial access skips `>> 0` (lean 2.4).
  - Notes: 346e81a0f2, 5228723708, de956f2a12, fdfbae2680.
  - Where: `lower/builtins/value-functions.ts`, `expressions/partial-access.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2a). `builtins.ts`: a constant count a u32 holds prints bare (`wrapping_shl(3)`,
    `rotate_left(4)`), and a shift by a constant 0 (a partial access `.%B0`) is its operand. New `builtins.test.ts` test.
    Notes resolved: 17bfcf56b6, 253e416b11, 2c27c13c32, 317cab8d16, 346e81a0f2, 37e2b15787, 5228723708, af004404ec,
    de956f2a12, fdfbae2680; the 7.2.5 items of 1d7709a031 and a497507b30. Step 7.2a numbers: S-out identical over 5535
    fixtures; M (against 7.9's map): pedantic 16332 -> 15700 (`cast_lossless` 4081 -> 3819, `cast_possible_truncation`
    2107 -> 1886, `cast_sign_loss` 977 -> 815); allowed `eq_op` 17 -> 16; tier decl 754 -> 771, arith 1594 -> 1577 (a
    folded body reaches a lower band); constructs 2146 -> 2076, noted 654 -> 581; rows changed `shape` 185, `pedantic`
    152, `notes` 236, `size`/`lints`/`edge`/`evidence` 0; median size 3.1.
- [x] 7.2.6 MOD and real `/` by a nonzero constant other than -1 print plain `%` and `/` (lean 2.5), decided in lowering (an IR flag
  "divisor proven nonzero").
  - Also: the whole-days truncation `count - count MOD day` lowers as `count / day * day` (one read of `count`; review item
    shapes10_2, owned here by 0b).
  - Notes: 015dcb3b7f, 054b93382f, c7f76e08cf, 61a75e7b4b, 32a9e6d2e3, 49387a9ebf, 7812f5a53d.
  - Where: `lower/expressions/operators.ts`, `ir/expr.ts`, `emit/rust/expr.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2b). `IrBinary.nonzeroDivisor` (new, optional): set by `fold.ts`'s pass on a `div`/`mod` whose
    divisor is a constant other than 0 (and, for MOD, other than -1); `emit/rust/expr.ts` prints plain `l % r` and `l / r`
    (a REAL division without `iec_div`) — the interpreter computes the same either way. The whole-days truncation: a count
    that holds no call is `count / day * day` (one read); one holding a call keeps `count - count MOD day` and its two
    reads, which is what CODESYS does (`xf_dt_to_date_call_once` records `calls` = 2: one read would change the answer).
    New `expr.test.ts` test (a constant divisor plain, a variable and -1 kept). Notes resolved: every 7.2.6 item (30
    notes at the start of 7.2a: those whose MOD/`/` took a constant divisor went with their constructs; the rest name no
    constant divisor — 1bb6d1cb14, 55fe85cf23, 561f3f5e13, 6256abaa7b, df9a7dcbc7 — and their items are removed; 6e691851a6
    keeps its 7.3.9 item; ec738d7743, fc9bec370c re-keyed to their new lines with their 7.8.4 items).
    Gate 7.10+7.2b review: `harmlessDivisor` read the divisor's raw IR value; an untyped real literal beside a REAL
    reaches the IR unrounded (`x / 1.0E-46` holds 1e-46 typed REAL), so a divisor that is 0 as a REAL was "nonzero" and
    the Rust printed a plain `/` (+inf) where the interpreter faults (division by zero). It now reads the value the type
    holds (`constValue`, the interpreter's own); test-first in `values/fold.test.ts` (0 corpus occurrences, a one-line
    fix). The root (lowering rounding an untyped real literal stored as REAL) is left: every other reader already rounds
    through `constValue` or the printer, and it is not this step's.
- [x] 7.2.7 Fold MAX, MIN, LIMIT, SEL and MUX of all-constant arguments, and TRUNC of a constant; literal arms typed at the result type (lean 2.6).
  - Notes: 7402369985, 779b38c9e9, 8cd84736a1, 96b55e688b, ef06033fe1.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M (`unnecessary_min_or_max` falls).
  - Depends: 6.15, 6.7.
  - Done 2026-10-10 (step 7.2b). The all-constant folds landed with 7.2.2 (MAX/MIN/LIMIT/SEL/MUX/TRUNC of constants;
    `unnecessary_min_or_max` 10 -> 0, its allow deleted). New in `fold.ts` `selected`: SEL or MUX over a constant selector is
    the arm it picks; a conversion of a SEL/MUX whose arms are constants or values widened from the conversion's own type
    converts each arm (`(if g { 10i64 } else { 20i64 }) as i16` -> `if g { 10i16 } else { 20i16 }`); a value widened and
    narrowed straight back is itself (`holdsEvery`). New `values/fold.test.ts` test; `builtins.test.ts`'s SEL line now
    reads the arms at INT. Notes resolved: 2db51dfb96, 3b823fe0e7, 8b3a192776, 96b55e688b, ba75ffae84, 12a2ae661a (a
    non-constant selector over variables: nothing to fold), and 7.3.1's 14e2fedf17 and 5a9bc1030e (arms widened and
    narrowed back — gone). Re-tagged: a LIMIT over a variable computed in DINT (9d3d81580d, deaa2bbf15) -> 7.3.1 (the
    narrow-arithmetic rule).
- [x] 7.2.8 No literal suffix at typed positions (field initializers, `Self {}`).
  - Notes: 1707972c33, 06bb3a6005, e8954e2b0d, 90c445f7cb, 870b70e195, afa5d14dd9, a29db6178b.
  - Where: `emit/rust/values.ts`, `structs.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2b). `values.ts` `typedLiteral`: a struct field's initializer (`Self { .. }`, `structs.ts`),
    an array's elements under it and each `v.f = …` of an aggregate initializer print bare — no suffix (`li: 0,`,
    `l25: 2.5,`), a REAL keeping its point (`0.0`). A routine's typed `let` is unchanged (not named here). Pinned texts
    updated (`calls.test.ts`, `module.test.ts`, `values.test.ts`). Notes: 90c445f7cb, afa5d14dd9 resolved; the 7.2.8 items
    of 06bb3a6005, 1707972c33, 74845f98c6, 870b70e195, a29db6178b, e8954e2b0d removed — their constructs (`x: Li32,`,
    `x: Lf64,`, `x: Li64,`, `x: Lu32,`) are all `x: L,` now, so their other items (7.2.11, 7.2.12, 7.8.11) moved into that
    construct's note fbde4d6e1e beside its 7.8.8 item; a29db6178b's 7.8.8 item to `v: L,` (667cafe298). The field-literal
    constructs other tasks' notes were keyed to were re-keyed: 7.8.3's 055df7e5f8, 3489b7781f, 8b9a7c5eea, 9689b156ea,
    d5d625ee73, e4b6325c44; 7.8.2's 1f2f8205f9, 4026548939, 683d4b1944, f9bdd4950a; 7.7.8's 68cdda5f1a, 79fd4d52a6; 7.6.1's
    5b7909c564, fbbfa869cf (one construct now); 7.6.3's 0b358286cb; 7.5.9's 60fefc4d63, 9358115574.
- [x] 7.2.9 Negative-literal parentheses only at receiver positions.
  - Notes: 65df8e0418, ec9a760059, b501abe431, 159ca60812, 12e93440b3, c35f240db9, 6f9ae8fd3a, 5c40a4e5a8, 682fffc71e.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2b). `literal` keeps its parentheses (every receiver reads it); a typed position prints a
    negative bare (`im5: -5,`, `-f32::INFINITY`), and an infix operand of an arithmetic or comparison operator too
    (`self.f * -0.5f64`, `x < -1i32`) — `expr.ts` `exprBinary`'s `operand`. Notes resolved (15): 060ccf97cc, 12e93440b3,
    159ca60812, 36d4b59ee2, 5c40a4e5a8, 65df8e0418, 66ef68b08a, 682fffc71e, 6f9ae8fd3a, 78615154a3, aba7baaaaa,
    b501abe431, c35f240db9, d2d239250b, ec9a760059.
- [x] 7.2.10 A constant cast prints as a typed literal (`castTo` of a const).
  - Notes: 14a38342eb, 9d8cd15435, 9fb47c3123.
  - Where: `emit/rust/convert.ts`, `values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
  - Done 2026-10-10 (step 7.2b). A `convert` of a constant folds in lowering (7.2.2). `convert.ts` `castTo` takes the IR
    value: a constant the target holds exactly prints as a literal of it (`4.0f64`, `2i64`; a REAL's f32 value, so
    `SQRT(REAL#0.1)` is `0.10000000149011612f64.sqrt()`, not the f64 0.1), parenthesized when negative (a cast lands in
    receiver positions); every builtin and conversion site passes its argument. New `convert.test.ts` test. Its notes
    (14a38342eb, 395880371f, 63f801635e, 83389dfa8a, 9d8cd15435, 9fb47c3123, b6a5a933fb, f2987aca6a) went with 7.2.2's fold.
    Step 7.2b numbers: S-out identical over 5535 fixtures; M (against 7.2a's map): pedantic 15700 -> 15621
    (`cast_lossless` 3819 -> 3784, `cast_possible_truncation` 1886 -> 1844); tier decl 771 -> 773, arith 1577 -> 1575;
    constructs 2077 -> 2026, noted 581 -> 521 (fixtures touching a noted construct 3231 -> 3346: the field notes met on
    `x: L,`, which most fixtures emit); rows changed `shape` 3151, `pedantic` 39, `notes` 3084, `size`/`lints`/`edge`/
    `evidence` 0; median size 3.1; allowed counts unchanged (`dead_code` 42, `eq_op` 16).
    Gate 7.10+7.2b (2026-10-10, after its two review fixes under 7.2.2 and 7.2.6): typecheck clean; `rate:fixtures`
    regenerated, the map byte-identical to 7.2b's; S-out (`snapshot:transpile check --layers outputs,edge`) identical over
    5535 fixtures against the step-start baseline; `fold-agreement` 513 compared, 30 disagree (30 known); full suite
    (`VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset) 9103 pass / 35 skip / 389 todo / 0 fail across 314 files (6Bb's 9084 ->
    9103).
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

- [x] 7.4.1 `.to()` only when the capacity differs or the target is generic.
  - Notes: 5d9850550d, 8e30e6691c, ec1b55e90b, 4c088ca52b, 8883cf3a18, c90fc459e6, d3fdc1ed97, 0464b7d671, e8210b694c.
  - Where: `emit/rust/stmt.ts` (assign).
  - Accept: S-out, M.
  - Depends: 3.12.
  - Done (2026-10-08, gate 3c): RESOLVED BY 3.6, not by its own step. 3.6's store prints `place.store(&v)` where the
    capacities differ or a STRING VAR_IN_OUT is on either side and `place = v` at one capacity, so no assign prints a
    trailing `.to()` any more (`emit/rust/*.ts` print none). Its note items went with it (the gate 3c review: re-keyed notes
    such as 1c341ca22f, now on `x = str;`, still described a `.to()` the line no longer has): the pure `.to()` items
    shapes5_8, 10_5, 12_7, 13_8, 14_3, 16_1 and 20_6 removed (24 notes gone, 10 merged notes shrunk); the two with a
    remaining half re-owned — shapes2_6 (a literal built at its own capacity) → 7.4.2, shapes7_7 (a compare builds the
    literal) → 7.4.9; 7.4.2's shapes15_1 (the assign's second copy) removed with them. The Notes list above is the
    2026-09-29 census (its ids were re-keyed at 3.6).
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
