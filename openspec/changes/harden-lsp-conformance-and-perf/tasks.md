Grounding (verify still true when picking this up):
- Duplicate cause was `src/server/server.ts` pushing while declaring pull; fixed in PR #86 — the NEW work is the
  test layer that would have caught it, plus the capability matrix around it.
- Perf cause: `WorkspaceStore.invalidate()` (`src/server/workspace-store.ts`) is called on every doc change, and
  `project()` = `buildSymbolTable(docs())` rebuilds the whole project on the next request.
- The client harness already exists in `src/server/server.test.ts` (`connect()` + `InitializeRequest`) — the new
  `test/lsp/` layer generalises it; don't reinvent the transport.

## Phase A — LSP behavior-conformance harness (catch the class of bug)
- [ ] Extract the in-memory client/server transport from `server.test.ts` into a reusable `test/lsp/harness.ts`
      (init with an arbitrary capability set, send notifications/requests, collect pushed notifications).
- [ ] Capability matrix: for {push-only, pull-only, push+pull, ±`diagnostics.refreshSupport`} assert on didOpen/
      didChange/didSave: exactly one delivery channel is used, NEVER both (locks the duplicate-diagnostics fix),
      and a `didChangeConfiguration` reaches each client kind (push re-publish / pull refresh-request).
- [ ] Diagnostic-identity invariants (synthetic docs + a corpus sample): no duplicate `(range, code)`; every
      semantic diagnostic `code` matches `/^C\d{4}$/` OR is a documented exception (`VG_*`, parse errors);
      `codeDescription.href` is present for mapped codes.
- [ ] Response golden checks: definition/hover/references on a fixture return the expected wire shape (pin regressions).
- [ ] Wire the harness suite into `bun test` (and the `test` CI job); it must stay offline/deterministic.

## Phase B — measure, then make indexing incremental
- [ ] `test/lsp/bench.ts`: open the largest corpus project through the harness; measure end-to-end latency of
      `textDocument/diagnostic` and `textDocument/definition` after a single-char edit; print p50/p95.
- [ ] Capture a baseline number in the change log so the win is provable.
- [ ] Profile the hotspot (expected: full `buildSymbolTable` per edit). Confirm with `PROFILE`-style instrumentation.
- [ ] Introduce a per-file symbol index in `WorkspaceStore` (or `src/symbols/`): on a doc change, re-parse + re-index
      ONLY that file and re-link cross-file refs (EXTENDS/qualified names), keeping other files' indexes intact.
      Replace the blanket `invalidate()` with targeted invalidation.
- [ ] Prove correctness: the unit/conformance/corpus gates stay green (incremental index ≡ full rebuild output).
- [ ] Add a budget assertion to the bench (a request over the budget FAILS) and run it in CI where feasible; if the
      full corpus is too heavy for CI, gate on a representative subset and `log()` what was scoped out.

## Phase C — close the loop
- [ ] Fold the diagnostic-identity + no-duplicate invariants into the existing corpus gate so every real file is
      checked, not just synthetic cases.
- [ ] Document the capability/delivery contract + the incremental-index invariant in `volt-lsp-iec/docs/` (single
      source of truth; do NOT reintroduce "verification status" comments in checks — the catalog owns that).
