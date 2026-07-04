## 1. Remove strays (zero-reference dead code)

- [x] 1.1 Delete the empty `src/tests/live/` dir (only `.gitkeep`).
- [x] 1.2 Delete the top-level `packages/volt-lsp-iec/conformance/` dir (`fixtures/{fbd,ld}/*.fbd` — grep-confirmed 0 references in src).
- [x] 1.3 Delete the orphan `src/tests/conformance/corpus/__snapshots__/language.test.ts.snap` (no `corpus/language.test.ts` exists).
- [~] 1.4 Stale doc paths FIXED (README `src/conformance/`→`src/tests/conformance/`, navigation-queries path). `record:language` skip text deferred to §4 (restored there). — was: Fix/remove dangling `record:language` instructions + stale paths (README `src/conformance/`; `navigation-queries.test.ts:6` `conformance/tests/corpus/`; `language.test.ts` skip text — update once §4 restores the script).
- [x] 1.5 `bun test` green after removals.

## 2. Shared diagnostics test helper (kill 4× copy-paste)

- [ ] 2.1 Extract `src/tests/support/diagnostics.ts`: `diagnosticsFor(source, { configOverrides, code? })` building the symbol table + `computeSemanticDiagnostics`.
- [ ] 2.2 Rewire `unit/diagnostics.test.ts`, `unit/check-call-arguments.test.ts`, `unit/check-narrowing-conversion.test.ts`, `unit/type-infer.test.ts` onto it (keep each file's cases; drop the boilerplate). Suite green.
- [ ] 2.3 Collapse 4-way pragma coverage to catalog-shape (`reference/pragma-catalog-conformance`) + one smoke test; remove the redundant path. Suite green.

## 3. One mechanism per nav query (drop redundant snapshots)

- [ ] 3.1 For each of the 7 doubly-covered queries (completion, definition, hover, references, document-symbols, semantic-tokens, + the bundle in `navigation-queries`): keep the assertion form in `scenarios/queries/*`, drop the redundant `conformance/corpus/<query>.test.ts` snapshot — UNLESS catalog-wide breadth demonstrably catches a class of regression assertions don't (then keep one snapshot, noted).
- [ ] 3.2 Keep corpus-only queries with no assertion twin (`code-action`, `document-highlight`, `folding-range`, `selection-range`, `signature-help`) — or add a small assertion test and drop the snapshot, per query.
- [ ] 3.3 Remove the now-unused snapshot files under `corpus/__snapshots__/`. Suite green; confirm nav coverage intact via `scenarios/queries/*`.

## 4. Revive the live-bridge recorder

- [ ] 4.1 Port the recorder into `scripts/record-language.ts` (from the pre-deletion `volt-agent` version): load `ALL_TESTS`; per category write each case `source` + a PLC_PRG instantiation as workspace `.st`, `volt push` (canonical StSplitter path), `POST /build`, scope diagnostics by object name, cleanup; write `recordings/expected-{vendor}.json`. Vendor by port (8556 CODESYS / 8555 TwinCAT).
- [ ] 4.2 Add `"record:language"` to `package.json` scripts.
- [ ] 4.3 Validate live on ONE category (bridge up via `volt-scripts/codesys-bridge.ps1 up`): recorded diagnostics land, cleanup restores the fixture, `language.test.ts` replays green.
- [ ] 4.4 Update `language.test.ts` skip message + README to reference the restored `record:language`.

## 5. Codify the model

- [ ] 5.1 Rewrite the package test README: the model = **feature test (catalog) ↔ live bridge (compiler oracle)** for semantics; **assertion tests** for nav; **corpus ratchet** as the net; the flow "corpus surfaces a miss → add a catalog/assertion feature test → (re-record)".
- [ ] 5.2 `language-server` spec delta: add the test-architecture requirement (how LSP behavior is verified).

## 6. Land it

- [ ] 6.1 `cd packages/volt-lsp-iec && bun test` green + `bun typecheck` clean; the corpus ratchet unaffected; net test count DOWN (dedup) with no coverage loss.
- [ ] 6.2 `openspec validate clean-lsp-test-architecture`; sync the `language-server` delta + archive.
