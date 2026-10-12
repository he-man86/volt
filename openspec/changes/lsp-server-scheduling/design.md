## Design (0.2)

**Target** (0.1 bench): 10 idle workspace pulls ≈ one pass (9 `unchanged`); a save re-parses exactly 1 file; progress
`begin` before `end`; no stale or blank diagnostics after a throw. Handlers stay synchronous (arrival-order correctness).

**DiagnosticsPublisher** (`src/server/diagnostics-publisher.ts`) — the ONE owner of push vs pull, the `indexed` gate
and the manifest warnings; `state.ts`, `diagnostics.ts` and `documents.ts` call it and keep no gate of their own.
- `WorkspaceStore.generation`: bumped by every mutation (open/change/close, disk upsert/delete, refs, config).
- Per URI a cache `{ generation, resultId, items }`. A pull at an unchanged generation reuses it (no compute); after a
  change it recomputes, `resultId` = a hash of the serialized items, and answers `Unchanged` when that equals the
  client's `previousResultId` — so an edit re-sends only the documents whose findings moved.
  Rejected: `resultId = generation` (any keystroke re-sends all ~7.7k reports); per-file dependency tracking (no
  dependency graph exists — relink and dead-code reach cross files; a pass per CHANGE, not per pull, is the target).
- Versions: a report/publish carries the open buffer's version, `null` for a disk-only file.
- No server debounce: the client already paces pulls and batches watched events; an idle re-pull now costs ~nothing.
  Rejected: a timer debounce (async state in synchronous handlers, latency on every edit).

**Incremental disk sync** — `WorkspaceStore.upsertDisk(uri, source)` / `deleteDisk(uri)`: one parse + the existing
`rebindKey`. Reference files (`.library`, `.projectsettings`, `.task`, `.device`) re-scan the REFS only (no source
re-parse) and drop the project scope (rebuild = bind from cached parses). A directory event deletes/scans that subtree.
Rejected: keep the wholesale `reindex` per event (0.1: 7759 re-parsed, ~2.1 s blocked per Ctrl+S).

**Cancellation** — a `ConnectionStrategy.cancelUndispatched` answering `RequestCancelled` (-32800). Same-URI
coalescing comes from the client, which cancels a superseded pull; the strategy makes that cancel cost nothing.
Rejected: a server-side `MessageStrategy` queue that drops/reorders requests (breaks arrival order). Refused for now: a
yielding (chunked) workspace pass — a hover after an EDIT still waits one pass; revisit only if 3.1 measures it.

**Progress** — `crawlWithProgress` awaits `window/workDoneProgress/create`, sends `begin`, then crawls, then `end`.
Rejected: dropping progress (the crawl is 2–3 s, user-visible).

**Error isolation** — the connection's logger becomes `conn.console` (`window/logMessage`, replacing `NullLogger`).
`rebindKey`/`upsertDisk` are transactional: a throw logs the URI + stack, drops the project scope (the next `project()`
rebuilds) and stores nothing for that file — refused by name in the log, never a guessed parse.

**Domain findings to `analysis/`** — `documentDiagnostics`' composition (library gate, dead/quiet filter, network pass)
moves to `analysis/pipeline/document.ts` returning `DiagnosticItem[]`; missing language/unstated bodies to
`analysis/checks/syntax/missing-language.ts`; the manifest warnings to `analysis/checks/workspace/materialization.ts`.
The server keeps `toLspDiagnostic` only (layer G = the LSP adapter).

**Lifecycle** — -32002 before `initialize`; `InvalidRequest` after `shutdown`; `exit` code 0 after shutdown else 1; a
`processId` watchdog (unref'd 3 s `process.kill(pid, 0)` probe → exit 1) besides stdin close (LSP-zombie history).
**Watcher fallback** — a client without dynamic `didChangeWatchedFiles` gets a recursive `fs.watch` on the root feeding
the same upsert/delete path. Rejected: documenting the gap (a pull from the IDE would leave such a host stale).

**Migration** — red tests (1.x) first; then publisher (2.1) → disk sync (2.2) → cancellation/progress/logger/lifecycle
(2.3) → move (2.4, no message text changes; conformance must stay byte-identical) → watcher (2.5); bench again (3.1).
