## 1. Remove strays (zero-reference dead code)

- [x] 1.1 Delete the empty `src/tests/live/` dir (only `.gitkeep`).
- [x] 1.2 Delete the top-level `packages/volt-lsp-iec/conformance/` dir (`fixtures/{fbd,ld}/*.fbd` — grep-confirmed 0 references in src).
- [x] 1.3 Delete the orphan `src/tests/conformance/corpus/__snapshots__/language.test.ts.snap` (no `corpus/language.test.ts` exists).
- [~] 1.4 Stale doc paths FIXED (README `src/conformance/`→`src/tests/conformance/`, navigation-queries path). `record:language` skip text deferred to §4 (restored there). — was: Fix/remove dangling `record:language` instructions + stale paths (README `src/conformance/`; `navigation-queries.test.ts:6` `conformance/tests/corpus/`; `language.test.ts` skip text — update once §4 restores the script).
- [x] 1.5 `bun test` green after removals.

## 2. Shared diagnostics test helper (kill 4× copy-paste)

- [x] 2.1 Extract `src/tests/support/diagnostics.ts`: `diagnosticsFor(source, { configOverrides, code? })` building the symbol table + `computeSemanticDiagnostics`.
- [x] 2.2 Rewire `unit/diagnostics.test.ts`, `unit/check-call-arguments.test.ts`, `unit/check-narrowing-conversion.test.ts`, `unit/type-infer.test.ts` onto it (keep each file's cases; drop the boilerplate). Suite green.
- [x] 2.3 Assessed: the 4 pragma tests cover DISTINCT concerns (catalog-shape / every-reference-pragma-recognized / hover / oracle) — NOT duplication, so removing any loses coverage. Instead deduped the HARNESS: rewired `pragma-smoke-corpus` onto the shared helper. Coverage preserved.

## 3. One mechanism per nav query (drop redundant snapshots)

- [x] 3.1 For each of the 7 doubly-covered queries (completion, definition, hover, references, document-symbols, semantic-tokens, + the bundle in `navigation-queries`): keep the assertion form in `scenarios/queries/*`, drop the redundant `conformance/corpus/<query>.test.ts` snapshot — UNLESS catalog-wide breadth demonstrably catches a class of regression assertions don't (then keep one snapshot, noted).
- [x] 3.2 The 5 corpus-only queries (code-action, document-highlight, folding-range, selection-range, signature-help) have NO assertion twin → snapshot IS their single mechanism (not duplication). KEPT as-is; converting to assertions is an optional follow-up, not needed for the no-duplication goal.
- [x] 3.3 Remove the now-unused snapshot files under `corpus/__snapshots__/`. Suite green; confirm nav coverage intact via `scenarios/queries/*`.

## 4. Revive the live-bridge recorder

- [x] 4.1 Ported the recorder (per-test ISOLATION — /build has no object attribution, and it prevents stale-logic bleed): reset to empty → push test + PLC_PRG instantiation via `volt push` → /build → record non-info diagnostics → reset. `scripts/record-language.ts`. — was: Port the recorder into `scripts/record-language.ts` (from the pre-deletion `volt-agent` version): load `ALL_TESTS`; per category write each case `source` + a PLC_PRG instantiation as a workspace kind-named file, `volt push` (canonical StSplitter path), `POST /build`, scope diagnostics by object name, cleanup; write `recordings/expected-{vendor}.json`. Vendor by port (8556 CODESYS / 8555 TwinCAT).
- [x] 4.2 Added `record:language` to package.json.
- [x] 4.3 Validated live against a freshly-built CODESYS `:8556` bridge (unblocked now `fix-library-signatures-fetch-shape` landed): `RECORD_LIMIT=3 bun run record:language` records diagnostics per case (reset → push → `/build` → record → reset), and the fresh recording matches the committed ground truth EXACTLY (3/3: `hide_var` 2 external-write errors, `warning_message` 1 warning, `call_after_init` clean). Restored the full recording; `language.test.ts` replays green (1470/1470).
- [x] 4.4 `language.test.ts` header + skip messages reference `bun run record:language`; refreshed the stale `volt-agent` provenance comment to point at `scripts/record-language.ts`; added a "Re-recording the conformance oracle" section to the package README (per-vendor ports, `RECORD_ONLY`/`RECORD_LIMIT`).

## 5. Codify the model

- [x] 5.1 Rewrite the package test README: the model = **feature test (catalog) ↔ live bridge (compiler oracle)** for semantics; **assertion tests** for nav; **corpus ratchet** as the net; the flow "corpus surfaces a miss → add a catalog/assertion feature test → (re-record)".
- [x] 5.2 `language-server` spec delta: add the test-architecture requirement (how LSP behavior is verified).

## 6. Land it

- [x] 6.1 `bun test` green (3485 pass / 0 fail / 11 skip) + `bun typecheck` clean; corpus ratchet unaffected (precision 0 errors on all 4). Dedup landed in §2–3 (shared helper + dropped redundant snapshots), no coverage loss.
- [x] 6.2 `openspec validate clean-lsp-test-architecture` passes; synced the `language-server` delta (added the three-layer test-architecture requirement beside the corpus requirement); archived.
