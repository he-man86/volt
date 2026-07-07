## 1. R2 — Extract the WorkspaceStore (refactor, behavior-preserving)

- [x] 1.1 Create `src/server/workspace-store.ts` and move the document/project state out of `runServer`'s closure (`server.ts:119-155`): the open-doc map, `project()`/`rebuild()`, `workspace()`, `invalidate()`, and the `workspaceRefs`/`taskRoots` state.
- [x] 1.2 Give the store a per-document parse cache keyed by `(uri, version)`, so `rebuild()` and `toDoc()` stop re-parsing the same text twice per request (`server.ts:132-138` vs `353-356`). One parse per document version, shared by symbol-table build and every query.
- [x] 1.3 Reduce `server.ts` to pure protocol dispatch that delegates to the store. No behavior change — the existing 66-test suite + corpus ratchet are the guardrail.

## 2. Disk source layer + open-buffer-wins merge

- [x] 2.1 Add a disk-source layer to the store keyed by normalized URI, holding parsed `Document`s from disk (separate from the open-doc layer).
- [x] 2.2 Build the project symbol table from the merged set `diskSources ⊕ openDocs`, where an open document for a URI overrides its disk entry (open buffer wins).
- [x] 2.3 On `didClose`, remove only the open-layer entry (leave the disk entry intact) so a closed file stays in the index.

## 3. Eager crawl on initialized (post-handshake)

- [x] 3.1 Extend `workspace-refs.ts` `walkFiles` to also enumerate kind-named source files (`.fb`/`.prg`/`.fun`/`.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`) in the SAME directory walk (one crawl, not two).
- [x] 3.2 Run the source crawl in the `initialized` handler (NOT inside `initialize`, so the capabilities response stays instant), seed the store's disk layer, `invalidate()`, then re-publish diagnostics for already-open documents once the index warms.
- [x] 3.3 No-op (open-docs-only, today's behavior) when the client sends no root; behaves as today until the crawl completes.
- [x] 3.4 Add `shutdown`/`exit` handlers (absent today) so the server is protocol-conformant.

## 4. Freshness via workspace/didChangeWatchedFiles

- [x] 4.1 Add an `initialized` notification handler (absent today) and, when the client advertises `workspace.didChangeWatchedFiles.dynamicRegistration`, send `client/registerCapability` with a `FileSystemWatcher` glob for source + reference extensions (`.fb`/`.prg`/`.fun`/`.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`, `.library`/`.device`/`.task`; WatchKind Create|Change|Delete).
- [x] 4.2 Handle `workspace/didChangeWatchedFiles`: `FileEvent` Created/Changed → (re)parse into the disk layer; Deleted → drop from it; then `invalidate()`.
- [x] 4.3 Make `loadWorkspaceRefs`/`loadTaskRoots` re-runnable and refresh them on watched-file events (not only at `initialize`), storing results in the store.

## 5. Client watch registration

- [x] 5.1 `volt-vscode` now watches source + reference extensions (`packages/volt-vscode/src/lsp.ts` glob extended with `library,device,task`). The opencode/desktop LSP client is opencode-owned (not a fork seam) — the server registers the watcher dynamically when the client advertises `didChangeWatchedFiles.dynamicRegistration`, and otherwise degrades to fresh-at-init (which already fixes the PackML false-positive flood). No opencode source change needed.

## 6. Tests

- [x] 6.1 Server-level test: open ONLY a `.prg` referencing a type declared in an unopened sibling `.enum`; assert the type resolves and no `not defined` diagnostic (reproduces the PackML false-positive, now green).
- [x] 6.2 Open-buffer-wins test: a file open with unsaved edits differing from disk drives analysis from the buffer, not disk.
- [x] 6.3 Re-index-on-add test: deliver a `didChangeWatchedFiles` create for a new `.struct`; references to the new type resolve without opening it.
- [x] 6.4 Re-index-on-delete test: deliver a delete event; the removed type's references become unresolved.
- [x] 6.5 Closed-file-stays-indexed test: open then close a declaring file; its types remain resolvable from disk.
- [x] 6.6 Duplicate-file test: a file present on disk AND open contributes its symbols ONCE (no double declaration, definition resolves to a single location).
- [x] 6.7 Parse-cache test: a query after an edit reparses the changed doc once, not per-consumer (assert via a spy/counter, or by identity of the cached parseResult).
- [x] 6.8 Corpus ratchet: parse-clean / ingest / per-corpus diagnostic floors unchanged (zero-FP, spec V3) with the eager index active.

## 7. Docs

- [x] 7.1 Update `packages/volt-lsp-iec/README.md`: the server eagerly indexes the workspace and refreshes on watched-file changes (open buffers win).
