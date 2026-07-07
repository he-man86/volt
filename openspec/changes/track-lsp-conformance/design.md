## Context

This is the authoritative map of **LSP 3.17** (`microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/`)
against `packages/volt-lsp-iec` (the `volt-lsp-iec` server, `src/server/server.ts` + the `services/` layer).
It is a reference + roadmap, not a delta; the enforceable slice is the parity requirement in the spec delta.

**Domain framing** (why some methods are out of scope): the LSP analyzes IEC 61131-3 Structured Text mirrored
to text files by `volt pull`. Type-checking/codegen stay the IDE's job; there are no notebooks, no debug
adapter, no color literals, no cross-repo indexing, and the workspace is single-root. The agent is the
primary consumer (headless), the VS Code extension the secondary (human).

## Status legend

- ✅ **Implemented** — advertised capability + registered handler + a service behind it.
- 🟡 **Partial** — present but a sub-feature/optimization is missing.
- ❌ **Gap** — applicable to us, not yet implemented → in the `tasks.md` backlog.
- ➖ **Out of scope** — not meaningful for a text-mirrored PLC ST LSP (reason given).

## Matrix

### 1. Lifecycle

| Method | Status | Notes |
|---|---|---|
| `initialize` | ✅ | capabilities + `initializationOptions` (`vendor`, `diagnoseDeadCode`); resolves `rootUri` |
| `initialized` | ✅ | triggers the eager source crawl + watcher registration (post-handshake, non-blocking) |
| `shutdown` | ✅ | |
| `exit` | ✅ | |
| `client/registerCapability` | ✅ | server→client: registers the `didChangeWatchedFiles` file watcher when the client advertises dynamic registration |
| `client/unregisterCapability` | ➖ | the watcher's lifetime is the session; never unregistered |
| `$/cancelRequest` | 🟡 | handled by the `vscode-jsonrpc` connection layer; our handlers are synchronous, so there is nothing to cancel |
| `$/setTrace` · `$/logTrace` | ❌ | no trace plumbing (low value) |
| `$/progress` | ✅ | sent to report the eager-crawl work-done progress |

### 2. Document synchronization

| Method | Status | Notes |
|---|---|---|
| `textDocument/didOpen` | ✅ | |
| `textDocument/didChange` | ✅ | **Incremental** sync |
| `textDocument/didClose` | ✅ | leaves the on-disk copy indexed |
| `textDocument/willSave` · `willSaveWaitUntil` | ➖ | no pre-save edits |
| `textDocument/didSave` | ✅ | re-validates on save (fallback for clients without watch events) |
| `notebookDocument/didOpen` · `didChange` · `didSave` · `didClose` | ➖ | PLC projects have no notebooks |

### 3. Language features — navigation

| Method | Status | Notes |
|---|---|---|
| `textDocument/declaration` | ➖ | IEC has no declaration/definition split; `definition` covers it |
| `textDocument/definition` | ✅ | + VG bodies |
| `textDocument/typeDefinition` | ✅ | |
| `textDocument/implementation` | ✅ | interface → implementers |
| `textDocument/references` | ✅ | symbol-identity narrowed |

### 4. Language features — hierarchies

| Method | Status | Notes |
|---|---|---|
| `textDocument/prepareCallHierarchy` | ✅ | |
| `callHierarchy/incomingCalls` | ✅ | type-aware (resolves the exact callee symbol) |
| `callHierarchy/outgoingCalls` | ✅ | |
| `textDocument/prepareTypeHierarchy` | ✅ | |
| `typeHierarchy/supertypes` | ✅ | EXTENDS + IMPLEMENTS |
| `typeHierarchy/subtypes` | ✅ | workspace-wide |

### 5. Language features — document analysis

| Method | Status | Notes |
|---|---|---|
| `textDocument/hover` | ✅ | + VG wire types + pragma hover |
| `textDocument/documentHighlight` | ✅ | |
| `textDocument/documentSymbol` | ✅ | + VG outline |
| `textDocument/documentLink` · `documentLink/resolve` | ➖ | ST has no link/URL/include syntax |
| `textDocument/moniker` | ➖ | cross-repo indexing; out of scope |
| `textDocument/foldingRange` | ✅ | |
| `textDocument/selectionRange` | ✅ | |
| `textDocument/linkedEditingRange` | ❌ | rename-as-you-type; low priority |

### 6. Language features — code analysis

| Method | Status | Notes |
|---|---|---|
| `textDocument/semanticTokens/full` | ✅ | |
| `textDocument/semanticTokens/full/delta` | ✅ | prefix/suffix diff vs a per-URI cached result id |
| `textDocument/semanticTokens/range` | ✅ | viewport-only via shared `tokenRecords` |
| `textDocument/inlineValue` | ➖ | debug-adapter feature; no live values |
| `textDocument/inlayHint` | ✅ | |
| `inlayHint/resolve` | ➖ | hints returned fully resolved |
| `textDocument/codeLens` | ✅ | |
| `codeLens/resolve` | ➖ | lenses returned resolved |

### 7. Language features — diagnostics

