## 1. Materialize the corpus

- [ ] 1.1 Confirm IP clearance: decide full project vs. sanitized/representative subset; get sign-off before any `.st` lands in the repo.
- [ ] 1.2 Snapshot the project: `pwsh volt-scripts/codesys-bridge.ps1 up -Project <real.project>` (headless, :8556), then fetch every item (`volt pull` in a temp workspace, or `POST /fetch {knownItems:{}}`) → `.st` tree.
- [ ] 1.3 Sanitize if required (identifiers/strings), then commit the tree under `packages/volt-lsp-codesys/src/tests/conformance/real-corpus/**`.
- [ ] 1.4 Write a repeatable regen script + short README documenting exactly how the corpus was produced (project source, bridge version, sanitization), so it can be refreshed.

## 2. Disk-sourced corpus harness

- [ ] 2.1 Add `buildCorpusWorkspaceFromDisk(dir)` in `src/tests/conformance/_shared.ts` (mirror `dispatch.ts` `walkForStFiles`): read every `.st`, `ws.openDocument(pathToFileURL(f), text, 1)`, return the `Workspace` + `getProjectScope()`.
- [ ] 2.2 Add a `corpus-real/*.test.ts` (or extend the existing loop) that runs the LSP queries (definition/references/hover/completion/workspace-symbol/semantic-tokens) over the real corpus and snapshots results — hermetic (committed `.st`, no live bridge).
- [ ] 2.3 Add a **whole-corpus diagnostics sweep** test: parse + `computeSemanticDiagnostics` over every corpus file via the production `resolveConfig` path (vendor = `codesys`), asserting the valid corpus produces **zero** diagnostics.

## 3. Precision — zero false positives

- [ ] 3.1 Survey the baseline: `bun run scripts/run-diagnostics.ts <corpus-dir>` (all checks on) — record every diagnostic code + count to triage FP vs. real.
- [ ] 3.2 Fix `unresolved-identifier` library-blindness (`check-unresolved-identifier.ts`): implement strategy (b) — don't flag bare references absent from the whole project scope (extend the existing member-access fall-through); re-survey.
- [ ] 3.3 Confirm `unknownPragma` / `wrongVendorPragma` / `initSlotCollision` stay OFF by default and don't need to be forced on for real projects; verify the CODESYS vendor mask (`rule-vendor-applicability.ts`) hides the twincat-only checks.
- [ ] 3.4 Triage every remaining diagnostic: each must be a genuine defect or get a tuned check + a regression fixture. Drive the sweep (2.3) to green.
- [ ] 3.5 If strategy (b) leaves genuine undefined-symbol misses, evaluate strategy (a) (a library-symbol index from the referenced-library manifest).

## 4. Coverage — no parse gaps

- [ ] 4.1 Assert every corpus file parses with no parse-error diagnostic on valid code (part of 2.3); investigate any parser failure and add a minimal fixture for it.
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

- [ ] 7.1 `cd packages/volt-lsp-codesys && bun test` green (incl. new corpus tests) and `bun typecheck` clean.
- [ ] 7.2 Ensure the corpus tests run in CI without a bridge/CODESYS (hermetic committed fixtures).
- [ ] 7.3 `openspec validate harden-lsp-real-project`; sync the `language-server` delta + archive when done.
