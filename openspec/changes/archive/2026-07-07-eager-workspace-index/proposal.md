## Why

The ST language server's binder is fully cross-file — `buildSymbolTable(files)` builds one project scope over every file and `linkExtends` resolves bases across files — and spec requirement **B2** (`openspec/specs/st-language-server/spec.md`) states "a type declared in an unopened file resolves." But that requirement is only met by the binder and the corpus tests (which load every file from disk). The **live server** ingests only OPEN documents: `rebuild()` maps `[...docs.values()]` into `buildSymbolTable`, with no filesystem crawl of source files. An AI agent that opens only the file it is editing therefore gets false `Identifier 'X' not defined` diagnostics for types declared in sibling files it never opened — this actually happened (a PackML session drowned in false positives, which then masked a real syntax error). Separately, the one eager crawl that does exist — `.library`/`.device`/`.task` reference names via `loadWorkspaceRefs`/`loadTaskRoots` — runs once at `initialize` and is never refreshed (no `workspace/didChangeWatchedFiles`, no watcher), so after a `volt pull` the index is stale until files are reopened. Eager whole-project indexing plus file watching is standard LSP behavior (rust-analyzer, gopls, tsserver, clangd); open-docs-only analysis is the exception.

## What Changes

- On `initialize` (when a workspace root is present), crawl the workspace for kind-named source files (`.fb`/`.prg`/`.fun`/`.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`) and seed the project symbol table from disk — not just from open documents.
- Establish **open-buffer-wins** precedence: for any URI that is an open `TextDocument`, the live buffer overrides its on-disk version in the project scope (an unsaved edit still drives analysis).
- Register a `workspace/didChangeWatchedFiles` handler and declare the capability, so create / change / delete of source and reference files re-indexes incrementally and invalidates the cached project scope.
- Re-run the `.library`/`.device`/`.task` reference-name crawl on those watched-file events, not only at `initialize`, so library/device/task changes are picked up without a restart.
- Preserve existing guarantees unchanged: incremental `textDocumentSync`, conservative-skip parsing, and the zero-false-positive invariant (**V3**) on valid real code.

Non-goals (separate discovered gaps, tracked elsewhere, out of scope here): a `workspaceSymbol` provider; the missing call-argument-signature diagnostic (requirement **C3**); wiring the already-built call/type hierarchy providers.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `st-language-server`: strengthen requirement **B2** so cross-file resolution holds for the **running server** (not only the binder and corpus tests) via an eager on-disk source index, and add a requirement that the workspace index stays **fresh** — re-indexed on `workspace/didChangeWatchedFiles` with open buffers taking precedence over disk.

## Impact

- **Code:** `packages/volt-lsp-iec/src/server/server.ts` (initialize capabilities, `rebuild()`/`project()` source set, watched-files handler, invalidation), `src/workspace-refs.ts` (reuse the file crawl; make the reference crawl re-runnable), and a new source-crawl module. No change to `src/symbols/binder.ts` (already cross-file) or the diagnostics engine.
- **Protocol:** adds `workspace.didChangeWatchedFiles` dynamic/static registration; adds the file-watcher glob for kind-named + reference extensions. No breaking change to existing capabilities.
- **Performance:** one workspace crawl at init and incremental re-index on file events; bounded by project size (the corpus already exercises full-project loads).
- **Consumers:** the opencode/desktop LSP clients and `volt-vscode` — both already register the ST extensions; they must forward file-watch events (the extension glob) for freshness to engage.
- **Spec:** satisfies `st-language-server` B2 for the live server; relates to the active `build-st-language-server` change (its binder/corpus work is the foundation this builds the runtime layer on).
