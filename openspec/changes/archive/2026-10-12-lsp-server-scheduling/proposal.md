## Why

The owner (2026-10-12): `src/server/` "feels like the last one that had not gone through a refactor" — it had a structural
pass (`lsp-same-standard`, `lsp-server-tests-layout`), never a design-level review. That review (read-only, 2026-10-12,
measured on pro2193 7759 files and lenze-mid 7599) found the server CORRECT (every handler is synchronous and vscode-jsonrpc
dispatches in arrival order, so no stale result is published) but badly SCHEDULED:

- **H1 — the workspace diagnostics pull is a continuous full recompute.** `server.ts:55` declares `workspaceDiagnostics`;
  `handlers/diagnostics.ts:30-44` recomputes every document on every call (`Full`, `version: null`, no resultId,
  `previousResultIds` ignored); vscode-languageclient 10.1.1 re-pulls 2 s after each completion, forever. On pro2193 one
  pass is 3.0–4.4 s, so the server is ~60 % busy recomputing unchanged findings and a hover can queue ~4 s behind it.
- **H2 — every watched-file event re-crawls and re-parses the whole workspace**, saves included (`documents.ts:43` →
  `state.ts:112-132` → `workspace-store.ts:262-273`): ~2.6 s blocking per Ctrl+S on pro2193, then a refresh that re-pulls
  the workspace (H1).
- **M1** no cancellation (queued cancelled requests still run); **M2** the indexing progress sends `end` before `begin`
  (never shown); **M3** no logger (`NullLogger`) and a non-transactional rebind (a throwing parse can leave diagnostics
  empty for good, silently); **M4** domain findings and message texts in `document-diagnostics.ts` (layer G is "the LSP
  adapter and nothing else"); **M5** clients without dynamic registration never see disk changes.
- **L1–L5:** lifecycle conformance (exit code, requests after shutdown, -32002 before initialize, no processId watchdog —
  relevant to the LSP-zombie history), no document versions on results, fixed workspace folders undocumented, four copies
  of the `indexed`/push-vs-pull gate.

## What Changes

Targeted rework of two seams; the handlers, `vendor.ts` and `WorkspaceStore` stay.
- **A `DiagnosticsPublisher`** (one owner of push vs pull, the `indexed` gate, versioned publishes, resultIds from a store
  generation so an unchanged workspace answers `Unchanged`, the manifest diagnostics). Default chosen for H1: keep
  `workspaceDiagnostics`, answer `Unchanged` (not drop the capability).
- **Incremental disk sync:** a watched-file event upserts or deletes one disk entry and rebinds it; only reference files
  (`.library`, `.projectsettings`, `.task`, `.device`) re-scan wholesale.
- **Cancellation:** a ConnectionStrategy answering RequestCancelled for undispatched requests; same-URI pulls coalesced.
- **Progress** awaited before the crawl (begin before end), or removed.
- **Error isolation:** a logger to `window/logMessage`; a transactional rebind (reset the project scope on a throw).
- **Domain findings to `analysis/`** (missing language, unstated bodies, manifest warnings); the server keeps the LSP
  conversion only.
- **Lifecycle conformance** and a `processId` parent watchdog; an `fs.watch` fallback for clients without dynamic
  watching (or the limitation documented).
- Measured before/after with the existing bench: 10 idle workspace pulls ≈ one pass; one save re-parses one file.

## Impact

`packages/volt-lsp-iec/src/server/**`, `src/workspace/workspace-store.ts`, `src/analysis/` (the moved findings),
`test/lsp/`, `docs/architecture.md` layer G. No wire change for Volt; LSP behaviour is protocol-correct and faster.
