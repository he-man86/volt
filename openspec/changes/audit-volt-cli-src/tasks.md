## 0. Setup

- [ ] 0.1 Write the conventions the audit enforces into `packages/volt-cli/ARCHITECTURE.md` (a short
      "Conventions" section: one logging path, error channel, no defensive fallback, nullability, naming,
      file/partial-class layout). Derived from what the code already does *right* — the pilot batch (1) is
      allowed to revise it before the rest run.
- [ ] 0.2 Confirm the gates run clean **before** touching anything (a red baseline invalidates every later
      verdict): `dotnet build Volt.Cli.sln -c Release`, `dotnet test test/Volt.Engine.Tests/`,
      `dotnet test test/Volt.Cli.Tests/`. Use `C:\Program Files\dotnet\dotnet.exe` — the `dotnet` on PATH is an
      x86 stub with no SDK.
- [ ] 0.3 Record the baseline: 118 files / 15,160 LOC (excluding generated `obj/`), and the pre-audit test
      counts, at the top of `ledger.md`.

## Per-batch loop (applies to every batch below)

1. `Workflow`: `pipeline(groups, audit, surgeon, verify)` — the three roles in `design.md`.
2. Revert every `must_revert` hunk the verifier returns; re-queue a wholesale-rejected group.
3. Serial gate (main loop, never an agent): `dotnet build Volt.Cli.sln -c Release` + both test suites.
4. Append the batch to `ledger.md` (per file: found / fixed / skipped+reason / LOC before→after / verdict) and
   push anything behavior-changing or structural to `arch-notes.md`.
5. Commit: `refactor(cli): audit <project-or-slice>`.

## 1. Batch 1 — `Volt.Cli.Transport` (9 files, 422 LOC) — PILOT

- [ ] 1.1 Group 1.1 — all of `Volt.Cli.Transport/` (`PipeServer`, `PipeClient`, `PipeDiscovery`, `PipeNames`,
      `PipeMessages`, `Ops`, `Vendors`, `BridgeErrorCodes`, `HealthStatus`).
- [ ] 1.2 Gate + ledger + commit.
- [ ] 1.3 **Review the pilot with the user** before batch 2 — finding quality, false-positive rate, whether the
      conventions doc (0.1) needs revising, whether the role prompts need tightening. This is the cheapest
      possible place to learn the workflow is mis-tuned.

## 2. Batch 2 — `Volt.Engine` contracts (3 groups, 1,272 LOC)

- [ ] 2.1 Group 2.1 — `Ide/*` (9 files) + `BridgeException.cs` + `Polyfills.cs` (414)
- [ ] 2.2 Group 2.2 — `Wire/*` (7 files: `BridgePipeHost`, `PushModels`, `RefsFetch`, `HealthResponse`,
      `BuildModels`, `ProjectEntry`, `ProgressFrame`) (537)
- [ ] 2.3 Group 2.3 — `Diagnostics/VoltLog.cs` + `Library/*` (321)
- [ ] 2.4 Gate + ledger + commit.

## 3. Batch 3 — `Volt.Engine/Sync` (3 groups, 1,236 LOC)

- [ ] 3.1 Group 3.1 — `PushService.cs` (550)
- [ ] 3.2 Group 3.2 — `FetchService.cs` + `ProjectSnapshot.cs` + `Hasher.cs` (415)
- [ ] 3.3 Group 3.3 — `DebugService.cs` + `BuildService.cs` + `RefsService.cs` + `Versioning.cs` +
      `OpGuard.cs` (271)
- [ ] 3.4 Gate + ledger + commit.

## 4. Batch 4 — `Volt.Engine/Workspace` (4 groups, 1,650 LOC)

- [ ] 4.1 Group 4.1 — `SourceText/StSplitter.cs` (688)
- [ ] 4.2 Group 4.2 — `SourceText/StAssembler.cs` + `SourceText/CodeHelper.cs` (308)
- [ ] 4.3 Group 4.3 — `ItemKind.cs` + `Materializer.cs` (438)
- [ ] 4.4 Group 4.4 — `PouToStText.cs` + `FolderPath.cs` + `PouData.cs` + `WorkspaceItem.cs` (216)
- [ ] 4.5 Gate + ledger + commit.

## 5. Batch 5 — `Volt.Engine/Graphical` I (4 groups, 1,662 LOC)

- [ ] 5.1 Group 5.1 — `Vg/VgParser.cs` (562)
- [ ] 5.2 Group 5.2 — `Vg/VgWriter.cs` + `VgBody.cs` (328)
- [ ] 5.3 Group 5.3 — `PlcOpenWriter.cs` (432)
- [ ] 5.4 Group 5.4 — `PlcOpenReader.cs` (372)
- [ ] 5.5 Gate + ledger + commit.

## 6. Batch 6 — `Volt.Engine/Graphical` II (3 groups, 738 LOC)

- [ ] 6.1 Group 6.1 — `PlcOpenDocument.cs` + `PlcOpenPouParser.cs` (340)
- [ ] 6.2 Group 6.2 — `GraphicalCode.cs` + `GraphModel.cs` + `GraphicalRoundTrip.cs` (277)
- [ ] 6.3 Group 6.3 — `PouToXml.cs` + `FbdOperators.cs` (121)
- [ ] 6.4 Gate + ledger + commit.
- [ ] 6.5 **e2e checkpoint 1** — `Volt.Engine` is fully audited (6,580 LOC). `pwsh
      packages/volt-cli/scripts/codesys-pipe.ps1 up`, then `bun test test/e2e` with
      `VOLT_PIPE=volt.bridge.codesys…`. A round-trip/wire regression is now localized to the Engine, not to 15k
      LOC. Do not proceed red.

