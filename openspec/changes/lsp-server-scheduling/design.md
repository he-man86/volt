## Design (0.2)

**Target** (0.1 bench): 10 idle workspace pulls ≈ one pass (9 `unchanged`); a save re-parses exactly 1 file; progress
`begin` before `end`; no stale or blank diagnostics after a throw. Handlers stay synchronous (arrival-order correctness).

**DiagnosticsPublisher** (`src/server/diagnostics-publisher.ts`) — the ONE owner of push vs pull, the `indexed` gate
and the manifest warnings. The four copies of the gate today (`state.pushDiagnostics`, `state.pushManifestDiagnostics`,
the close handler in `documents.ts`, both pull handlers in `diagnostics.ts`) go; those callers call the publisher.
- `WorkspaceStore.generation`: bumped by every mutation that changes what analysis sees (merged sources, refs, config,
  task roots). A mutation that leaves the merged source unchanged does not bump it: opening a file whose buffer equals its
  disk copy, closing an unedited buffer, a watched event with the same bytes. VS Code opens files constantly.
- Per URI a cache `{ generation, resultId, items }`. A pull at an unchanged generation reuses it (no compute). After a
  change the pulled document is recomputed, with `resultId` = sha1 (`node:crypto`) of the serialized items, and the answer
  is `Unchanged` when that equals the client's `previousResultId(s)`. An edit then re-sends only the documents whose
  findings moved, and only the documents actually pulled are computed (a document pull computes one).
  Rejected: `resultId = generation` (any keystroke re-sends all ~7.7k reports). Rejected: per-file dependency tracking
  (there is no dependency graph; relink and dead code reach across files). The target is a pass per CHANGE, not per pull.
- Before the crawl the publisher answers `Full []` with NO resultId and caches nothing, so the post-crawl refresh recomputes.
- Versions: a workspace report and a `publishDiagnostics` carry the open buffer's version, and `null` for a disk-only
  file. A document pull report has no version field in LSP 3.17.
- No server debounce. The client already paces pulls and batches watched events, and an idle re-pull now costs almost
  nothing. Rejected: a timer debounce (it puts async state into synchronous handlers and adds latency to every edit).

**Incremental disk sync** — `WorkspaceStore.upsertDisk(uri, source)` / `deleteDisk(uri)`: one parse plus the existing
`rebindKey`. If the source equals the stored disk entry, nothing is parsed and the generation is not bumped.
- A file is deleted only on a FACT: the event's kind is Deleted, or a `stat` answers ENOENT. Any other read failure
  (EBUSY/EPERM while the CLI or the IDE is still writing — common on Windows) KEEPS the previous entry, logs the URI
  and the error code to `window/logMessage`, and re-reads that one file on the next watched notification of any file
  (a per-store "unread" set, drained at the start of every batch). Rejected: "unreadable counts as deleted" (a guess:
  the file would leave the project until it changed again, and every caller would show a false unresolved error that
  the wholesale re-walk used to heal on the next event).
- Reference files (`.library`, `.projectsettings`, `.task`, `.device`) go through a new `scanWorkspaceRefs(root)` in
  `workspace-refs.ts`: one walk that reads only the reference files and no source. It returns the WHOLE reference
  state — `{ refs, taskRoots, projectDiagnostics }`, as `scanWorkspace` does today — and `store.setRefs(refs,
  taskRoots)` applies refs AND task roots in one mutation before it drops the project scope and the dead caches (the
  rebuild binds from the cached parses, nothing is re-parsed), so a `.task` edit recomputes the dead set from the NEW
  roots; `projectDiagnostics` re-resolves the config on every refs scan (not only on a `.projectsettings` event — a
  folder event can carry one). Rejected: applying `refs` alone (`WorkspaceRefs` has no task roots; today `reindex`
  sets `store.taskRoots` beside it, and a literal `setRefs(refs)` would rebuild the dead caches from the old roots).
