## Context

The binder (`src/symbols/binder.ts`) is already whole-project: `buildSymbolTable(files)` builds one project `Scope` from a file set and `linkExtends` resolves `EXTENDS` across files. The offline corpus tests exercise this by loading every project file from disk. The live server, however, only feeds it open documents: `server.ts:131-138` `rebuild()`/`project()` build the symbol table from `[...docs.values()]`, memoize it, and `invalidate()` clears the cache on every open/change/close. The only eager filesystem work is `loadWorkspaceRefs(root)` + `loadTaskRoots(root)` at `initialize` (`server.ts:192-196`), which walk the tree (`workspace-refs.ts` `walkFiles`) to collect `.library`/`.device`/`.task` reference **names** for the unresolved-identifier skip-list and dead-code seeds — never source symbols, and never re-run.

So the runtime depends on the client having the declaring files open. An agent that opens only the file it edits gets false `not defined` diagnostics for sibling types — the concrete PackML failure, where the false-positive flood also masked a real syntax error. This change moves the live server from open-docs-only to eager-index + watch, the standard LSP model (rust-analyzer/gopls/tsserver/clangd).

Sync mode is already `Incremental` and stays so; this change is purely about *which files* populate the project scope and *when* it refreshes.

## Goals / Non-Goals

**Goals:**
- The running server resolves types across files the client never opened (spec B2 for the live server).
- Open buffers win over disk for any URI the client has opened.
- The index refreshes on `workspace/didChangeWatchedFiles` (source + reference files) without a restart or a reopen.
- Zero new false positives on valid code (spec V3) and no change to the corpus ratchet floors.

**Non-Goals:**
- `workspaceSymbol` provider (separate gap).
- The missing call-argument-signature diagnostic, requirement C3 (separate gap).
- Wiring the already-built call/type hierarchy providers (separate gap).
- Multi-root workspaces / `workspaceFolders` (single root from `rootUri` is sufficient today).
- Persisting the index across sessions.

## Decisions

- **Extract a `WorkspaceStore` first (R2), behavior-preserving.** All document/project state is currently closure-local in `runServer` (`server.ts:119-155`), and `rebuild()` + `toDoc()` re-parse every document twice per request. Lift it into `src/server/workspace-store.ts` owning the open+disk layers, a per-`(uri,version)` parse cache (kills the double-parse), the memoized `project()`, and the ref-crawl state — leaving `server.ts` as pure dispatch. The eager index and watcher then attach to the store natively rather than being bolted onto the closure. This step changes no behavior and is guarded by the existing suite + corpus ratchet.
- **One merged source set feeds `buildSymbolTable`.** Introduce a disk-source layer keyed by URI. `project()` builds from `mergedDocs = diskSources ⊕ openDocs` where an open `TextDocument` for a URI replaces the disk entry (open buffer wins). Open/change/close mutate only the open layer; watched-file events mutate only the disk layer; both call the existing `invalidate()`.
- **Reuse the existing crawl.** `workspace-refs.ts` `walkFiles` already recursively enumerates the tree — extend/reuse it to also collect kind-named source paths (extension set from the registry), so there is one directory walk, not two. Parse each into the same `TextDocument` shape the binder already consumes.
- **Crawl on `initialized`, not inside `initialize`.** Parsing every source file is heavier than today's reference-name walk, so it must not block the `InitializeResult`. Do the source crawl in the `initialized` notification handler (after the handshake) and re-publish diagnostics for already-open documents once the index warms — so the capabilities response stays instant and the first open file isn't stuck with false "not defined" until the crawl finishes. Before the crawl completes the server behaves as today (open-docs-only); it never blocks. (The lightweight reference-name crawl may stay in `initialize` or move alongside — both are cheap.)
- **Lifecycle completeness.** The server currently handles no `initialized`/`shutdown`/`exit`. This change adds `initialized` (for the crawl + dynamic watch registration); add `shutdown`/`exit` at the same time so the server is protocol-conformant (shutdown → stop serving, exit → terminate).
- **Watched files, not a native watcher.** Use the LSP `workspace/didChangeWatchedFiles` notification (declare the capability + register a glob for the source + reference extensions) rather than `fs.watch`/chokidar. This is the standard mechanism, keeps the server free of a filesystem-watch dependency, and lets the editor/agent client own debouncing. On each event: created/changed → (re)parse into the disk layer; deleted → drop from the disk layer; then re-run the reference-name crawl and `invalidate()`.
- **Make the reference crawl re-runnable.** Factor `loadWorkspaceRefs`/`loadTaskRoots` so they can be invoked on watched-file events, not only at `initialize`, storing their results in mutable server state that the checks read.
- **Precedence and identity by URI.** Merge and override are keyed by normalized document URI so an open buffer and its disk file are the same entry (no duplicate symbols).

## Risks / Trade-offs

- **Crawl cost at init on large projects.** Mitigated: the corpus already loads full projects in tests; parsing is the same work done lazily today, moved to startup. If needed, the crawl can be made async/after the first `initialize` response, but start synchronous for correctness and measure.
- **Client must forward watch events.** Freshness only engages if the LSP client registers the file-watch glob. The opencode/desktop clients and `volt-vscode` already watch the ST extensions; the reference extensions (`.library`/`.device`/`.task`) may need to be added to the client glob — noted in tasks. If a client sends no events, behavior degrades to "fresh at init" (today's state for refs), never worse.
- **Duplicate-name symbols across files.** The binder already tolerates the project scope; the merge must not double-insert a URI. Covered by keying the merge on URI and by the existing duplicate-declaration check (which is per-scope and qualified_only-aware).
- **Stale open→closed transition.** When a file is closed, its disk version must remain in the index (it doesn't vanish). Ensured because close removes only the open-layer entry, leaving the disk entry intact — verified by a test.
- **Zero-FP regression risk.** The eager set could surface a resolution that changes a diagnostic. Guarded by the corpus ratchet (floors must not drop) plus a server-level test asserting no new diagnostic when a sibling file goes from open to disk-only.
