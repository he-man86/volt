## 0. Measure and design

- [x] 0.1 Baseline with a server bench (pro2193, lenze-mid): one workspace pass, 10 idle pulls, one save (files
      re-parsed, ms blocked), time-to-first-hover during a pull. Record under this task. (Was "with the existing bench":
      that bench cannot see scheduling, so the step wrote a new one — the text now says what was done.)
      **Bench:** the existing `test/lsp/bench.test.ts` measures the store→compute path with no pipe, so it cannot see
      scheduling; `scripts/bench-server.ts` (new, measure-only) drives `runServer` over in-process pipes as a VS Code-like
      client (pull + workspace pull + refresh + dynamic watchers + progress), root = the corpus project, counting disk
      re-parses by wrapping `WorkspaceStore.prototype.seedDisk`. `bun run scripts/bench-server.ts [project…]`. Save =
      didSave + a watched-file `Changed` for the largest project POU; "blocked" = the next hover's latency.
      **Baseline 2026-10-12** (two runs, agreeing within ~5 %; second run shown):

      | measure | pro2193 (7759 files) | lenze-mid (7599 files) |
      |---|---|---|
      | crawl, `initialized` → first answer | 2242 ms, 7759 parsed | 1772 ms, 7599 parsed |
      | one workspace pass (first, cold) | 3438 ms, 7759 `full` reports | 635 ms, 7599 `full` |
      | 10 idle pulls | 23210 ms (6.8 cold passes; p50 2322 ms), 0 `unchanged` | 3773 ms (5.9; p50 380 ms), 0 `unchanged` |
      | idle busy share at VS Code's 2 s re-pull | 54 % | 16 % |
      | one save: disk entries re-parsed | 7759 (the whole workspace) | 7599 |
      | one save: loop blocked | 2098 ms | 1759 ms |
      | one save: refresh → re-pull / save → fresh | 1 refresh; 2760 ms / 4858 ms | 1 refresh; 620 ms / 2378 ms |
      | hover sent behind a workspace pull | 2362 ms (idle hover 3 ms) | 403 ms (idle hover 1 ms) |

      Findings: H1 confirmed — every idle pull is a full recompute, `version: null`, no `unchanged` ever (10 pulls ≈ 10
      warm passes, not ≈ one). H2 confirmed — one save re-parses all ~7.7k files and blocks the loop ~2 s, then the refresh
      re-pulls the workspace. A hover queued behind a pull waits the whole pass (~800× an idle hover on pro2193). M2
      confirmed — the progress `end` reaches the client BEFORE `begin` (`["end","begin"]`), so the bar never shows.
      Targets for 3.1: 10 idle pulls ≈ one pass (9 answer `unchanged`); a save re-parses 1 file.
      **Gate 0a (review fixes to the bench, 2026-10-12)** — measure-only; no product code, test or recording changed:
      - Idle pulls now send back the previous pull's resultIds in `previousResultIds`, as VS Code does. With `[]` a
        spec-conforming server must answer `full`, so `unchanged` read 0 by construction and the 3.1 target was
        unmeetable. The baseline 0 is unaffected (the server issues no resultId today), now measured, not built in.
      - The save is a REAL change: a comment line appended → didChange (buffer) → written to disk → didSave → watched
        `Changed`. Rule for 3.1: the save target is "re-parses exactly 1"; 0 means a missing upsert (a source-equality
        short-circuit cannot fire, the content differs). The project is copied to a temp dir first (the corpus is tracked).
      - Re-run after the fix: pro2193 crawl 2799 ms/7759 parsed, pass 3265 ms, 10 idle pulls 22990 ms (7.0 passes, p50
        2305 ms) 0 `unchanged`, save 7759 re-parsed/blocked 2433 ms/re-pull 2743 ms/fresh 5177 ms, hover behind pull
        2535 ms; lenze-mid 2492 ms/7599, 562 ms, 3941 ms (7.0, p50 385 ms) 0 `unchanged`, save 7599/1842/607/2449 ms,
        hover behind pull 429 ms — the baseline holds (within run noise), progress still `["end","begin"]` (M2).
      - "Failing test first" does not apply: both findings are in a measure script, not product behaviour; the check is
        the bench run above.
      - Gate: typecheck clean; full suite `VOLT_REQUIRE_FULL=1 bun test` (VOLT_FIXTURES unset) 9591 pass, 35 skip,
        421 todo, 0 fail — 10047 tests across 347 files, 798 s. No fixture or transpiler change, so no map regeneration.
