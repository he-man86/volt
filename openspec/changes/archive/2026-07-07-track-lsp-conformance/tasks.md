## 1. Land the tracker

- [x] 1.1 Author the LSP 3.17 conformance matrix (`design.md`) — every method categorized ✅/🟡/❌/➖.
- [x] 1.2 Add the capability↔handler parity requirement to the `st-language-server` spec delta.

## 2. Enforce parity (guard the "built-but-unwired" bug)

- [x] 2.1 Server test (`server.test.ts` "parity: every advertised request capability answers"): drives every
      advertised provider and fails on a method-not-found (-32601). Self-guarding — a new capability with no
      parity entry fails the test. (It already caught a missing test import while being written.)

## 3. Gap backlog — Tier 1 (agent-facing coverage; highest value)

- [x] 3.1 `workspace/diagnostic` (pull): project-wide, on-demand error pull over the eager index. Shares the
      new `server/diagnostics.ts` `documentDiagnostics()` with the push channel.
- [x] 3.2 `textDocument/diagnostic` (pull): per-document pull variant of the same.
- [x] 3.3 `workspace/semanticTokens/refresh` + `workspace/inlayHint/refresh` + `workspace/codeLens/refresh`:
      sent from `reindex()` (client-capability-guarded) so open files un-stale after a `volt pull`.

## 4. Gap backlog — Tier 2 (editor UX)

- [x] 4.1 `textDocument/semanticTokens/range` — viewport-only tokens (via the shared `tokenRecords` + `encode`).
- [x] 4.2 `textDocument/semanticTokens/full/delta` — prefix/suffix diff against a per-URI cached result id.
- [x] 4.3 `textDocument/didSave` — re-validates on save (fallback when a client emits no watched-file events);
      `textDocumentSync` advertised in object form with `save`.
- [x] 4.4 `workspace/didChangeConfiguration` + `workspace/configuration` — live `diagnoseDeadCode` toggle
      (`applyConfig` + re-publish; pulls the `volt` section when the config isn't pushed with the notification).
- [x] 4.5 `window/workDoneProgress/create` + `$/progress` — brackets the eager crawl (client-capability-guarded).

## 5. Gap backlog — Tier 3 (nice-to-have)

- [x] 5.1 `textDocument/onTypeFormatting` — reformats the trigger line (reuses `formatRange`); triggers `;`, `\n`.
- [x] 5.2 `textDocument/linkedEditingRange` — the cursor identifier's occurrences (reuses `documentHighlights`).
- [x] 5.3 `workspace/executeCommand` — reclassified ➖: code lenses are display-only, code actions return edits;
      nothing to execute server-side.
- [x] 5.4 `$/setTrace` + `$/logTrace` — reclassified ➖: `$/setTrace` is a notification the connection harmlessly
      ignores, and we emit no `$/logTrace` (server logs go to stderr). Adding a no-op would be dead code.

## 6. Out of scope (documented, not backlog — revisit only if the product changes)

- [x] 6.1 Out-of-scope determination made (revisit only if the product changes): `declaration`, `documentLink`(+resolve), `moniker`,
      `documentColor`/`colorPresentation`, `inlineValue`(+refresh), notebooks, `workspaceFolders`(+didChange),
      the six file-operation events, `applyEdit`, all `*/resolve` (items returned resolved), `window/show*`,
      `telemetry/event`. (Kept as a task so a product change — multi-root, a debug adapter — reopens it.)