## 7. Batch 7 — `Volt.Cli.Ide.Codesys` (3 groups, 1,795 LOC)

- [ ] 7.1 Group 7.1 — `Ide/CodesysObjectModel.cs` (1,100 — the largest file in the repo, own group)
- [ ] 7.2 Group 7.2 — `Ide/CodesysTypeMap.cs` + `Ide/CodesysDispatcher.cs` + `Ide/Reflection.cs` (264)
- [ ] 7.3 Group 7.3 — `Driver/*` (3 files) + `PipeHost.cs` (431)
- [ ] 7.4 Gate + ledger + commit. **Reflection/`dynamic`/IronPython entry points are not statically findable —
      "dead" deletions in this batch need positive proof, and the e2e run is the only real check.**

## 8. Batch 8 — `Volt.Cli.Ide.Twincat` (3 groups, 1,283 LOC)

- [ ] 8.1 Group 8.1 — `Ide/TcObjectModel.cs` (465)
- [ ] 8.2 Group 8.2 — `Ide/RotInstances.cs` + `ComMessageFilter.cs` + `StaDispatcher.cs` + `TcPlcOpen.cs` +
      `TcPouReader.cs` (341)
- [ ] 8.3 Group 8.3 — `Driver/*` (3 files) + `Program.cs` (477)
- [ ] 8.4 Gate + ledger + commit. **Parity check, both directions: any bug found here gets checked against the
      CODESYS side and vice versa (shared Core, parity boundary is the wire). Beckhoff's per-node tree-walk
      `try/catch` stays.**

## 9. Batch 9 — `Volt.Cli` core (3 groups, 1,432 LOC)

- [ ] 9.1 Group 9.1 — `Sync/Commands.cs` (509)
- [ ] 9.2 Group 9.2 — `Sync/Git.cs` (435)
- [ ] 9.3 Group 9.3 — `Program.cs` + `Sync/Types.cs` + `Sync/Config.cs` (488)
- [ ] 9.4 Gate + ledger + commit.

## 10. Batch 10 — `Volt.Cli` support (2 groups, 690 LOC)

- [ ] 10.1 Group 10.1 — `Sync/StatusModel.cs` + `Extensions.cs` + `IdeTree.cs` + `BridgeClient.cs` +
      `BridgeResolver.cs` (399)
- [ ] 10.2 Group 10.2 — `Sync/Scaffold.cs` + `Sidecar.cs` + `PhaseProgress.cs` + `Reporter.cs` + `Files.cs` +
      `Materialize.cs` (291)
- [ ] 10.3 Gate + ledger + commit.

## 11. Batch 11 — `Volt.Cli.Connector.Core` (3 groups, 1,129 LOC)

- [ ] 11.1 Group 11.1 — `ConnectionManager.cs` (387)
- [ ] 11.2 Group 11.2 — `ControlServer.cs` + `PerPipeProjectSource.cs` + `Reconciler.cs` (415)
- [ ] 11.3 Group 11.3 — `TwincatSupervisor.cs` + `TwincatXaeProbe.cs` + `Log.cs` + `IProjectSource.cs` +
      `DetectedProject.cs` + `IBridgeWire.cs` + `Session.cs` + `BridgeStatus.cs` (327)
- [ ] 11.4 Gate + ledger + commit. **One clock: the session poll drives `onConnectorView` and everything
      follows it — a second cadence is a regression, not a cleanup.**

## 12. Batch 12 — `Volt.Cli.Connector` (4 groups, 1,819 LOC)

- [ ] 12.1 Group 12.1 — `TrayContext.cs` (488)
- [ ] 12.2 Group 12.2 — `StatusWindow.cs` + `LogWindow.cs` (506)
- [ ] 12.3 Group 12.3 — `Updater.cs` + `BridgeSupervisor.cs` (402)
- [ ] 12.4 Group 12.4 — `VoltEnv.cs` + `Pruner.cs` + `CodesysActivation.cs` + `Program.cs` +
      `ConnectorSetup.cs` + `LoginItem.cs` (423)
- [ ] 12.5 Gate + ledger + commit.

## 13. Close-out

- [ ] 13.1 **e2e checkpoint 2 (the acceptance gate)** — full `bun test test/e2e` against headless CODESYS on the
      final tree. Green = the audit preserved behavior end to end.
- [ ] 13.2 `bun run typecheck` + `bun run lint` (the TS e2e harness and scripts are in scope for staying green),
      and `dotnet build`/both suites one final time on the squashed result.
- [ ] 13.3 Finalize `ledger.md`: totals — files audited, issues found by kind, fixed vs skipped, LOC
      before → after, net delta.
- [ ] 13.4 Finalize `arch-notes.md` and split it into concrete follow-up proposals (each note = a `## Why` a
      future change can start from). Nothing behavior-changing was implemented here.
- [ ] 13.5 Fold the settled conventions into `packages/volt-cli/ARCHITECTURE.md` (0.1's section, revised by what
      the audit actually learned) and fix any `CLAUDE.md`/`ARCHITECTURE.md` drift the audit surfaced.
- [ ] 13.6 Decide (and record) whether any convention is worth mechanizing as an analyzer/`.editorconfig` rule
      in CI — a rule a human has to remember is a rule that rots. Out of scope to implement here.