- [x] 0.2 design.md: the `DiagnosticsPublisher` (channels, gate, generations/resultIds, versions, debounce), incremental
      disk sync, cancellation strategy, progress, error isolation, where the moved findings live in `analysis/`; each
      choice with the alternative it beat.
      **Gate 0b (review fixes to the design, 2026-10-12)** — all nine findings checked against the code and accepted;
      design.md changed for each, none skipped:
      1. Folder delete matches `normalizeKey(folder) + path.sep`, never a bare prefix (`POUs/Motor` vs `POUs/MotorControl`).
      2. Every directory event (create or delete) re-runs `scanWorkspaceRefs` (a folder can hold `.library`/`.device`/
         `.task`/`.projectsettings` that no per-file event names).
      3. A quarantined document reports one `not-analysed` error on line 0 (never `Full []`); dependents' unresolved
         findings are accepted, not quieted (no dependency graph; the named error explains them). Spec scenario amended.
      4. `window/workDoneProgress/create` is bounded (2 s): on expiry the crawl runs without progress, a late answer is
         ignored.
      5. Deleted only on a fact (Deleted event or `stat` ENOENT); EBUSY/EPERM keeps the previous entry, logs it and
         re-reads it at the next watched batch.
      6. `scanWorkspaceRefs` returns `{ refs, taskRoots, projectDiagnostics }`; `store.setRefs(refs, taskRoots)` applies
         both before the dead caches drop; the config is re-resolved on every refs scan.
      7. The missing-language composition is pinned (library + `materializationMismatch` gated; NOT dead-gated; appended
         after `quiet()`) — and covered NOW by three colocated tests in `src/server/document-diagnostics.test.ts` (dead
         POU, dead member, Library Manager file). They pass today: they pin present behaviour for 2.4, so there is no
         red phase (the regression they guard is not written yet).
      8. Push mode: after any disk/refs mutation, and after a `didChange`, the publisher re-pushes every open URI and the
         manifest set, skipping a URI whose `resultId` equals its last publish.
      9. Exit seam: `runServer` takes `exit: (code) => void`; `bin.ts` passes `process.exit`, in-process callers a recorder.
      "Failing test first" otherwise does not apply: findings 1–6, 8, 9 are about behaviour no code implements yet; their
      red tests are task 1.x's (listed there).
      Gate: typecheck clean; `openspec validate` clean; full suite `VOLT_REQUIRE_FULL=1 bun test` (VOLT_FIXTURES unset)
      9594 pass, 35 skip, 421 todo, 0 fail — 10050 tests across 347 files, 720 s (0a: 9591 pass / 10047; +3 = the pins
      of finding 7). No fixture or transpiler change, so no map regeneration.

## 1. Red tests first (test/lsp black-box + colocated)

- [x] 1.1 10 idle workspace pulls answer `Unchanged` after the first (cost ≈ one pass); a change answers `Full` for that
      document only.
      `test/lsp/diagnostics-pull.test.ts`, 5 `test.failing`, each red for its named reason (run with the marks stripped):
      no resultId on a workspace report (so no `unchanged` can follow); after an edit the untouched PB answers `full`, not
      `unchanged`; a document report has no resultId; an open buffer's report says `version: null`, not 7; a push carries
      no version (`undefined`, not 3). "Cost ≈ one pass" is counted as answers (10 × N reports, all `unchanged`), never
      as time; the bench measures the time.
