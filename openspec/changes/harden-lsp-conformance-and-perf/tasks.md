Grounding (verify still true when picking this up):
- Duplicate cause was `src/server/server.ts` pushing while declaring pull; fixed in PR #86 — the NEW work is the
  test layer that would have caught it, plus the capability matrix around it.
- Perf cause: `WorkspaceStore.invalidate()` (`src/server/workspace-store.ts`) is called on every doc change, and
  `project()` = `buildSymbolTable(docs())` rebuilds the whole project on the next request.
- The client harness already exists in `src/server/server.test.ts` (`connect()` + `InitializeRequest`) — the new
  `test/lsp/` layer generalises it; don't reinvent the transport.

## Phase A — LSP behavior-conformance harness (catch the class of bug)  ✅ DONE
- [x] Extract the in-memory client/server transport from `server.test.ts` into a reusable `test/lsp/harness.ts`
      (init with an arbitrary capability set, send notifications/requests, collect pushed notifications).
- [x] Capability matrix (`test/lsp/capability-matrix.test.ts`): for {push-only, pull, pull+refresh} assert on
      didOpen/didChange/didSave/didClose: exactly one delivery channel is used, NEVER both (locks the
      duplicate-diagnostics fix), and `didChangeConfiguration` reaches each client kind (push re-publish / pull
      refresh-request). NOTE: there is no real "push+pull" server state — any client advertising
      `textDocument.diagnostic` is treated pull-only (`server.ts` `clientSupportsPull`); the row asserts
      "pull-capable ⇒ push suppressed."
- [x] **Gap fix (found while building the matrix):** `didClose` of a doc no longer indexed pushed
      `publishDiagnostics([])` UNCONDITIONALLY — a push to pull clients, violating "never both". Guarded on
      `!clientSupportsPull` (`server.ts`); pull clients re-pull `[]` on their own channel.
