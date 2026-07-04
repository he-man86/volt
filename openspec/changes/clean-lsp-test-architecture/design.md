## Context

Audit of all 58 test files (`packages/volt-lsp-iec/src/tests/**` + `real-corpus.test.ts`) found the target architecture already ~80% present but obscured. The three pillars worth keeping:

1. **Language-principle catalog** — `conformance/fixtures/` (229 `LanguageTest` across 19 principles: pragma 54, operator 30, data-type 20, conversion 13, interface 11, oop 8, lifecycle 7, …). Typed (`conformance/types.ts`), aggregated (`fixtures/index.ts` → `ALL_TESTS`), each entry carries `expectTcAccepts` + `source` + PLC_PRG instantiation fields. This IS the by-language-principle feature spine.
2. **Compiler-oracle replay** — `conformance/language.test.ts` runs `computeSemanticDiagnostics` over the catalog ×2 vendors and hard-asserts agreement with frozen `recordings/expected-{codesys,tc}.json` (documented `KNOWN_DIVERGENCES`). The oracle layer.
3. **Corpus ratchet** — `real-corpus.test.ts` over the 4 real projects; monotonic parse/ingest/precision/body-AST floors. The safety net.

What's wrong: (a) the **recorder** that refreshes the oracle left with `volt-agent` (no `record:language` script here) → ground truth is frozen; (b) **duplication** — the 7 nav queries tested twice (`corpus/*` snapshots + `scenarios/queries/*` assertions), the diagnostics harness copy-pasted 4×, pragmas 4 ways; (c) **strays** — empty `src/tests/live/`, top-level `conformance/*.fbd` (0 refs), orphan `corpus/__snapshots__/language.test.ts.snap`, dangling `record:language` docs.

Constraint: this is tests only — **no LSP behavior change**, and the full suite must stay green (minus deletions).

## Goals / Non-Goals

**Goals**
- One clean model: **feature test (catalog) ↔ live bridge (compiler oracle)** for semantics; **assertion tests** for nav; **corpus ratchet** as the net.
- Revive the live loop: a `record:language` recorder inside `volt-lsp-iec`.
- Remove strays; collapse each feature to one mechanism; document the "corpus miss → new feature test" flow.
- Preserve the 229 catalog cases, the compiler ground truth, and corpus coverage.

**Non-Goals**
- Changing LSP behavior or the type-inference checks (already built).
- Re-recording the oracle in this change (needs a live Windows/CODESYS run — the *capability* is restored here; the actual re-record is an operational step).
- Touching non-test source.

## Decisions

### D1: Keep the language-principle catalog as the spine — do NOT rebuild
It's already the exact organization wanted (19 principles, 229 cases) and is consumed by both the oracle and query tests. Rebuilding would discard 229 curated cases + their `expectTcAccepts` ground-truth claims for zero gain. **Alternative:** rewrite from scratch — rejected; that's the churn the owner wants to avoid.

### D2: Recreate the recorder in `volt-lsp-iec`, using the canonical push path
New `scripts/record-language.ts` + `record:language` script. For each catalog case: write its `source` as a workspace `.st` file + a PLC_PRG that instantiates it (`plcPrgVar`/`plcPrgBody`), `volt push` (the StSplitter path — raw `/push` with hand-built `sourceText` mis-splits decl/impl, proven this session), `POST /build`, scope diagnostics by object name → write `expected-{vendor}.json`. Per-category push+build+cleanup (the old recorder's approach — dodges the bridge's O(N) `LookupItemByName` cost). Vendor by port (8556 CODESYS / 8555 TwinCAT). **Alternative:** raw `/push` — rejected (format edge). **Alternative:** leave it in an external package — rejected; the owner wants it integrated + maintainable in this package.

### D3: One mechanism per feature — split by what the bridge can verify
- **Diagnostics / semantics** → catalog + live-bridge oracle (the compiler IS the truth). This is the primary feature-test layer.
- **Nav queries** (completion / definition / hover / references / rename / …) → **assertion tests** (`scenarios/queries/*`), because the compiler gives no go-to-def/hover ground truth — the bridge can't verify nav. Keep these as the nav feature tests; **drop the redundant `corpus/*` per-query snapshot tests** (15 files / ~3435 brittle snapshots that duplicate the assertion coverage). Breadth previously from snapshots is recovered by the corpus PROJECT ratchet (broad, real code) + targeted assertions.
- **Trade-off:** dropping the 229-wide per-query snapshots loses some breadth per query. Mitigation: the corpus ratchet exercises every query path over real projects; assertions cover the shapes that matter. If a specific query needs catalog-wide breadth, it can keep ONE snapshot file — decided per query during execution, not a blanket delete.

### D4: One shared diagnostics test helper
The `computeSemanticDiagnostics`-driven `setup()`/`callArgDiags()`/`narrowingDiags()` boilerplate is copy-pasted across `diagnostics.test.ts` + the three new `check-*.test.ts`. Extract one `src/tests/support/diagnostics.ts` helper; each check file keeps only its cases. Pragma coverage collapses to catalog-shape + one smoke test.

### D5: Remove strays outright
Empty `src/tests/live/`; top-level `packages/volt-lsp-iec/conformance/` (`.fbd`, 0 refs); orphan `corpus/__snapshots__/language.test.ts.snap`; fix/remove dangling `record:language` text + stale README/`navigation-queries.test.ts:6` paths.

## Risks / Trade-offs

- **Dropping 15 snapshot files loses catalog-wide per-query breadth** → **Mitigation:** corpus ratchet covers query paths on real code; assertions cover key shapes; keep a single snapshot per query only where breadth is proven valuable (D3).
- **Recorder recreation is non-trivial** (per-category batching, PLC_PRG assembly, cleanup) → **Mitigation:** port the proven logic from git (`volt-agent` recorder pre-deletion); validate against the live bridge on one category before the full run.
- **Re-recording needs live CODESYS/TC** → **Mitigation:** in scope is the *capability* + the offline replay; the actual re-record is a documented Windows step (like the original corpus harvest).
- **Big diff across ~58 files** → **Mitigation:** phase it (strays → helper → query dedup → recorder), full suite green after each phase; no product source touched.

## Migration Plan
1. Remove strays (D5) — suite green.
2. Extract the shared diagnostics helper (D4); rewire the check tests — suite green.
3. Collapse per-query duplication (D3) — decide per query; suite green.
4. Recreate the recorder + `record:language` (D2); validate one category live.
5. Document the model (feature↔bridge, corpus-as-net, gap→feature-test) in the package README + the `language-server` spec delta.
6. `openspec validate`; sync + archive.

## Open Questions
- Per-query: keep assertion or snapshot where they overlap? (Lean: assertion; keep a snapshot only where catalog-wide breadth demonstrably catches things assertions don't.)
- Should the type-inference true-positive cases (call-arg, narrowing) become **catalog fixtures** (bridge-verified) rather than hand-authored unit cases? (Lean: yes eventually — once the recorder is live, they're stronger as catalog cases with real compiler truth. Do it as a follow-up so this change stays a refactor, not new coverage.)
