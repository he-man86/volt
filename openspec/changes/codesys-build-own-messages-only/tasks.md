## 0. Analyse

- [ ] 0.1 Confirm or refute the reading in the proposal: `GetBuildDiagnostics` returns every category of
      `MessageStorage`, and script output/stderr is one of them. If refuted, record why here and stop.

## 1. Reproduce

- [ ] 1.1 Live CODESYS fixture copy, clean project: run a script that prints a line and writes a line to stderr, then
      call `build`. Record the diagnostics and `success`. Expect the script lines among them and `success: false`.
- [ ] 1.2 Record, per message, its category (name/guid) — script output, stderr, the build's own messages, and the
      messages a directed `.library` read leaves behind. Record whether the build command clears its own category
      before it runs.

## 2. Test red

- [ ] 2.1 A test on a `MessageStorage` double: a foreign category holding an error plus a build category holding
      only infos → `Build()` answers `true` and the diagnostics hold only the build's messages. Red before the fix.
- [ ] 2.2 The same double with a real compile error in the build category → still `false`, error still reported.
- [ ] 2.3 An unreadable store still yields the `Unreadable` error diagnostic (guard).

## 3. Fix

- [ ] 3.1 Scope `GetBuildDiagnostics` to the build's own messages (categories or "added since the build started",
      per 1.2). Diagnostic shape unchanged.

## 4. Verify

- [ ] 4.1 Repeat 1.1: script lines absent, `success: true`; a planted compile error still fails the build.
- [ ] 4.2 TwinCAT: confirm the Build-pane read does not pick up foreign output (note or test).
- [ ] 4.3 Full C# suites green; conformance recordings unchanged (shape untouched).
