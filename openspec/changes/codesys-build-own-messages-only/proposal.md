## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what a live session observed, and
our reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested
change are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's
intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**On CODESYS, a build's diagnostics are every line in the IDE's message window, not the messages of that build. A
script that writes to stderr once makes every later build of a clean project answer `success: false`.**

What PLCAssist saw (live, CODESYS 3.5.21.40, bridge 0.1.17374 = volt `a7106efb7d`, one clean project):
- The `build` op's diagnostics carried script output as `info` diagnostics: `LiveCheck: opened …`,
  `Volt: loading …` (`packages/volt-cli/scripts/start_volt_codesys.py:174`), `Volt bridge started on pipe …` (`packages/volt-cli/src/Volt.Ide.Codesys/PipeHost.cs:100`).
- After a script wrote to stderr — `…live-run.py:9: DeprecationWarning: execfile() not supported in 3.x` and
  `execfile(start, g)` — those two lines came back as two **error** diagnostics with no `name`, and the build of the
  unchanged, clean project answered `success: false`.
- The AI then told the user the build could not be verified. Any user script or plugin that prints an error poisons
  every later build until someone clears the message view by hand.

Our reading of the code (`packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Build.cs`):
- `GetBuildDiagnostics` (line 33) takes `APEnvironment.MessageStorage`, enumerates **all** `Categories` (line 44-47:
  "enumerate all categories") and returns every message of each.
- `Build` (line 21-31) answers `false` when ANY of those is error-severity.
- Nothing scopes them to the build: not a category filter, not a snapshot taken before `ExecuteCommand`, not a clear.
  The script engine's output (and stderr) evidently lands in a category of the same store.

Related, from volt's own docs: a directed `.library` read on CODESYS (`packages/volt-cli/src/Volt.Engine/Sync/FetchService.cs:246`,
`packages/volt-cli/src/Volt.Engine/Library/LibrarySignatureCache.cs:9`) runs an application build that rewrites the message view. Whether its messages, or a
previous build's, can then appear in a later `build` op is part of the same question.

What is not known:
- Which category the script output and stderr land in, and which categories a "build active application" writes
  (the compile category, precompile, others?). Task 1 settles it.
- Whether the build command clears its own categories first (so stale build messages are not the issue, only foreign
  categories are).

## What Changes

- **A build reports only the messages of that build.** Either read only the build/compile message categories, or
  only the messages added after the build started — whichever the measurement in task 1 shows is exact. The choice is
  volt's.
- `success` follows from those messages only.
- **No change to the diagnostics' shape.** Same fields, same severities, same naming — the PLCAssist owner asked that
  build diagnostics are otherwise left as they are. This is a correctness fix of WHICH messages, nothing else.
- Keep the existing guarantee: an unreadable store is still an error diagnostic, never an empty (= clean) list.

## Impact

- `packages/volt-cli/src/Volt.Ide.Codesys/Ide/CodesysObjectModel.Build.cs` (`Build`, `GetBuildDiagnostics`).
- Possibly `CodesysDriver.GetBuildDiagnostics` if the scoping needs the build's start state. Note the store is read TWICE: inside `Build()` (for `success`) and again by `BuildService.cs:48` (for the wire list) — both reads must apply the same scope, or `success` and the diagnostics disagree.
- TwinCAT: confirm its Build-pane read cannot pick up foreign output the same way (no change expected).
- Clients: none on the wire; PLCAssist stops seeing script lines and false build failures.

## Volt's assessment (2026-10-04)

**CONFIRMED — a real bug.** `CodesysObjectModel.Build.cs`: `GetBuildDiagnostics` enumerates EVERY category of
`APEnvironment.MessageStorage` (the loop under "enumerate all categories") and `Build()` answers `false` on any
error-severity message in any of them. Nothing scopes the read to the build, so script output, stderr lines and the
bridge's own start lines in other categories become build diagnostics, and a single stderr line fails every later
build of a clean project. Both reads (inside `Build()` and `BuildService`) go through the same method, so one fix
covers both.

**Fits Volt's design.** The owner's earlier decision (2026-10-01, `build-environment-diagnostics` dropped: "the
bridge returns every diagnostic as the IDE gave it") is about the BUILD's diagnostics — a missing library is a message
the compile itself writes and stays. Script/console output is not a build diagnostic. Scope: report the messages of
the build's own categories (measured in 1.2 which those are — compile, precompile, …; preferred over a time snapshot
because it is exact and stateless), shape unchanged, the unreadable-store guard kept. TwinCAT: verify its Build-pane
read (4.2).

**Plan:** WILL BUILD, as one small change (one agent: measure → red test → fix → live verify → close), in Volt's
bridge lane.
