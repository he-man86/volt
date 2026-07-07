## 1. Land the tracker

- [x] 1.1 Author the LSP 3.17 conformance matrix (`design.md`) — every method categorized ✅/🟡/❌/➖.
- [x] 1.2 Add the capability↔handler parity requirement to the `st-language-server` spec delta.

## 2. Enforce parity (guard the "built-but-unwired" bug)

- [ ] 2.1 Server test: assert every advertised capability in the `initialize` result has a registered handler,
      and that no handler is registered for a method that isn't advertised (the reference sets are the ✅ list).

## 3. Gap backlog — Tier 1 (agent-facing coverage; highest value)

- [x] 3.1 `workspace/diagnostic` (pull): project-wide, on-demand error pull over the eager index. Shares the
      new `server/diagnostics.ts` `documentDiagnostics()` with the push channel.
- [x] 3.2 `textDocument/diagnostic` (pull): per-document pull variant of the same.
- [x] 3.3 `workspace/semanticTokens/refresh` + `workspace/inlayHint/refresh` + `workspace/codeLens/refresh`:
      sent from `reindex()` (client-capability-guarded) so open files un-stale after a `volt pull`.

## 4. Gap backlog — Tier 2 (editor UX)

- [ ] 4.1 `textDocument/semanticTokens/range` — tokens for the requested viewport only (large-file perf).
- [ ] 4.2 `textDocument/semanticTokens/full/delta` — incremental token edits instead of a full re-send.
- [ ] 4.3 `textDocument/didSave` — a freshness fallback when a client emits no watched-file events.
- [ ] 4.4 `workspace/didChangeConfiguration` + `workspace/configuration` — live config (e.g. toggle
      `diagnoseDeadCode`) without a restart.
- [ ] 4.5 `window/workDoneProgress/create` + `$/progress` — report "Indexing workspace…" during the eager crawl.

## 5. Gap backlog — Tier 3 (nice-to-have)

- [ ] 5.1 `textDocument/onTypeFormatting` — format-on-type.
- [ ] 5.2 `textDocument/linkedEditingRange` — rename-as-you-type mirrored edits.
- [ ] 5.3 `workspace/executeCommand` — back the commands emitted by code lenses / code actions.
- [ ] 5.4 `$/setTrace` + `$/logTrace` — protocol trace verbosity.

## 6. Out of scope (documented, not backlog — revisit only if the product changes)

- [x] 6.1 Out-of-scope determination made (revisit only if the product changes): `declaration`, `documentLink`(+resolve), `moniker`,
      `documentColor`/`colorPresentation`, `inlineValue`(+refresh), notebooks, `workspaceFolders`(+didChange),
      the six file-operation events, `applyEdit`, all `*/resolve` (items returned resolved), `window/show*`,
      `telemetry/event`. (Kept as a task so a product change — multi-root, a debug adapter — reopens it.)