- [x] 1.2 Saving one file re-parses one file (no wholesale re-scan); a reference-file change re-scans references.
      Also (gate 0b): a folder delete drops only entries under `folder + sep` (not a sibling `…Control`); a directory
      event re-scans references (a deleted folder's `.device` unbinds, a created one's `.library` binds); a read failing
      with EBUSY keeps the entry; a `.task` edit applies the new task roots; push mode re-publishes the other open URIs.
      `test/lsp/disk-sync.test.ts`, 7 `test.failing` + 4 plain pins. Red today: a watched `Changed` for FB_A.pou
      re-parses all 6 sources (target exactly `{FB_A.pou: 1}`); a folder delete re-parses 7 (target 0); a `.task` edit
      re-parses 8 (target 0); no `**/*` Create|Delete watcher is registered (only the 8 extension globs); an EBUSY read
      drops FB_A (`Unknown type: 'FB_A'` in Main); push mode — renaming FB_A in an open buffer leaves the open Main's last
      push clean (only the changed URI is re-pushed), and a watched batch that moves nothing re-pushes Main (2 pushes, not 1).
      The pins pass today because the wholesale re-crawl gets them right, and keep 2.2 from losing them: the folder delete
      drops `POUs/Motor` and keeps `POUs/MotorControl`; a deleted `Devices/` unbinds `Dev1` ("Identifier 'Dev1' not
      defined"); a created `Library Manager/` folder's manifest binds (its `library-stale` shows — the observable a
      manifest gives without a library body); a `.task` that adds P2 un-quiets P2's C0032.
