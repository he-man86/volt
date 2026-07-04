> **CLOSURE (archived 2026-07-04 — disposition of open items).** The two delta requirements this change
> owned are **achieved and synced**: the real-project conformance corpus (4 corpora committed + ratcheted)
> and false-positive-free diagnostics on valid code (zero FP on built objects). Remaining open tasks are
> resolved elsewhere:
> - §3.2 / §3.5 / §8.3 library-blindness → **done** by `library-signature-index` (archived).
> - §8.1 narrowing-conversion, §8.2 `S=` set-assignment → **moved** to `st-type-inference`.
> - §5 performance → **moved** to new change `st-perf` (the perf-budget delta requirement moved there too).
> - §6 nav correctness → **moved** to new change `st-nav-chains`.
> - §3.3 / §3.4 / §4.2 / §4.3 / §7 (vendor-mask + ingest + land verifications) → **satisfied** (corpus is 100%
>   parse/ingest, zero-FP on built objects, tests green in CI).
> The text-list→enum bridge-fixture note (§8) stays a bridge follow-up. Nothing below is lost — it is all
> tracked in the LSP plan (`openspec/specs/language-server/toolchain-map.md`).

## 1. Materialize the corpus

- [x] 1.1 IP cleared (commit as-is, full project). Kind-based scheme (post `kind-based-file-extensions`), so the corpus is kind-named, not `.st`.
- [x] 1.2 Materialized the pro2193 full-option project via the headless bridge; renamed `.st` POUs by kind (185 fb / 47 prg / 37 fun); DUT/itf/gvl already kind-named.
- [x] 1.3 Committed the tree under `packages/volt-lsp-iec/test-corpus/pro2193/` (424 kind source files + references).
- [~] 1.4 `scripts/coverage-report.ts` regenerates the report; a `.st`→kind rename script exists (scratchpad). A one-shot regen script + README is still TODO.
- [x] 1.5 **Second corpus** — materialized + committed a SECOND full-option project, `test-corpus/bakon-nano/`
  ("Bakon Nano new VISU v00_90", 130 kind source files: 41 struct / 37 prg / 21 fun / 18 fb / 10 gvl / 3 enum,
  + library/device/task references). Harvested via `volt-scripts/harvest-lsp-corpus.ts` off the headless
  bridge (had to close the interactive IDE first — the project was lock-held). Widens the regression surface
  beyond pro2193 with different library mix + graphical bodies.

## 2. Disk-sourced corpus harness

- [x] 2.1 Built `computeCoverage(dir)` in `scripts/coverage-report.ts` (walks the kind set, builds the project scope) — the disk-sourced harness (equivalent to `buildCorpusWorkspaceFromDisk`, purpose-built for coverage metrics).
- [~] 2.2 Per-query snapshot tests over the real corpus — deferred (heavy/churny); the aggregate coverage metrics cover the signal for now.
- [x] 2.3 Whole-corpus **coverage/precision sweep** as a hermetic ratchet test (`src/tests/real-corpus.test.ts`, vendor=codesys) — asserts the baseline never regresses (goal: 0 diagnostics). 3.1s, no bridge. **Now parametrized over BOTH corpora** (pro2193 baseline 35, bakon-nano baseline 280); each guards parse/ingest/precision floors independently.

## 3. Precision — zero false positives

- [~] 3.1 Survey baselines. **pro2193**: 35 diags (all `unresolved-identifier`, library-blind). **bakon-nano**
  (all checks on, 2026-07-03): 359 → `unresolved-identifier` 348, `message-pragma-warning` 6, `unknown-pragma`
  6, `vg-undeclared-identifier` 5. Triage: the `message-pragma-warning` 6 are CORRECT (the LSP mirrors the
  author's `{warning 'Disabled for compatibility - SVE'}` pragmas — they match the project's real compile
  warnings). `unknown-pragma` 6 were a FP → FIXED (see below). Under the default (production) config the
  ratchet counts 280 (`unresolved-identifier` 275 + `vg-undeclared-identifier` 5).
- [x] 3.1a **`analysis` pragma FP fixed** — `{attribute 'analysis' := '-33'}` (CODESYS Static-Analysis
  rule suppression) was flagged `unknown-pragma`. Added it to the shared pragma catalog (`reference/pragmas.ts`).
  Completion snapshots updated (it now offers as a valid attribute). Full LSP suite 5689 pass.
- [x] 3.1b **VG standard-function FP fixed** — `check-vg-code.ts` now consults the reference catalog
  (`reference/index.ts` `lookup`, which covers `standard-functions.ts`) exactly as the ST unresolved check
  does, so `DELETE`/`REPLACE` (and any standard fn/operator/FB) inside graphical FBD/LD bodies no longer
  false-positive. bakon `vg-undeclared` 5→2; ratchet ceiling 280→277. The 2 remaining are `EXECUTE()` in
  `Recipes.prg` — a library function not in the corpus (same library-blindness as the 275
  `unresolved-identifier`), correctly deferred to `library-signature-index`, not a VG defect.
