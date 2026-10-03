## 0. Design gate — do this first

- [x] 0.1 (volt, 2026-10-03: confirmed, FITS — see the proposal's assessment.) Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check the request against volt's design (`push-keeps-what-landed`: all-or-nothing, the kept state in the
      reason; `PushConflict.Code`'s "never branch on prose"; the CLI baseline for a refused op). Record FITS, or
      CONFLICTS + why + the volt-native alternative. Build only what fits.

## 1. Test red

- [x] 1.1 Engine tests over the existing `OpOutcome` cases (`CreateRollbackTests`, the `MemberRefusal` oracles):
      `UpdateKept`, `Renamed`, `Replaced` and a failed rollback each give `partiallyApplied: true`; a rolled-back
      create and a pre-flight refusal give none.
      (2026-10-04: `test/Volt.Engine.Tests/sync/PartiallyAppliedFieldsTests.cs`, 16 tests. Red with the contract
      fields present and the engine untouched: 10 failed — every "something stays" case, on the field, premises
      green — 6 passed (pre-flight, rolled-back create ×2, member refusal with nothing written, NOT_ATTEMPTED, wire
      shape). Found while writing them: the classified member refusal (`MemberRefusal`) words what landed INTO the
      exception and leaves `UpdateKept` null, so `OpOutcome` alone could not say "partially applied" for the live
      CODESYS shape of 3.1 — recorded as `OpOutcome.KeptInRefusal`.)
- [x] 1.2 A rename case asserts the new-name field. (Item rename `X.pou`→`Y.pou` and task rename
      `MainTask.task`→`SlowTask.task`: `renamedTo` is the FULL wire name.)
- [x] 1.3 (gate review of 1+2, 2026-10-04) Red tests for the five findings, in `PartiallyAppliedFieldsTests`: 8 new
      tests, 6 red on the defect (task update that landed part of its settings; create into new folders `NewF/Sub`;
      item and task rename that ran but cannot be re-found; created interface that cannot be re-found, rolled back /
      rollback failed) and 2 green guards (task update that landed nothing; a rename the IDE ignored claims nothing).
      `FakeIde` gained `HiddenItems` (exists, no tree scan returns it: the stale TwinCAT tree) and
      `TaskWriteLandsBeforeRefusal` (a non-atomic task write). Finding 5 (`remains` doc said "under Name", wrong for a
      forced replace that renames) is a doc fix with no behaviour to test: the reason already names the created name.

## 2. Build

- [x] 2.1 `PushConflict` fields; `ConflictFor` sets them from `OpOutcome`; regenerated docs.
      (2026-10-04: `partiallyApplied`/`renamedTo`/`remains`, `WhenWritingNull` — absent, never false; `reason`
      unchanged. Docs regenerated (`VOLT_WRITE_DOCS=1`); the schema generator dropped EVERY `[JsonIgnore]` property,
      so a conditional one was missing from `volt-bridge.openrpc.json` — it now drops only `Condition = Always`.
      Volt.Engine.Tests 2173 passed / 1 skipped, Volt.Contracts.Tests 39, Volt.Cli.Tests 260.)
- [x] 2.2 (gate review of 1+2, 2026-10-04) The five findings fixed:
      1. An existing task's refused `WriteTask` (neither vendor's is atomic) — `ApplySetTask` reads the task's
         descriptor before the write and again after the refusal; a difference is `UpdateKept` ("part of the settings
         of 'X' was written before it and stays (the IDE now holds: …)"), so `partiallyApplied`. A task that cannot be
         read back is not assumed unchanged: the reason says it may have changed, and the field is set.
      2. Folders a refused CREATE made — `OpOutcome.FoldersCreated`, filled by `ResolveTopLevelFolder` /
         `ResolveTaskParent` (which now takes the `created` list) as each folder is made; worded "the folder 'X' was
         created before it and stays", as a refused move's are, and `partiallyApplied`. Recorded, not rolled back —
         the move path's established answer.
      3. A native rename that ran but whose re-find missed — `outcome.Renamed` is set the moment `Rename` returns
         (item and task), withdrawn only where the case-only check shows the IDE ignored it.
      4. A created interface whose re-find missed — the re-find runs under `Rollback` now: the create is rolled back
         (or `remains`), like every other refusal of a create.
      5. `PushConflict.Remains` doc: the object stays under the name the op created it with (`toName` when present).
      Numbers (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): Volt.Engine.Tests 2181 passed / 1 skipped (+8),
      Volt.Cli.Tests 260, Volt.Contracts.Tests 39, Volt.Connector.Tests 115, Volt.Ide.Twincat.Tests 428,
      Volt.Ide.Codesys.Tests 297, Volt.Repo.Gates 108, volt-cli `bun test test/unit` 24; `bun run typecheck` and
      `bun run check` green. No fixture or transpiler change (fixture map not regenerated).

## 3. Verify

- [ ] 3.1 Live on CODESYS: a push whose single update is refused on a new member answers `partiallyApplied: true`.
- [ ] 3.2 Full C# suites and `bun run check` green.