- [x] Diagnostic-identity invariants (`test/lsp/diagnostic-identity.test.ts`): no duplicate `(range, code)`;
      every diagnostic `code` matches `/^C\d{4}$/` OR is a documented exception; `codeDescription.href` present
      for mapped codes. **Gap 1 resolved:** 7 semantic slugs have no catalog `Cnnnn` mapping and emit their
      slug — captured as an explicit `KNOWN_UNMAPPED` allowlist (the tracked debt; shrink it via catalog
      `ourCode` mappings, don't grow it): abstract-instantiation, call-argument-type, conversion-source-mismatch,
      external-non-input-write, non-callable-call, subrange-out-of-range, unterminated-conditional-pragma. Parse
      errors carry no `code` (also allowed).
- [x] Response golden checks (`test/lsp/navigation-golden.test.ts`): definition/hover/references return the
      expected wire shape (uri + range), pinning regressions.
- [x] Wired into `bun test` — auto-discovered under `test/lsp/`; the `test` CI job `cd`s into the package. All
      offline/deterministic (rootUri null → no crawl, no watcher).

## Phase B — measure, then make indexing incremental
- [x] `test/lsp/bench.test.ts`: opt-in (`LSP_BENCH=1`) bench over the largest AVAILABLE corpus project (the
      full corpus is deleted in the working tree — Gap 6; only CodesysTestProject/433 files is materialized).
      Measures store→compute path (WorkspaceStore + documentDiagnostics + definition) after a single-char edit.
- [x] BASELINE (433 files, this machine): diagnostics **p50=13.9ms / p95=27.9ms**; definition ~0ms (project
      cache pre-warmed by the diagnostics call in-iteration). Under any reasonable budget already.
- [x] Profiled the split (Gap 5 CONFIRMED — the proposal's assumed hotspot is the MINORITY cost):
        - `project()` whole-project symbol rebuild: **3.9ms (27%)**  ← what the proposed incremental index fixes
        - dead-code reachability (`deadSet`+`deadMembers`, whole-workspace, invalidated every edit): **~9.6ms (66%)**  ← the real hotspot, UNTOUCHED by the proposal
        - the edited file's own checks (project cached): 0.9ms (7%)
      → An incremental SYMBOL index alone buys ~27%. The dominant win is incrementalizing/caching the
        dead-code passes. AWAITING USER DECISION on scope (see below) before implementing.
- [x] Incremental SYMBOL index: `bindFile`/`unbindFile` in `src/symbols/binder.ts` (tag each top-level scope by
      `defUri`; `linkExtends` now resets base pointers so it's idempotent). `WorkspaceStore` keeps a persistent
      project scope + `boundDocs`; `rebindKey` re-indexes ONLY the edited file on open/change/close. `seedDisk`
      (init/watched-file) still does a full rebuild. Blanket `invalidate()` → targeted `rebindKey`.
- [x] Incremental DEAD-CODE (the real 66% hotspot — 80% of it was re-lexing all files every edit). Split
      `reachability.ts`: `fileReachInfo` (the lex-heavy per-file extraction) + `deadPousFromInfos` /
      `deadMemberSpansFromInfos` (graph fixpoints only). `WorkspaceStore` memoizes `FileReachInfo` in a
      `WeakMap<Document>` — an edit re-lexes only the changed file. Existing `deadPous`/`deadMemberSpans` kept as
      thin wrappers so corpus/other callers are untouched.
- [x] Correctness proven: `test/lsp/incremental-index.test.ts` asserts `project() ≡ buildSymbolTable(workspace())`
      (order-insensitive) after every mutation in a sequence (EXTENDS relink, new files, reseed-with-open-buffer);
      reachability unit tests + full unit suite (696) green; `deadPous` wrapper ≡ old by construction.
- [x] Budget assertion added to the bench (p95 < 60ms; over budget FAILS). RESULT: **p50 13.9→2.1ms, p95
      27.9→5.3ms (≈6× faster)** on 433 files. Bench is opt-in (`LSP_BENCH=1`) — timing tests are flaky as hard
      always-on gates; the budget catches an ALGORITHMIC regression (return to O(project)/edit), and the
      equivalence tests are the always-on correctness gates. NOTE: full-corpus CI numbers unmeasured (Gap 6 — the
      >1500-file projects are deleted in the working tree; only CodesysTestProject/433 is materialized).

## Phase C — close the loop  ✅ DONE
- [x] Folded the diagnostic-identity + no-duplicate invariants into the corpus gate (`corpus.test.ts`): a new
      test drives the FULL LSP wire path (`documentDiagnostics`) over every real file, asserting valid code
      identity + no `(range,code)` dupes. The allowlist is one source of truth (`test/lsp/diagnostic-codes.ts`),
      imported by both the synthetic test and the corpus fold. PASSES on the 593 available files (0 offenders,
      0 dupes → KNOWN_UNMAPPED is complete AND Gap 2 resolved: the first-wins Cnnnn mapping produces no
      accidental duplicate identities on real code).
- [x] Documented the delivery-channel contract + incremental-index invariant + code-identity requirement in
      `docs/behavior.md` (3 new Requirement/Scenario blocks; single source of truth). No "verification status"
      comments added to checks.

## Summary of outcomes
- **Phase A** catches the bug CLASS that shipped duplicate diagnostics — and immediately found + fixed a second
  channel leak (didClose empty-publish to pull clients).
- **Gap 1** (7 unmapped semantic slugs + parse-error no-code) surfaced and codified as tracked debt, not a
  silent test failure.
- **Phase B**: incremental symbol index + incremental dead-code (the real 66% hotspot the proposal missed —
  Gap 5). **6× faster per edit** (p95 27.9→5.3ms), proven byte-equivalent to a full rebuild.
- Remaining external risk: full-corpus CI perf numbers are unmeasured while the >1500-file corpus projects are
  deleted in the working tree (Gap 6). The bench + budget assertion will measure/gate them once restored.

## Open topics (follow-ups, none blocking)

1. **Shrink `KNOWN_UNMAPPED` (Gap 1 debt).** 7 semantic slugs still emit their internal slug instead of a
   `Cnnnn`: `abstract-instantiation`, `call-argument-type`, `conversion-source-mismatch`,
   `external-non-input-write`, `non-callable-call`, `subrange-out-of-range`, `unterminated-conditional-pragma`.
   Each needs a catalog `ourCode` mapping (or a confirmed "no CODESYS equivalent" ruling). Home: the error
   catalog + `test/lsp/diagnostic-codes.ts`. Overlaps the catalog work in [[lsp-precision-open-topics]].

2. **Measure + gate full-corpus perf (Gap 6).** The bench only saw CodesysTestProject/433 (the >1500-file
   projects are deleted in the working tree). Once restored: run `LSP_BENCH=1 bun test test/lsp/bench.test.ts`
   on the largest real project, record the number, and confirm the 60ms p95 budget holds (or right-size it).

3. **Decide the bench's CI status.** Currently opt-in (`LSP_BENCH=1`) — timing tests are flaky as always-on
   gates. Options: (a) leave opt-in, run on perf-touching PRs; (b) add `LSP_BENCH=1` to the `test` job with a
   generous budget for algorithmic-regression detection only. The always-on correctness gate is the
   equivalence test, not the bench.

4. **`linkExtends` + dead-code fixpoints are still O(project) per edit.** `rebindKey` re-runs `linkExtends`
   (reset + rebuild `byName` over all children) and the two reachability fixpoints iterate all cached infos.
   Cheap now (the O(n) lex was the cost, and that's gone) but a latent linear tax. Incrementalize only if a
   very large project measures it — the bench will show it (`timeout-is-a-bug-not-a-budget`).

5. **Child-order divergence is accepted, not eliminated.** Incremental re-index appends the edited file's
   scopes at the end, so `project.children` order differs from a fresh build. Equivalence is asserted
   order-insensitively because same-name items collapse last-write-wins (the protocol invariant). If any
   feature ever depends on child order, this assumption breaks — keep the equivalence test order-insensitive
   and that dependency out.

6. **Archive the change.** Implementation + docs are done and green; ready for `openspec archive` once the
   full-corpus perf number (#2) is captured or explicitly deferred.

7. **Extend the behavior-conformance layer to the stateful protocols.** `server.test.ts` already SMOKE-tests
   nearly every request (one call, "it responds"). The gap the `test/lsp/` layer should close is *protocol
   depth a single call can't reach* — stateful handshakes, multi-step round-trips, cross-file wire shape.
   Reuse the `harness.request()` hook already in place. Ranked by "what only the running server can break":

   Tier 1 — stateful / multi-step (a smoke call structurally can't catch the bug):
   - **Semantic tokens full→delta**: full → edit → delta, APPLY the edits and assert they reconstruct a fresh
     full; and a stale `previousResultId` falls back to full; drop-on-close clears the `semTok` cache
     (`server.ts` ~491). Pure protocol state — invisible to unit tests on `semanticTokensData`.
   - **Call hierarchy** prepare→incoming/outgoing: the prepared item round-trips and is re-resolved by
     `(uri, selectionRange)→offset` (`reResolve`, `server.ts` ~414). Assert real cross-file callers/callees.
   - **Type hierarchy** prepare→super/subtypes: same round-trip over cross-file `EXTENDS` chains.
   - **Rename** prepare→rename: cross-file `WorkspaceEdit` (`changes` keyed by every referencing URI) — a
     single-file smoke misses the multi-file edit + prepare/rename agreement.

   Tier 2 — input/context-dependent wire shape:
   - **Code actions**: the offered fix's edit targets the `context.diagnostics` range passed in (assert the
     action↔diagnostic linkage + edit shape, not just "returns an array").
   - **Completion** (`.`): member completion depends on the project index resolving the base type cross-file;
     assert the member set + `CompletionItemKind`.
   - **Signature help** (`(` `,`): `activeParameter` advances across commas; `activeSignature` on overloads.

   Tier 3 — refresh & workspace flows (need a rooted/temp-dir harness variant, `rootUri` set):
   - Refresh fan-out: after a watched-file change, `reindex()` fires semanticTokens/inlayHint/codeLens/
     diagnostics refresh (`server.ts` ~169) — the matrix asserts only the diagnostics one today.
   - `didChangeWatchedFiles` → a new file resolves without opening it (the "stays fresh" scenario).
   - Incremental `didChange`: a RANGED edit updates the right span and later queries reflect it.

   Tier 4 — cheap wire-shape goldens (thin 1:1 wrappers over unit-tested services). These pin the RESPONSE
   ENVELOPE at the server layer — a distinct failure mode from "the service computes the right answer" (a
   response shape can regress while the unit test on the service still passes). Each is ~1ms via the harness,
   so the asymmetry favors adding them: a missing test ships a silent wire regression; an extra cheap one
   costs milliseconds. Add a one-assert golden for each: folding range, selection range, document highlight,
   document symbol, formatting (doc/range/on-type), linked editing, workspace symbol, inlay-hint content,
   type/impl definition. GUARDRAIL (the only reason to omit one): if a test's ONLY failure mode is already
   caught identically elsewhere, it's noise not coverage — don't duplicate, everything else gets a golden.

   Next-PR pick: Tier 1, especially semantic-tokens delta + cross-file rename. Tier 4 is a cheap sweep — do it
   in one pass alongside Tier 1.
