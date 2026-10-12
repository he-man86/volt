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

- [ ] 2.1 `DiagnosticsPublisher` (new file); the four duplicated gates removed; versioned publishes.
- [ ] 2.2 Incremental disk sync in `WorkspaceStore` (`upsertDisk` / `deleteDisk`, per-URI rebind).
- [ ] 2.3 Cancellation (ConnectionStrategy, same-URI coalescing), progress fix, logger, transactional rebind, lifecycle
      conformance, processId watchdog.
- [ ] 2.4 Domain findings moved to `analysis/` (missing language, unstated bodies, manifest warnings).
- [ ] 2.5 Watcher fallback (`fs.watch`) for clients without dynamic registration, or the limitation documented.

## 3. Verify and close

- [ ] 3.1 The bench after (same measures as 0.1); `docs/architecture.md` layer G; typecheck, lint, full suite cold green;
      archive.