- Directories: a host may report a folder delete or create as ONE event for the folder, and the `**/*<ext>` globs never
  match a folder. So `initialized` registers one more watcher, `**/*` with kind Create|Delete. A delete of an unknown
  key drops every disk entry UNDER that folder: the key is normalized like `normalizeKey` (`fileURLToPath`, lowercased
  on a case-insensitive file system) and matched as `key + path.sep` — never a bare prefix, which would also drop the
  sibling `POUs/MotorControl/…` of a deleted `POUs/Motor`. A created directory scans its subtree's sources, and those
  go through `upsertDisk`. EVERY directory event (create or delete) also re-runs `scanWorkspaceRefs`, since the folder
  may hold — or have held — a `.library`, `.device`, `.task` or `.projectsettings` that no per-file event names.
  Rejected: re-scanning refs only when the subtree holds a reference extension (a deleted folder's subtree can no
  longer be listed; the refs walk reads only reference files and is cheap). Other paths are dropped by extension.
- One `didChangeWatchedFiles` notification sends ONE set of refreshes (tokens, hints, lenses, diagnostics), as the old
  `reindex` did. In PUSH mode (no `textDocument.diagnostic` capability) the diagnostics refresh request does not exist,
  so the publisher instead RE-PUSHES every open URI and the manifest set after any disk or refs mutation, skipping a
  URI whose computed `resultId` equals the one it last published (no duplicate publish). The same re-push of the
  OTHER open URIs follows a `didChange` in push mode: a change to A can move the findings of an open B (today only
  the changed URI is re-pushed, so B stays stale until it is itself edited).
- The wholesale `seedDisk` stays as the crawl at `initialized`. The 3.1 bench counts parses at both entry points
  (`seedDisk` and `upsertDisk`); today it wraps `seedDisk` only.
- Rejected: keeping the wholesale `reindex` per event (0.1: 7759 files re-parsed and ~2.1 s blocked per Ctrl+S).

**Cancellation** — `createProtocolConnection(…, { connectionStrategy: { cancelUndispatched } })` answers
`RequestCancelled` (-32800) for a request still in jsonrpc's queue. In vscode-jsonrpc 9.0.2 a `$/cancelRequest` is
handled in the reader callback, and dispatch runs on `setImmediate`, so a cancel read while a synchronous handler runs
reaches the requests queued behind it. Same-URI coalescing comes from the client, which cancels a superseded pull; the
strategy makes that cancel free.
- Rejected: a `MessageStrategy` queue that drops or reorders requests (it breaks arrival order).
- Refused for now: a yielding (chunked) workspace pass. A hover after an EDIT still waits one pass; revisit only if 3.1
  measures it.

**Progress** — `crawlWithProgress` awaits `window/workDoneProgress/create`, then sends `begin`, crawls, and sends `end`.
If the create fails, it crawls with no progress. A client with no progress support gets the synchronous crawl as today.
- The create is BOUNDED: if no answer arrives within 2 s, the crawl runs with no progress (logged by name), and a
  late answer is ignored (no `begin` after the crawl). A client that advertises `window.workDoneProgress` and never
  answers would otherwise leave `indexed` false and every pull answering `Full []` for good — diagnostics silently
  lost. Rejected: an unbounded await (every wait has a timeout).
- The cost is one create round trip in which queued messages run before the crawl. Diagnostics are gated (above), and
  tokens, hints and lenses get the post-crawl refresh. Only a hover or definition sent inside that window answers against
  the open buffers alone. This is a bounded staleness that heals; it is not a false error.
- Rejected: `begin` before the create is answered (the client does not know the token yet; that is today's M2).
- Rejected: crawling inside `initialize` on the client's `workDoneToken` (the handshake would wait 2–3 s, and only
  clients that send a token would get progress).
- Rejected: dropping progress (the crawl takes 2–3 s and the user sees it).

**Error isolation** — `ProtocolConnection` has no `console`. A small `Logger` sends `window/logMessage` and is passed to
`createProtocolConnection` in place of the default `NullLogger`. jsonrpc's own "handler failed" reports land there too;
today a throwing NOTIFICATION handler fails silently.
- Quarantine: when parsing or binding one document throws (`openParse`, `upsertDisk`, `rebindKey`, `seedDisk`), the
  store logs the URI and stack, drops the project scope, and leaves that document out of the merged set until its
  content changes. The next `project()` rebuilds without it, so one bad file never wedges every later request. The
  document is refused by name in the log; no parse is guessed for it.