| Method | Status | Notes |
|---|---|---|
| `textDocument/publishDiagnostics` | ✅ | **push**, on open/change and after a re-index |
| `textDocument/diagnostic` (pull) | ✅ | shares `documentDiagnostics()` with the push channel |
| `workspace/diagnostic` (pull) | ✅ | **project-wide** pull over the eager index |

### 8. Language features — completion & signature

| Method | Status | Notes |
|---|---|---|
| `textDocument/completion` | ✅ | trigger `.` |
| `completionItem/resolve` | ➖ | items returned fully resolved (no lazy docs) |
| `textDocument/signatureHelp` | ✅ | triggers `(` `,`; inherited-parameter aware |

### 9. Language features — editing actions

| Method | Status | Notes |
|---|---|---|
| `textDocument/codeAction` | ✅ | |
| `codeAction/resolve` | ➖ | actions returned resolved |
| `textDocument/formatting` | ✅ | |
| `textDocument/rangeFormatting` | ✅ | |
| `textDocument/onTypeFormatting` | ❌ | format-on-type; low priority |
| `textDocument/rename` | ✅ | |
| `textDocument/prepareRename` | ✅ | |

### 10. Language features — colors

| Method | Status | Notes |
|---|---|---|
| `textDocument/documentColor` · `colorPresentation` | ➖ | no color literals in ST |

### 11. Workspace features

| Method | Status | Notes |
|---|---|---|
| `workspace/symbol` | ✅ | project-wide over the eager index |
| `workspaceSymbol/resolve` | ➖ | symbols returned with their location |
| `workspace/didChangeWatchedFiles` | ✅ | dynamic registration; drives freshness after `volt pull` |
| `workspace/configuration` | ✅ | pulls the `volt` section on a config change |
| `workspace/didChangeConfiguration` | ✅ | live `diagnoseDeadCode` toggle + re-publish |
| `workspace/workspaceFolders` · `didChangeWorkspaceFolders` | ➖ | single-root (`rootUri`) by design |
| `workspace/willCreateFiles` … `didDeleteFiles` (6) | ➖ | file lifecycle handled via watched files; no cross-file rename-refactor |
| `workspace/executeCommand` | ➖ | code lenses are display-only (empty command); code actions return edits directly — nothing to execute |
| `workspace/applyEdit` | ➖ | server→client; edits are returned inline from rename/codeAction |
| `workspace/semanticTokens/refresh` | ✅ | sent from `reindex()` (client-capability-guarded) |
| `workspace/inlayHint/refresh` | ✅ | sent from `reindex()` |
| `workspace/codeLens/refresh` | ✅ | sent from `reindex()` |
| `workspace/diagnostic/refresh` | ✅ | sent from `reindex()` so pull-mode clients re-pull |
| `workspace/inlineValue/refresh` | ➖ | `inlineValue` is out of scope |

### 12. Window features

| Method | Status | Notes |
|---|---|---|
| `window/showMessage` · `showMessageRequest` · `logMessage` | ➖ | headless agent surface; no user dialogs |
| `window/showDocument` | ➖ | |
| `window/workDoneProgress/create` + `$/progress` | ✅ | brackets the eager crawl (client-guarded) |
| `telemetry/event` | ➖ | |

## Scorecard

- **Implemented (✅): 33** methods — full navigation, both hierarchies, workspace symbol, completion,
  signature help, hover/highlight/symbols, folding/selection, semantic tokens (full), inlay hints, code lens,
  code actions, formatting (doc + range), rename (+ prepare), push diagnostics, incremental sync, watched-file
  freshness, and the four lifecycle messages.
- **Gaps (❌): 15** — tiered in `tasks.md` (pull diagnostics ×2, refresh ×3, semantic-token range/delta ×2,
  didSave, live config ×2, progress, on-type formatting, linked editing, executeCommand, setTrace/logTrace).
- **Out of scope (➖): the remainder** — notebooks, colors, document links, monikers, inline values, file-op
  events, multi-root, window messaging, and the `*/resolve` requests (we return fully-resolved items).

## Decisions

- **Capability↔handler parity is the enforceable invariant.** The audit's durable value is preventing a
  built-but-unwired feature (the hierarchy bug). A server test asserts every advertised provider has a
  handler and vice-versa; the matrix's ✅/➖ sets are the reference.
- **Resolve requests stay out of scope by construction.** We return fully-resolved completion items, code
  lenses, code actions, inlay hints, and workspace symbols, so `*/resolve` adds nothing — recorded as ➖, not
  a gap, so no one "implements" a no-op.
- **Refresh + pull diagnostics are the top backlog tier** because they are what the *agent* feels: after a
  `volt pull` re-index, stale tokens/hints and the lack of a project-wide error pull are the real coverage
  holes, above editor-only niceties.

## Risks / Trade-offs

- **The matrix drifts if not maintained.** Mitigated: the parity test fails when a capability is added without
  a handler, and this change stays active as the checklist; closing a gap ticks its task and flips its ✅.
- **"Out of scope" can hide a real need.** Each ➖ carries a reason; if the product changes (e.g. multi-root
  workspaces, a debug adapter), the corresponding rows move to ❌ and into the backlog.
