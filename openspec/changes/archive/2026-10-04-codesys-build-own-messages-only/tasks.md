## 0. Analyse

- [x] 0.1 Confirm or refute the reading in the proposal: `GetBuildDiagnostics` returns every category of
      `MessageStorage`, and script output/stderr is one of them. If refuted, record why here and stop.
      **Confirmed** (volt's assessment in proposal.md; measured in 1.2: script stdout and stderr are the
      "Script Messages" category of the same store).

## 1. Reproduce

- [x] 1.1 Live CODESYS fixture copy, clean project: run a script that prints a line and writes a line to stderr, then
      call `build`. Record the diagnostics and `success`. Expect the script lines among them and `success: false`.
      **Measured by PLCAssist** (live CODESYS 3.5.21.40, fixture `CodesysTestProject`, via the scripting API
      `system.get_message_categories()` + `get_message_category_description(g)` + `get_messages(category=g)`):
      script stdout and stderr lines sit in the same store the build read enumerated, so they came back as build
      diagnostics (stderr as errors, failing the build) — the proposal's field observation, reproduced.
- [x] 1.2 Record, per message, its category (name/guid) — script output, stderr, the build's own messages, and the
      messages a directed `.library` read leaves behind. Record whether the build command clears its own category
      before it runs.
      **Measured** (same session):
      - `194b48a9-ab51-43ae-b9a9-51d3edaaddf3` "Script Messages": script stdout AND stderr — also the bridge's own
        `Volt: loading …` / `Volt bridge started on pipe …` (`start_volt_codesys.py`, `PipeHost`). FOREIGN.
      - `05581bd1-66d3-4251-aff2-047cc8e9adf7` "Offline Help": "No Offline Help installed". FOREIGN.
      - `97f48d64-a2a3-4856-b640-75c046e37ea9` "Build": "------ Build started …", "Typify code...", the compile errors
        (a planted `nUndeclaredMeasure := 1;` in PLC_PRG gave "Identifier 'nUndeclaredMeasure' not defined" and
        "'…' is no valid assignment target" HERE), "Compile complete -- N errors, M warnings". **The build REPLACES
        this category's content** on each build (a second build: "The application is up to date") — so stale build
        messages are not the issue, only foreign categories are; a category filter is exact and stateless.
      - `220493a1-f49b-4416-9a3f-a545db707cbe` "Additional code checks": "Additional code checks ...",
        "… complete -- 0 errors".
      - A library reference that does not exist (`NoSuchLibraryMeasure, 9.9.9.9 (Nobody)`) wrote NO message in any
        category on build. **Corrected by volt's own probe** (`packages/volt-cli/scripts/probe-build-own-messages.py`,
        log beside it): an unresolved PLACEHOLDER (`add_placeholder("VoltMissingLib", …)`) DOES write one, an Error in
        "Library Manager" (`LibManObjectMessageCategory`, "Could not open library '#VoltMissingLib'…"), but when it is
        ADDED, not by the build: the same message object survives every later build, and the build itself answers
        "Compile complete -- 0 errors". Not a build message, so the category filter is right to leave it out (the
        IDE's own build verdict is clean too); code that uses the library fails in the compile, in "Build".
      - A library read (`fetch { init: true }`, which runs `ExtractLibrarySignatures` = an application build) leaves
        only Build / Additional code checks messages, and the next build replaces them: measured, those two categories
        hold NEW message objects after every build, every other category keeps the same ones (probe run 3).
      - Categories exist only once written: at startup only "Offline Help" is in `MessageStorage.Categories`.
      - Identity: each category object's TYPE carries `_3S.CoDeSys.Core.Components.TypeGuidAttribute`, whose `Guid`
        property is the GUID above (e.g. `_3S.CoDeSys.OnlineHelp.OfflineHelpMessageCategory` → 05581bd1…); the display
        text (`Text`) is localized, so the GUID is the key.

## 2. Test red

- [x] 2.1 A test on a `MessageStorage` double: a foreign category holding an error plus a build category holding
      only infos → `Build()` answers `true` and the diagnostics hold only the build's messages. Red before the fix.
      `CodesysBuildOwnMessagesTests`; red before the fix: `Build()` answered `false` (the two stderr errors).
- [x] 2.2 The same double with a real compile error in the build category → still `false`, error still reported.
      Red before the fix only because the foreign `Volt: loading …` line was listed too.
- [x] 2.3 An unreadable store still yields the `Unreadable` error diagnostic (guard). Kept and
      green. Added: no Build category at all → `Unreadable` naming the Build category's GUID (red before: an empty
      list and `success: true`).

## 3. Fix

- [x] 3.1 Scope `GetBuildDiagnostics` to the build's own messages (categories or "added since the build started",
      per 1.2). Diagnostic shape unchanged.
      Built as a category filter: only categories whose type's `TypeGuidAttribute.Guid` is Build or Additional code
      checks are read (`CodesysObjectModel.BuildMessages`); no Build category after a build → `Unreadable`. Tests:
      `CodesysBuildOwnMessagesTests`.

## 4. Verify

- [x] 4.1 Repeat 1.1: script lines absent, `success: true`; a planted compile error still fails the build.
      Live, own instance (`ide.ps1 -Instance codesys-build-own-messages-only`, fixture copy, probe-build-own-messages.py,
      builds over the pipe): BEFORE the fix `build` answered `success: false` with every Script Messages line (the two
      stderr lines as errors, the bridge's own start lines as infos). WITH the fix, Script Messages still holding two
      stderr errors and a placeholder library unresolved: `success: true`, only the five Build / Additional code checks
      lines. `voltProbeUndeclared := 1;` planted in PLC_PRG: `success: false`, `PLC_PRG.pou` C0046 + C0018 errors,
      named as before; restored: `success: true`.
- [x] 4.2 TwinCAT: confirm the Build-pane read does not pick up foreign output (note or test).
      It cannot fail a build: `TcObjectModel.Build` takes the verdict from `SolutionBuild.LastBuildInfo`, never from the
      list. The list reads every Output pane but parses only lines in the compiler's
      `file(line,col) : error|warning|message : text` shape; test
      `TcBuildOutputTests.ScriptOutputAndStderrInAPaneParseToNothing` (the lines PLCAssist saw, plus a Python
      traceback). No driver change.
- [x] 4.3 Full C# suites green; conformance recordings unchanged (shape untouched).
      Release build green; Codesys 309, Twincat 449, Engine 2290 (+1 skipped), Cli 263, Connector 115, Contracts 39,
      Repo.Gates 136 — all passed. No recording file changed (the shape is untouched).
