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

- [x] 3.1 Live on CODESYS: a push whose single update is refused on a new member answers `partiallyApplied: true`.
      (2026-10-04, CODESYS SP21 Patch 4, own instance `-Instance push-partially-applied-flag`, fixture copy. New e2e
      `test/e2e/endpoints/push-partially-applied.test.ts`: an update of `VltE2E_pa_upd.pou` with a new declaration and
      `METHOD Vlt__Log` answered `UNSUPPORTED` "… the declaration of 'VltE2E_pa_upd' was written before it and stays",
      `partiallyApplied: true`, no `renamedTo`/`remains`; refs and fetch confirm the IDE holds the new declaration and
      no method. Rename + refused member: `partiallyApplied: true`, `renamedTo: "VltE2E_pa_rnB.pou"`, the IDE holds
      `rnB` and not `rnA`. The "nothing stays" side pinned on the existing pushes of `push-keeps-what-landed.test.ts`:
      the rolled-back create and the pre-flight `METHOD Log` refusal carry no `partiallyApplied`/`remains`/`renamedTo`.
      **Found by the rename case's first run: every rename+edit of a POU was refused.** It answered
      `STALE_ITEM_VERSION` "'VltE2E_pa_rnB' changed in the IDE while this push was being applied" — and a rename+edit
      with no refused member answered the same, after the rename had run (and stayed). The last-moment check
      (`RequireUnchanged`) compared the client's PRE-rename version with the item after the native rename, which
      rewrites the item's own header. `FakeIde.Rename` kept the old header and so hid it. Fixed test-first: `FakeIde`
      now rewrites the renamed item's own declaration header (the measured vendor fact); `RenameBeforeWriteTests` 3 red
      (the existing `A_rename_with_a_writable_body_still_renames`, + a rename+edit with an unchanged body, + an item
      edited in the IDE meanwhile is refused BEFORE the rename) → green: `ApplySetItem` runs the last-moment check
      before the rename and passes none to the write after it. Live regression test in the same e2e file (a rename+edit
      with its version lands, the edit in the IDE). e2e 6/6 green live on CODESYS (3 new in
      `push-partially-applied.test.ts` + `push-keeps-what-landed.test.ts` 3, 4 new asserts — first recorded here as
      "7/7", a miscount: each file has 3 cases). TwinCAT was not run live at this point — see 3.3.)
- [x] 3.2 Full C# suites and `bun run check` green.
      (2026-10-04, VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset: Volt.Engine.Tests 2183 passed / 1 skipped (+2),
      Volt.Cli.Tests 260, Volt.Contracts.Tests 39, Volt.Connector.Tests 115, Volt.Ide.Twincat.Tests 428,
      Volt.Ide.Codesys.Tests 297, Volt.Repo.Gates 108, volt-cli `bun test test/unit` 24; `bun run check` 15/0 exit 0,
      `bun run typecheck` and `bun run lint` exit 0. Noticed, not this change's: `check-wiring.ts` prints its three
      DIALECT-citation checks AFTER the pass/fail summary and the exit, so they never gate — and one of them fails
      today (6 citations name a DIALECT row `D7` that does not exist; they mean `bridge-refusal-review`'s design D7).)
- [x] 3.3 (gate review of step 3, 2026-10-04) The six findings, failing test first:
      1. **A move+edit / rename+move+edit overwrote an edit made in the IDE meanwhile** (the pre-rename check was skipped
         when the op moved, and `MoveItem`'s write had no version and hashed against the destination folder).
         `RenameBeforeWriteTests`: 2 red theory rows (move+edit, rename+move+edit with a concurrent edit → accepted,
         the engineer's `y := 999;` overwritten) + 2 green guards (both shapes WITH their version land) → green:
         `ApplySetItem` runs the last-moment check once, before the rename, the move and the write, for every edit that
         also renames or moves; an edit in place keeps it in the write. Live regression: a rename+move+edit with its
         version lands (`push-partially-applied.test.ts`; move+edit alone already in `push.test.ts`).
      2. **TwinCAT not run live** — now run, unmodified: `push-partially-applied.test.ts` + `push-keeps-what-landed`
         + `push.test.ts` 16/16 on TwinCAT (Project13 copy, own instance) and 16/16 on CODESYS SP21 Patch 4. TwinCAT
         refuses `Vlt__Log` at apply (`CreateChild` "Name mismatch") after the declaration was written, and the reason
         wording, `partiallyApplied` and `renamedTo` are identical. The file header states both vendors.
      3. **The fake's rename model was unmeasured** — measured live on both vendors (new e2e "a native rename's rewrite
         of the item's own text", rename-only of a FUNCTION and an FB that name themselves in a leading comment, a body
         comment, a return assignment and a `POINTER TO` self): BOTH rewrite the header; CODESYS NOTHING else; TwinCAT
         also the item's own code references (return assignment, self-pointer); neither a comment. New DIALECT row
         **C2o**. `FakeIde.Rename` rewrites the header only (CODESYS) and, under the new `RewritesOwnReferencesOnRename`,
         the item's own code outside `//` comments (TwinCAT); two offline tests pin both shapes (the old fake failed the
         first: it renamed the leading comment and kept the header).
      4. **Contradictory reason after a rename** ("nothing of 'Y' was written" + "stays renamed") — test red, then
         `MemberRefusal` says "nothing but the rename of 'Y' was written" when a rename ran; seen live on both vendors.
      5. **3.1's count** corrected above (6/6, not 7/7).
      6. **`check-wiring.ts` citation checks never gated** — moved before the summary and the exit; `bun run check` then
         failed (17/1, exit 1) on the 6 `D7` citations, which are correct citations of `bridge-refusal-review`'s design
         D7. The scanner now skips an id that follows "openspec `<change>` [n.n,]" → 18/0, exit 0.
      Numbers (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): Volt.Engine.Tests 2190 passed / 1 skipped (+7),
      Volt.Cli.Tests 260, Volt.Contracts.Tests 39, Volt.Connector.Tests 115, Volt.Ide.Twincat.Tests 428,
      Volt.Ide.Codesys.Tests 297, Volt.Repo.Gates 108, volt-cli `bun test test/unit` 24; `bun run check` 18/0 exit 0,
      `bun run typecheck` and `bun run lint` exit 0; live e2e 16/16 on each vendor. No fixture or transpiler change
      (fixture map not regenerated).