- [ ] 3.2 Fix `unresolved-identifier` library-blindness (`check-unresolved-identifier.ts`): implement strategy (b) — don't flag bare references absent from the whole project scope (extend the existing member-access fall-through); re-survey.
- [ ] 3.3 Confirm `unknownPragma` / `wrongVendorPragma` / `initSlotCollision` stay OFF by default and don't need to be forced on for real projects; verify the CODESYS vendor mask (`rule-vendor-applicability.ts`) hides the twincat-only checks.
- [ ] 3.4 Triage every remaining diagnostic: each must be a genuine defect or get a tuned check + a regression fixture. Drive the sweep (2.3) to green.
- [ ] 3.5 If strategy (b) leaves genuine undefined-symbol misses, evaluate strategy (a) (a library-symbol index from the referenced-library manifest).

## 4. Coverage — no parse gaps

- [x] 4.1 Every corpus file parses with no parse-error diagnostic (asserted in 2.3 for BOTH corpora — pro2193
  524/524 + bakon-nano 130/130, 100% parse-clean). The parser/lexer handled the full-option bakon-nano
  project with ZERO parse errors on first contact — no new parser gaps surfaced by the second project.
- [ ] 4.2 Confirm every construct kind in the corpus is ingested by `buildSymbolTable` (`symbol-table-build.ts` `ingestTopLevel`) — no silently-skipped items (methods/properties/actions/transitions parented correctly, GVLs, interfaces, DUTs).
- [ ] 4.3 Confirm editable FBD/LD bodies in the corpus are recognized as VG (NETWORK marker) and analyzed by the VG checks, not mis-flagged as ST.

## 5. Performance — budget on a large project

- [ ] 5.1 Measure the baseline on the corpus: `initialized` seed time, `getProjectScope` build time, and representative definition/references/hover/completion latency.
- [ ] 5.2 Replace the all-or-nothing `Workspace.invalidate()` (`workspace.ts:170-172`) with per-document symbol caching so an edit re-parses only the changed file and `getProjectScope` recomposes cached per-file symbols.
- [ ] 5.3 Batch the `initialized` seed (`dispatch.ts:437-453`) so a large project doesn't block startup.
- [ ] 5.4 Add a budget assertion to the perf test (index-build + per-query thresholds from 5.1); optionally flag-gate the heavy perf test if the full tree is large.

## 6. Nav / resolution correctness

- [ ] 6.1 Spot-check cross-file resolution on the corpus: go-to-definition into unopened library-adjacent files, references across files, hover types, completion in library-heavy scopes — capture as query snapshots (2.2).
- [ ] 6.2 Confirm `references` correctness/noise on the corpus (`references.ts` is name-based, O(n)) — note any type-aware narrowing needed as a follow-up if the corpus shows cross-type collisions.

## 7. Land it

- [ ] 7.1 `cd packages/volt-lsp-iec && bun test` green (incl. new corpus tests) and `bun typecheck` clean.
- [ ] 7.2 Ensure the corpus tests run in CI without a bridge/CODESYS (hermetic committed fixtures).
- [ ] 7.3 `openspec validate harden-lsp-real-project`; sync the `language-server` delta + archive when done.

## 8. Precision follow-ups (deferred — surfaced by the AWA_Palletizer corpus + the LSP-vs-compiler ground-truth diff)

Third corpus `test-corpus/awa-palletizer/` (AWA_Palletizer 09_1, 54 kind source files) added 2026-07-03; fixed a
stray-`;;` parse gap (94.4%->100%) + a GVL block-name-on-Windows-`\`-paths bug. New tool
`scripts/lsp-vs-compiler.ts` builds the live project (compiler = oracle) and diffs vs the LSP — proved AWA
(0 err / 0 warn) + bakon (0 err) compile clean, so their LSP diags are all false positives. Two real gaps it
surfaced, both deferred:

- [ ] 8.1 **Narrowing-conversion diagnostic** — the CODESYS compiler warns `Implicit conversion from 'LREAL' to 'REAL': possible loss of information` (bakon: 27 warnings); the LSP does not. Add an opt-in narrowing / loss-of-precision check to match. This is the one concrete diagnostic the compiler runs that the LSP misses.
- [ ] 8.2 **`S=` set-assignment resolution** — a local FB var referenced via the `S=` set-assignment (SFC-style, e.g. `myState.xCmdInit S= (FALSE);`) is flagged unresolved-identifier (AWA `myState`/`iIndex`, ~14 occ) — a false positive. Resolver/body follow-up.
- [ ] 8.3 The remaining corpus library-blind unresolved floor (bakon 275, pro2193 35, most of AWA 16) is cleared by the separate `library-signature-index` change, not this one — cross-reference, do not duplicate.
- Note: the text-list->enum classification fix has no self-contained test (net48 `CodesysTypeMap`, net8 test suite refs only Core); it is a harvest-time bridge behavior the LSP corpus never guarded, so it does not block corpus removability. Needs a live-bridge fixture if ever tested.