- The quarantined document's OWN report (pull and push alike) is not empty: one error diagnostic on line 0, code
  `not-analysed`, saying the server failed reading this file and names the log — never `Full []`, which would show a
  clean file the server could not read. Its declarations are out of the project scope, so files that use them get
  unresolved findings CODESYS does not give; those are ACCEPTED (not quieted): they are true of what the server could
  read, the named error on the quarantined file explains them, and a throw is a server bug fixed at its root, not an
  input condition to mask. Rejected: quieting every finding that might depend on it (there is no dependency graph —
  see the publisher — so "might depend" is every unresolved name in the workspace). Rejected: keeping the last good
  parse (a stale answer presented as current).
- 1.3 makes a parse throw with `mock.module` on the syntax index, not with a test seam in the store.

**Domain findings to `analysis/`** — the composition in `documentDiagnostics` (library gate, dead/quiet filter, network
pass) moves to `analysis/pipeline/document.ts` `documentFindings` and returns `DiagnosticItem[]`.
- Layering: `workspace` ranks ABOVE `analysis`, so `documentFindings` cannot take the store. It takes
  `{ doc, project, config, dead, deadMembers, manifests }`, and the publisher reads those from the store.
- Missing language and unstated bodies go to `analysis/checks/syntax/missing-language.ts`. Like `checks/network`, this
  is outside the registry, because it quiets other findings inside its bodies.
- The manifest warnings go to `analysis/checks/workspace/materialization.ts`. They are keyed by manifest path, and the
  server makes the URI.
- The message texts go to `analysis/messages` (`syntax.ts`; a new `workspace.ts`) and stay byte-identical. Conformance
  must not move.
- Wire: the missing-language finding gets the slug `missing-language` inside analysis. `toLspDiagnostic` OMITS its
  `code`, so the wire is unchanged: `test/corpus/support/diagnostic-codes.ts` documents that this finding has no code,
  and `KNOWN_UNMAPPED` only shrinks.
- The missing-language finding keeps today's composition, which is NOT the common path: it is gated by the library
  gate and by `materializationMismatch` only; it is NOT dead-gated (a dead POU or a dead member with an unstated body
  still gets it — the push refuses that file whether or not anything calls it) and it is appended AFTER `quiet()`
  (its range lies inside the unstated body, so `inUnstated` would swallow it). Pinned before the move by colocated
  tests in `src/server/document-diagnostics.test.ts` (gate 0b), which travel with it in 2.4.
- The server keeps `toLspDiagnostic` only (layer G = the LSP adapter). The ownership-map row "Document → LSP
  diagnostics" moves with it.

**Lifecycle** — `ServerState.onRequest`, one registration helper every handler group uses, answers -32002
(`ServerNotInitialized`) to any request before `initialize` and `InvalidRequest` after `shutdown`. Notifications before
`initialize` are dropped, except `exit`.
- `exit` exits with code 0 after `shutdown` and 1 otherwise.
- `conn.onClose` exits; nothing does this today. Without it, the fallback watcher below is a handle that keeps an
  orphaned server alive.
- A `processId` watchdog: an unref'd 3 s `process.kill(pid, 0)` probe. ESRCH means the parent is gone, so exit 1;
  EPERM means it is alive. This matters because of the LSP-zombie history.
- Exit seam: every process exit (the `exit` notification, `conn.onClose`, the watchdog) goes through an
  `exit: (code: 0 | 1) => void` that `runServer` takes as a parameter. `bin.ts` passes `process.exit`; the in-process
  callers (`test/lsp/harness.ts`, `server.test.ts`, `state.test.ts`, `scripts/bench-server.ts`) pass a recorder, so a
  test that ends the streams or sends `exit` does not end `bun test` mid-suite, and 1.3 asserts the exit code
  in-process. Rejected: `process.exit` inside the server (kills the runner; later files silently do not run).
  Rejected: a subprocess-only exit test (slower, and every other in-process test would still be one `onClose` away
  from killing the runner).
- Workspace folders stay fixed at `initialize` (no `workspace/didChangeWorkspaceFolders`). This is documented in layer
  G (3.1), not changed.