- [x] 1.3 A queued cancelled pull is never computed; progress `begin` precedes `end`; a throwing parse leaves the server
      serving and logs to `window/logMessage`; lifecycle: -32002 before initialize, refusal after shutdown, exit code.
      Also (gate 0b): the throwing document reports one `not-analysed` error; a client that never answers the progress
      create still gets diagnostics (bounded create); the exit code via the `runServer` exit seam, in-process.
      `test/lsp/server-robustness.test.ts`, 8 `test.failing` + 1 plain pin. Red today: the cancelled pull is answered
      with a result (jsonrpc's default `cancelUndispatched` returns undefined), not -32800; progress arrives
      `["end","begin"]`; a REFUSED create still gets `end` on its token (`["end"]`, target none); the throwing parse makes
      the next pull of ANOTHER file fail ("Request textDocument/diagnostic failed … throws"); a hover before `initialize`
      answers -32603 (a TypeError on the unset store), not -32002; a hover after `shutdown` is answered, not -32600; a
      closed connection and a dead `processId` never reach the exit seam (2 s / 5 s bounded waits). Pin: a create nobody
      answers still lets Main's C0032 through and sends no `begin` (passes today — the crawl does not wait; it guards
      2.3's awaited, bounded create). Refused by name, as design.md says: the `exit`-notification test (today
      `process.exit(0)` would end `bun test`); it lands with the seam in 2.3.
      **Harness and probes (the tools 2.x and 3.1 use):** `test/lsp/harness.ts` — `initIn(root, caps, processId)`,
      `watched`, `workspacePull(previousResultIds)`, `pullReport(uri, previousResultId)`, `publishedVersion`, `logs`,
      `progress` (kinds in arrival order; create answered / refused / never), `registrations`, `exits`, `endInput`,
      a cancellable `request`, `CAPS.vscode` (the bench now imports it) and `CAPS.pushWatch`; the exit recorder is
      passed to `runServer` under ONE `@ts-expect-error`, which fails typecheck when 2.3 adds the parameter.
      `test/lsp/probes.ts` — the delegating parse mock (counts `parseDocument` per URI; a source containing
      `THROWS_IN_PARSE` throws — a content marker, not a sentinel URI as design.md first said, so the quarantine test
      can change the content and see the file analysed again) and the delegating `node:fs` mock (`busyRead(path)`:
      `readFileSync` of that path throws EBUSY; the read `scanWorkspace` and any 2.2 upsert do both go through it).
      Both pass every other call through; `bun test ./test/lsp ./src` with them loaded: 2566 pass, 0 fail.
      **Numbers:** 25 tests in 3 files (20 `.failing`, 5 pins), 7.6 s targeted (the two bounded exit waits are 7 s of
      it). Typecheck and lint clean.
      **Gate 1 (review fixes to the red tests, 2026-10-12)** — all nine findings applied, none skipped; no product code,
      fixture or recording changed. 15 tests added (40 in the three suites, 9.7 s targeted). New `.failing`, each red for
      its named reason with the mark stripped: 10 idle pulls compute no document (today each is computed 10 times); the
      refused-create test also requires the crawl (Main's C0032; red on `["end"]`); a crawl-time parse throw and a
      watched-upsert parse throw are quarantined (today the crawl aborts, Main has no C0032); a closed connection after
      `shutdown` exits 0 (no exit within 2 s). New plain pins (green today): a document pull computes only that document;
      a pre-crawl pull answers `Full []` with no resultId; a notification before `initialize` is dropped; disk-sync — a
      Created source, a created folder's sources, a single Deleted source, a `Changed` read failing ENOENT counted as a
      delete, a deleted file's report cleared, a `.projectsettings` change re-resolving the config (C0139), and in push
      mode the re-push after a watched batch and the manifest re-push. Probes: the compute probe (counts
      `computeDiagnostics` per URI) on the analysis barrel `analysis/index.js` — the first cut mocked
      `analysis/pipeline/diagnostics.ts` and the full suite caught it as a deep import (layering rule A2,
      `test/package/layering.test.ts`); the probe obeys the rule, the rule was not listed as a violation. Counts filter
      by folder boundary, not a bare prefix. Harness: the exit default is `noExitExpected` (an exit nobody expected
      throws, never dropped), plus `initializeIn`, `initialized`, `notify`; `CAPS` lives in `harness.ts`.
      Gate: typecheck clean; lint exit 0 (warnings only); `openspec validate` clean; full suite `VOLT_REQUIRE_FULL=1 bun
      test` (VOLT_FIXTURES unset) 9634 pass, 35 skip, 421 todo, 0 fail — 10090 tests across 350 files, 713 s. 9634 =
      gate 0b's 9594 + the 40 scheduling tests: the process-wide pass-through mocks change no other count (finding 8).
      No fixture or transpiler change, so no map regeneration.

## 2. Build

- [x] 2.1 `DiagnosticsPublisher` (new file); the four duplicated gates removed; versioned publishes.
      `src/server/diagnostics-publisher.ts` (+ colocated test, 7): per-URI findings cached at the store `generation`
      (`WorkspaceStore.generation`, bumped only when the merged text, refs, task roots or config move); resultId = sha1 of
      the serialized findings; `unchanged` against the client's id; versions on workspace reports and pushes; pre-crawl
      `full []` with no resultId; push mode publishes the named document always and re-publishes the other open documents
      and the manifests only when moved. `state.pushDiagnostics`/`pushManifestDiagnostics`, the close-handler clear and
      both pull handlers' gates are gone. Marks removed: the 6 of `diagnostics-pull.test.ts` and "push mode: an edit
      re-publishes the other open documents".
- [x] 2.2 Incremental disk sync in `WorkspaceStore` (`upsertDisk` / `deleteDisk`, per-URI rebind).
      `upsertDisk`/`deleteDisk`/`deleteDiskUnder`/`setRefs` in the store; `scanWorkspaceRefs` (+ `paths`) and
      `sourceFilesUnder` in `workspace-refs.ts`; `src/server/disk-sync.ts` (+ colocated test, 3) applies one batch (delete
      only on a fact, EBUSY kept/logged/re-read, folder boundary, refs re-scan on reference and directory events, ONE
      refresh set, none when nothing moved); the `**/*` Create|Delete watcher. `reindex` per event is deleted; `seedDisk`
      stays the crawl. The store split for the 400-line limit (`dead-code-cache.ts`, `document-key.ts`). Marks removed:
      the other 6 of `disk-sync.test.ts`. Store unit tests +4 (generation rules, a save under an open buffer, folder
      boundary, quarantine).
- [x] 2.3 Cancellation (ConnectionStrategy, same-URI coalescing), progress fix, logger, transactional rebind, lifecycle
      conformance, processId watchdog.
      `cancelUndispatched` answers -32800; a `Logger` to `window/logMessage` (jsonrpc's own reports too); progress create
      awaited and bounded (2 s), `begin` only on an accepted token; quarantine in the store (parse or bind throws → out of
      the merged set until the content changes, project rebuilt, logged by name; the file reports one `not-analysed`
      error); `ServerState.onRequest`/`onNotification` gate (-32002 before `initialize`, -32600 after `shutdown`,
      notifications dropped); `exit`, `onClose` and the 3 s `processId` watchdog end through `runServer`'s `exit` seam
      (`bin.ts` passes `process.exit`). The `exit`-notification tests (2, refused in step 1) landed with the seam; the
      harness's `@ts-expect-error` is gone. Marks removed: the 11 of `server-robustness.test.ts`.
- [x] 2.4 Domain findings moved to `analysis/` (missing language, unstated bodies, manifest warnings).
      `analysis/pipeline/document.ts` `documentFindings` (the composition; + test, 6 — the gate-0b pins moved with it),
      `checks/syntax/missing-language.ts` (+ test, 4), `checks/workspace/materialization.ts` (+ test, 3), texts in
      `messages/syntax.ts` and `messages/workspace.ts` (byte-identical). `server/document-diagnostics.ts` is the LSP
      conversion (`toLspDiagnostic`, codeless `missing-language`) and the store-reading adapter; its test keeps the wire
      (6). The compute probe moved to `documentFindings`. No mark (pins only). Conformance unchanged: `test/conformance`
      6736 pass / 378 todo / 0 fail; `test/analysis` + `test/corpus` 32 pass / 0 fail; `rate:fixtures` leaves
      `map.generated.ts` unchanged.
- [x] 2.5 Watcher fallback (`fs.watch`) for clients without dynamic registration, or the limitation documented.
      `src/server/file-watch.ts` (+ colocated test, 1: a written, saved — one refresh however often `fs.watch` fires —
      and deleted source reach the store): a recursive `fs.watch` on the root, coalesced per macrotask into one batch
      through `applyWatchedChanges`, `.git` skipped, closed when the server ends. Also started when a client advertised
      dynamic registration and refused it.
      **Gate 2 (review fixes to step 2, 2026-10-12)** — five findings checked, all accepted, none skipped; each red
      before its fix (the equivalence pin excepted: it pins today's answer). No fixture or recording changed.
      1. A watched batch relinked once PER FILE (`build.relink` ~25 ms on pro2193 — 7759 Changed events took 258 s, a
         100-file pull ~3.3 s, both worse than the 2 s re-crawl). `WorkspaceStore.diskBatch` defers the batch's keys and
         rebinds them together, ONE relink (`rebindKeys`); a multi-key mutation no longer drops the project either.
         Measured: all 7759 pro2193 sources changed in one batch 1.2 s (the re-parse; relink 83 ms). Red test: "a
         watched batch that moves several sources relinks the project once" (4 relinks → 1; the new relink counter in
         `test/lsp/probes.ts`).
      2. A reference re-scan dropped a reference file it could not read (EBUSY) and applied the rest — a disabled
         warning came back, a library unbound. `scanWorkspaceRefs`/`scanWorkspace` now name what exists and could not
         be read (`unreadable`, I/O code, ENOENT excluded); `ServerState.rescanRefs` keeps the last reference state,
         logs the file, and re-scans at the next batch (`refsUnread`); the crawl logs both kinds and re-reads an
         unreadable source at the next batch (`unread`). Red test in `disk-sync.test.ts` (C0139 came back).
      3. A BIND throw at the full build (crawl, refs change, quarantine) made every `project()` throw. `project()`
         catches it, finds the files whose bind throws in a scratch project (`project-build.ts` `bindFailures`, only
         after a failed build), quarantines them and builds again; a throw no one file causes is rethrown. The
         publisher builds the project before it asks whether a document is quarantined. Probe: `THROWS_IN_BIND`
         (`build.bindFile`, and `build.buildSymbolTable` for the same files). Red test: the crawl-time bind throw; a
         pin for the watched bind throw.
      4. A Deleted event was acted on without the disk: a case-only rename (`FB_A.pou` → `fb_a.pou`, one key on a
         case-folding FS) dropped the file when its Deleted came after the Created. A Deleted path the disk still holds
         (exact name, or the one case variant on a case-folding FS) is read as Changed under the disk's spelling; an
         upsert with equal bytes under a new spelling re-parses. Red test: both event orders (Created first was red).
      5. The equivalence gate covered open/change/close only. New pin in `workspace-store.test.ts`: CodesysTestProject
         with its manifests, devices and task roots — deletes, re-upserts, then one `diskBatch` of upserts plus a
         `Library Manager/` folder delete; project scope and dead set ≡ a freshly seeded store at each step.
      `workspace-store.ts` stays within 400 lines: the whole-project build moved to `project-build.ts`.
      **Gate 2b (second review of step 2, 2026-10-12)** — three findings checked, all accepted, none skipped; each red
      before its fix (8 tests added). No fixture, recording or transpiler change.
      1. A directory event for a folder the disk still holds (a Deleted folder present again, or one coalesced Changed)
         only upserted its sources and left phantom entries bound. `Batch.folder` now drops every entry under the folder
         the disk no longer holds (`deleteDiskUnder(uri, kept)`), keeping what the disk lists and what is under a folder
         it could not list. Red test in `disk-sync.test.ts`: Deleted+Created, Created+Deleted and one Changed (Main
         reported no `Unknown type: 'FB_A'`); store pin "a folder event keeps the entries the disk still holds".
      2. One quarantine map for both layers: a disk upsert equal to an OPEN-layer quarantine dropped the disk entry
         unquarantined, and the close cleared the rest — the file gone with no `not-analysed`. The quarantine is now per
         layer (`src/workspace/quarantine.ts`); content the other layer already quarantined is quarantined in this one
         unparsed and not reported again. The same split fixes the converse (found while fixing): a clean unsaved edit of
         a buffer over a quarantined disk file cleared the disk copy's quarantine. Red tests in
         `server-robustness.test.ts` (parse and bind; the edit-then-close case); store pin "each their own".
      3. `walkFiles` swallowed a `readdirSync`/`statSync` failure as absence. It now names any non-ENOENT failure
         (`unlisted`): a refs re-scan counts it `unreadable` (the last references stand, logged, re-scanned next batch),
         the crawl logs it once and re-reads it next batch, `sourceFilesUnder` returns it so a folder event keeps the
         entries under it, and a Deleted path whose folder cannot be listed is unreadable, not gone. Probe:
         `deniedList(path)` (`readdirSync` EPERM) in `test/lsp/probes.ts` instead of `icacls` (portable, no ACL left
         behind). Red tests in `disk-sync.test.ts`: refs re-scan (Dev1 unbound), a folder event under an unlistable
         folder (not logged), the crawl (not logged).
      Gate: typecheck clean; `bun run lint` clean; full suite `VOLT_REQUIRE_FULL=1 bun test` (VOLT_FIXTURES unset) 9673
      pass, 35 skip, 421 todo, 0 fail — 10129 tests across 356 files, 730 s. No fixture or transpiler change, so no map
      regeneration (`map.generated.ts` untouched).

## 3. Verify and close

- [x] 3.1 The bench after (same measures as 0.1); `docs/architecture.md` layer G; typecheck, lint, full suite cold green;
      archive.
      **Bench fix first (measure-only):** the first run read `0` disk parses at the crawl and at the save — the bench
      counted `seedDisk`, which a watched save no longer calls (it upserts), and timed the crawl to the first hover,
      which no longer waits for it (the crawl now runs after the awaited progress create). The counter now wraps the
      store's one parse site (`parseOrQuarantine`, disk layer) and the crawl is timed to the progress `end`.
      **After, 2026-10-12** (`bun run scripts/bench-server.ts`):

      | measure | pro2193 before → after | lenze-mid before → after |
      |---|---|---|
      | crawl (→ indexed) | 2242 ms / 7759 parsed → 2668 ms / 7759 | 1772 ms / 7599 → 2342 ms / 7599 |
      | one workspace pass (first, cold) | 3438 ms → 3126 ms, 7759 `full` | 635 ms → 633 ms, 7599 `full` |
      | 10 idle pulls | 23210 ms (6.8 passes), 0 `unchanged` → **471 ms (0.2 passes, p50 36 ms), 77590 `unchanged`** | 3773 ms, 0 → **332 ms (p50 29 ms), 75990 `unchanged`** |
      | idle busy share at a 2 s re-pull | 54 % → 2 % | 16 % → 1 % |
      | one save: disk entries re-parsed | 7759 → **1** | 7599 → **1** |
      | one save: loop blocked | 2098 ms → 27 ms | 1759 ms → 26 ms |
      | one save: re-pull / save → fresh | 2760 / 4858 ms → 2406 / 2433 ms | 620 / 2378 ms → 440 / 466 ms |
      | hover behind a workspace pull | 2362 ms → 31 ms | 403 ms → 27 ms |
      | progress | `["end","begin"]` → `["begin","end"]` | same |

      Both targets met: 10 idle pulls ≈ 0.2 of one pass, all `unchanged`; a save re-parses exactly 1. The re-pull after
      a save still recomputes every document (a generation move invalidates every cached finding — no dependency graph,
      design.md), but answers `unchanged` for every one whose findings did not move. The crawl's ~0.4 s more is the
      awaited progress create plus run noise, not parsing (same count).
      **Docs:** `docs/architecture.md` layer G (the store's per-file disk sync and quarantine, the lifecycle gate, the
      exit seam, cancellation, the `DiagnosticsPublisher`, the conversion-only `document-diagnostics`, the numbers),
      its stack and tree lines and duplication table; `docs/behavior.md` (a watched event re-indexes that file alone;
      `.projectsettings` and folders watched); `README.md` package map. `test/README.md`, `TESTING.md` and
      `scripts/README.md` were updated by steps 1–2.
      **Final review (SPEC and LAYERING lenses, the whole change):** spec — every requirement and scenario has its
      test (idle pulls `unchanged`; a save re-parses one; a cancelled pull is never computed; a throwing parse is
      logged, the server keeps serving, the project is rebuilt without it, the file reports one `not-analysed`).
      Layering — `check-layering.ts` clean; the domain composition and the manifest and missing-language texts are in
      `analysis/`; the server keeps the LSP conversion. One judgement recorded, not changed: the `not-analysed` text
      stays in `server/diagnostics-publisher.ts` — it reports the SERVER's failure to read a file (it points at the
      server's log), not a finding about the program, so it is no `analysis/messages` text. No finding to fix.
      Gate: typecheck clean; `bun run lint` exit 0 (warnings only); `openspec validate` clean; full suite COLD
      `VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1 bun test` (VOLT_FIXTURES unset) 9673 pass, 35 skip, 421 todo, 0 fail — 10129
      tests across 356 files, 1137 s (= gate 2b's counts; no test added in 3.1). No fixture or transpiler change, so no
      map regeneration.
