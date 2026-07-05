## Why

The LSP's test suite grew organically as the LSP evolved and now has duplication, strays, and broken live-bridge wiring — it's hard to reason about and doesn't reflect the current direction. An audit of all 58 test files shows the *right* architecture is already ~80% present (a by-language-principle feature catalog + a compiler-oracle replay + a real-project corpus ratchet) but buried under: the same nav query tested two ways, a diagnostics harness copy-pasted 4×, pragmas covered 4 ways, dead directories, and a recorder that left with `volt-agent` so the compiler ground truth is frozen and can't be refreshed. The goal is one clean, principled structure where **every language feature has one feature test verified against the live CODESYS/TwinCAT bridge**, the **4 corpus projects are the safety net**, and a corpus-surfaced gap becomes a new feature test.

## What Changes

- **Keep the three pillars** (already present, worth keeping):
  1. the **by-language-principle catalog** (`conformance/fixtures/`, 229 `LanguageTest` cases across 19 principles) — the feature-test spine;
  2. the **compiler-oracle replay** (`language.test.ts` diffing LSP vs `expected-{codesys,tc}.json`);
  3. the **corpus ratchet** (`real-corpus.test.ts` over the 4 real projects) — the safety net.
- **Revive the live-bridge loop** — recreate the recorder INSIDE `volt-lsp-iec` (it left with `volt-agent`): push each catalog case + a PLC_PRG instantiation to the live bridge via `volt push` (the canonical StSplitter path), build, capture the compiler's per-object diagnostics into `expected-{vendor}.json`. Add a `record:language` package script. So the frozen oracle becomes refreshable, and adding a feature = add a catalog case + re-record.
- **Collapse duplication to one mechanism per feature**:
  - the 7 nav queries tested twice (snapshot `corpus/*` + assertion `scenarios/queries/*`) → pick one per query (lean: keep the readable assertion form, drop redundant snapshots, or vice-versa — decided per query in design);
  - fold the 4× copy-pasted diagnostics harness (`diagnostics` / `check-call-arguments` / `check-narrowing-conversion` / `type-infer`) into one shared test helper;
  - dedupe the 4-way pragma coverage.
- **Remove genuine strays** (zero references / dead): empty `src/tests/live/`; top-level `packages/volt-lsp-iec/conformance/*.fbd`; the orphan `corpus/__snapshots__/language.test.ts.snap`; dangling `record:language` doc instructions + stale README/comment paths.
- **Codify the model**: feature test (catalog) ↔ live bridge (oracle) as the primary spec; corpus ratchet as the net; a documented flow for "corpus surfaced a miss → add a feature test."
- **Out of scope**: changing what the LSP does (no behavior changes); the type-inference checks themselves (already built); non-test source.

## Capabilities

### New Capabilities
- (none — test infrastructure; no product spec changes)

### Modified Capabilities
- `language-server`: add a requirement describing the test architecture — feature tests organized by language principle and verified against the live vendor bridge, the corpus projects as the regression safety net, and the rule that a corpus-surfaced gap is promoted to a feature test. (Documents how the LSP's behavior is verified, not new behavior.)

## Impact

- **Code (volt-lsp-iec, tests only):** recreate `scripts/record-language.ts` + `record:language` script; reorganize/dedupe under `src/tests/` (catalog stays; strays removed; one mechanism per query; shared diagnostics helper). No product source changes.
- **Tooling:** the recorder needs a live bridge (`volt-scripts/codesys-bridge.ps1 up` → :8556 CODESYS; :8555 TwinCAT). Re-recording is a Windows/CODESYS step; the replay stays offline.
- **Net effect:** fewer, clearer tests; every feature provable against the real compiler; the corpus stays the net. No loss of the 229 catalog cases, the compiler ground truth, or corpus coverage.