**Watcher fallback** — a client without dynamic `didChangeWatchedFiles` gets a recursive `fs.watch` on the root that
feeds the same upsert, delete and directory path.
- `.git` and unscanned extensions are skipped.
- `rename` is decided by a `stat`.
- Unlike a client, `fs.watch` fires several times per save, so its events are coalesced per macrotask (one flush, one
  refresh set). This async state lives outside the protocol handlers. Equal bytes are free (`upsertDisk` short-circuit).
- Rejected: documenting the gap (after a pull from the IDE, such a host would stay stale).

**Migration** — red tests (1.x) first. Then the publisher (2.1), disk sync (2.2), cancellation, progress, logger,
quarantine and lifecycle (2.3), the move (2.4: no message-text changes, conformance byte-identical) and the watcher
(2.5). Then the bench again (3.1).

## Red tests (step 1)

**Target:** every 1.1–1.3 behaviour (gate 0b additions included) is a committed test that fails today for the reason it
names, and flips by itself when 2.x builds it — while the suite and typecheck stay green between steps.

**How a red test sits in the suite: `test.failing`** (bun 1.4.2, measured: a `.failing` test that passes FAILS with
"remove `.failing`"). That is the known-divergence rule: the step that builds the behaviour must drop the mark.
Rejected: plain red tests (every gate between 1 and 2.x fails, and a real regression hides among them). Rejected:
`test.todo` (silent when it starts passing; no mark is ever removed).

**Where:** through the protocol, in `test/lsp/` — named by question: `diagnostics-pull.test.ts` (1.1),
`disk-sync.test.ts` (1.2), `server-robustness.test.ts` (1.3). Not colocated: the files they will test
(`diagnostics-publisher.ts`, `upsertDisk`) do not exist, and a test against a missing symbol breaks typecheck. A
`.failing` test that does not compile is not red, it is broken. The colocated tests come with the code in 2.x.

**Harness** (`test/lsp/harness.ts`, extended, no product change): an optional temp-dir `root` (`rootUri`, so the crawl
and the watchers run), `watched(changes)`, `workspacePull(previousResultIds)` returning kinds/resultIds/versions,
captured `window/logMessage`, a progress-create handler that answers, refuses, or never answers, and the order of
`$/progress` kinds. The bench's client (`scripts/bench-server.ts`) is the model; the shared steps move to `sources.ts`.

**Observing work** (what decides "never computed" / "re-parses one"): a delegating `mock.module` of
`src/frontend/syntax/index.js` counts `parseDocument` per URI and throws for one sentinel URI (`quarantine.st`) — the
design's 1.3 throw. The same mock answers both questions, so there is one mock, delegating for every other URI (bun's
`mock.module` is process-wide; a pass-through cannot disturb another file). EBUSY: a delegating mock of the read in
`workspace-refs.ts` that throws `EBUSY` for one sentinel path. Rejected: a counter or a throw seam in `WorkspaceStore`
(product code that exists for tests). Rejected: wall-clock thresholds for "≈ one pass" (the bench measures time; the
tests count computes and `unchanged` answers).

**Cancellation (1.3):** pull A, pull B, `$/cancelRequest` B written in one burst; B must answer -32800 and the parse
counter / a compute count shows B was never computed.

**Refused by name:** the `exit`-notification test (exit code via the seam) is NOT written in step 1 — today
`lifecycle.ts:84` calls `process.exit(0)`, so a red version ends `bun test` mid-run and later files silently do not run.
It lands first in 2.3, in the same commit as the `exit` seam, before the seam's code. The `onClose` and watchdog
(dead `processId`) tests are written now: today nothing exits on either, so they fail safely. `harness.ts` passes the
exit recorder under one `@ts-expect-error` (runServer has no 5th parameter yet); typecheck itself fails when 2.3 adds
it, which removes the marker.

**Migration:** 1.1–1.3 commit the three suites + harness, all `.failing`, typecheck clean, targeted run shows every
one red for its named reason (a `.failing` that already passes is a wrong premise — fix the test before commit). Each
2.x step removes the marks it turns green.
