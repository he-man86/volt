> ## ⚠ RECONCILE BEFORE RESUMING — `optimize-volt-cli-architecture` landed underneath this plan
>
> Batches 5–12 were written against the tree as it stood on 2026-08-05. Twenty-three structural moves have
> landed since, so **re-derive each remaining batch's file list and LOC before running it.** Concretely:
>
> **Named here but DELETED** — a group that lists them will find nothing:
> - `DebugService.cs` (+ `IDebugIntrospect.cs`, the three `IIdeSession.Debug*` members and their four vendor
>   implementations) — move 2. **Batch 3.3 and batch 6.3 both need rewriting.**
> - `PouToXml.cs` — move 3a. **Batch 6.3 is now `FbdOperators.cs` alone.**
> - `SourceText/StAssembler.cs` — move 4. **Batch 4.2 loses its largest file.**
> - `Volt.Cli.Connector.Core/Log.cs` — move 9. **Batch 11.3 shrinks.**
>
> **RELOCATED** — still audit them, but not where this plan says:
> - `VoltLog.cs`: `Volt.Engine/Diagnostics/` → `Volt.Cli.Transport/` (move 6). Batch 2.3's `Diagnostics/` group
>   no longer exists; the file belongs to batch 1's project now.
> - `ProjectEntry.cs` + `HealthResponse.cs`: `Volt.Engine/Wire/` → `Volt.Cli.Transport/Wire/` (move 10), and
>   `ConnectRequest.cs` is now its own file. **Batch 2.2 must be re-scoped.**
> - `BridgeSupervisor.cs`: `Volt.Cli.Connector/` → `Volt.Cli.Connector.Core/` (move 24), plus a new
>   `TwincatFleet.cs`. **Batches 11 and 12 both shift.**
>
> **SUBSTANTIALLY REWRITTEN since being planned** — audit the current text, not the remembered one:
> `DriverBase.cs` (now composes the whole health response), both drivers' `SnapshotHealth`,
> `CodesysTypeMap.cs`, `BridgePipeHost.cs`, `Commands.cs`, `RefsService.cs`, `PipeServer.cs`.
>
> **New files that did not exist when this plan was written** and are therefore in NO batch:
> `Volt.Cli.Transport/WorkerCli.cs`, `Volt.Cli.Transport/Polyfills.cs`, `Volt.Cli.Connector.Core/TwincatFleet.cs`.
>
> Also note the gate has moved: the three suites are now **337 / 122 / 77**, and the TwinCAT e2e baseline is
> **90 / 11 / 0** *when pinned to a stable XAE* — see `openspec/changes/archive/2026-08-06-optimize-volt-cli-architecture/RUNBOOK.md` §0.6a/§5, which document two
> traps this plan predates (a stale-binary false green, and one fixture's XAE crashing mid-run).

## 0. Setup

- [x] 0.1 Write the conventions the audit enforces into `packages/volt-cli/ARCHITECTURE.md` (a short
      "Conventions" section: one logging path, error channel, no defensive fallback, nullability, naming,
      file/partial-class layout). Derived from what the code already does *right* — the pilot batch (1) is
      allowed to revise it before the rest run.
- [x] 0.2 Confirm the gates run clean **before** touching anything (a red baseline invalidates every later
      verdict): `dotnet build Volt.Cli.sln -c Release`, `dotnet test test/Volt.Engine.Tests/`,
      `dotnet test test/Volt.Cli.Tests/`. Use `C:\Program Files\dotnet\dotnet.exe` — the `dotnet` on PATH is an
      x86 stub with no SDK.
- [x] 0.3 Record the baseline: 118 files / 15,160 LOC (excluding generated `obj/`), and the pre-audit test
      counts, at the top of `ledger.md`.

## Per-batch loop (applies to every batch below)

1. `Workflow`: `pipeline(groups, audit, surgeon, verify)` — the three roles in `design.md`.
2. Revert every `must_revert` hunk the verifier returns; re-queue a wholesale-rejected group.
3. Serial gate (main loop, never an agent): `dotnet build Volt.Cli.sln -c Release` + both test suites.
4. Append the batch to `ledger.md` (per file: found / fixed / skipped+reason / LOC before→after / verdict) and
   push anything behavior-changing or structural to `arch-notes.md`.
5. Commit: `refactor(cli): audit <project-or-slice>`.

## 1. Batch 1 — `Volt.Cli.Transport` (9 files, 422 LOC) — PILOT

- [x] 1.1 Group 1.1 — all of `Volt.Cli.Transport/` (`PipeServer`, `PipeClient`, `PipeDiscovery`, `PipeNames`,
      `PipeMessages`, `Ops`, `Vendors`, `BridgeErrorCodes`, `HealthStatus`).
- [x] 1.2 Gate + ledger + commit.
- [x] 1.3 **Review the pilot with the user** before batch 2 — finding quality, false-positive rate, whether the
      conventions doc (0.1) needs revising, whether the role prompts need tightening. This is the cheapest
      possible place to learn the workflow is mis-tuned.

## 2. Batch 2 — `Volt.Engine` contracts (3 groups, 1,272 LOC)

- [x] 2.1 Group 2.1 — `Ide/*` (9 files) + `BridgeException.cs` + `Polyfills.cs` (414)
- [x] 2.2 Group 2.2 — `Wire/*` (7 files: `BridgePipeHost`, `PushModels`, `RefsFetch`, `HealthResponse`,
      `BuildModels`, `ProjectEntry`, `ProgressFrame`) (537)
- [x] 2.3 Group 2.3 — `Diagnostics/VoltLog.cs` + `Library/*` (321)
- [x] 2.4 Gate + ledger + commit.

## 3. Batch 3 — `Volt.Engine/Sync` (3 groups, 1,236 LOC)

- [x] 3.1 Group 3.1 — `PushService.cs` (550)
- [x] 3.2 Group 3.2 — `ProjectSnapshot.cs` + `Hasher.cs` + `Versioning.cs` — `FetchService.cs` was DEFERRED to
      batch 5 (the `fix-connected-precondition` change had just rewritten it, so its diff was not the surgeon's)
- [x] 3.3 Group 3.3 — `DebugService.cs` + `BuildService.cs` + `RefsService.cs` — `OpGuard.cs` DEFERRED to batch 5,
      same reason
- [x] 3.4 Gate + ledger + commit.

## 4. Batch 4 — `Volt.Engine/Workspace` (4 groups, 1,650 LOC)

- [x] 4.1 Group 4.1 — `SourceText/StSplitter.cs` (688)
- [x] 4.2 Group 4.2 — `SourceText/StAssembler.cs` + `SourceText/CodeHelper.cs` (308)
- [x] 4.3 Group 4.3 — `ItemKind.cs` + `Materializer.cs` (438)
- [x] 4.4 Group 4.4 — `PouToStText.cs` + `FolderPath.cs` + `PouData.cs` + `WorkspaceItem.cs` (216)
- [x] 4.5 Gate + ledger + commit.

## Batches 5-12 — RE-DERIVED 2026-08-06 against the current tree

The originals were replaced wholesale, not patched: after 23 structural moves their file lists, LOC and group
compositions were wrong in enough places that patching would have left a plan that only looked right. Current
remaining scope: **~10,570 LOC across 68 files.**

Run one batch per `Workflow` invocation — `pipeline(groups, audit, surgeon, verify)`, 3 agents per group.
**Every file has exactly one owning group.** That partition is the concurrency safety property: groups run
concurrently, so a surgeon that edits outside its group corrupts another's work.

Per batch: revert every `mustRevert` → **stop CODESYS/connector/workers** → `dotnet build Volt.Cli.sln -c Release`
→ the three suites (**337 / 122 / 77**) → append to `ledger.md` → commit `refactor(cli): audit <slice>`.

### 5. Graphical I — 4 groups, 1,694 LOC

- [x] 5.1 `Graphical/Vg/VgParser.cs` (562)
- [x] 5.2 `Graphical/PlcOpenWriter.cs` (432)
- [x] 5.3 `Graphical/PlcOpenReader.cs` (372)
- [x] 5.4 `Graphical/Vg/VgWriter.cs` + `Graphical/VgBody.cs` (328)
- [x] 5.5 Gate + ledger + commit.

### 6. Graphical II + the batch-3 deferrals — 3 groups, 963 LOC

- [x] 6.1 `Graphical/PlcOpenDocument.cs` + `Graphical/PlcOpenPouParser.cs` (340)
- [x] 6.2 `Graphical/GraphicalCode.cs` + `GraphModel.cs` + `GraphicalRoundTrip.cs` + `FbdOperators.cs` (306)
- [x] 6.3 `Sync/FetchService.cs` (282) + `Sync/OpGuard.cs` (35) — deferred from batch 3; both have since been
      rewritten by moves 13/16/21, so audit the CURRENT text
- [x] 6.4 Gate + ledger + commit. **`Volt.Engine` is then fully audited** → e2e checkpoint, both vendors.

### 7. `Volt.Cli.Ide.Codesys` — 3 groups, 1,712 LOC

- [x] 7.1 `Ide/CodesysObjectModel.cs` (980 — largest file in the repo, own group)
- [x] 7.2 `Ide/CodesysTypeMap.cs` + `Ide/CodesysDispatcher.cs` + `Ide/Reflection.cs` (280)
- [x] 7.3 `Driver/CodesysDriver.cs` + `.Tree.cs` + `.Code.cs` + `PipeHost.cs` (452)
- [x] 7.4 Gate + ledger + commit. **Reflection / `dynamic` / IronPython live here — static search cannot prove a
      deletion safe. Only the live e2e really checks 7.x.**

### 8. `Volt.Cli.Ide.Twincat` — 3 groups, 1,386 LOC

- [x] 8.1 `Ide/TcObjectModel.cs` (494)
- [x] 8.2 `Ide/RotInstances.cs` + `ComMessageFilter.cs` + `StaDispatcher.cs` + `TcPlcOpen.cs` + `TcPouReader.cs` (358)
- [x] 8.3 `Driver/BeckhoffDriver.cs` + `.Tree.cs` + `.Code.cs` + `Program.cs` (534)
- [x] 8.4 Gate + ledger + commit. **`BeckhoffDriver.Tree.cs`'s per-node `try/catch` STAYS** — it is the single
      most likely "helpful" regression in the whole audit.

### 9. `Volt.Cli` core — 3 groups, 1,403 LOC

- [x] 9.1 `Sync/Commands.cs` (570)
- [x] 9.2 `Sync/Git.cs` (435)
- [x] 9.3 `Program.cs` + `Sync/Types.cs` (398)
- [x] 9.4 Gate + ledger + commit.

### 10. `Volt.Cli` support — 2 groups, 784 LOC

- [x] 10.1 `Sync/StatusModel.cs` + `Config.cs` + `BridgeClient.cs` + `Extensions.cs` + `IdeTree.cs` + `BridgeResolver.cs` (493)
- [x] 10.2 `Sync/Sidecar.cs` + `Scaffold.cs` + `PhaseProgress.cs` + `Reporter.cs` + `Files.cs` + `Materialize.cs` (291)
- [x] 10.3 Gate + ledger + commit.

### 11. `Volt.Cli.Connector.Core` — 3 groups, 1,297 LOC

- [x] 11.1 `ConnectionManager.cs` (387)
- [x] 11.2 `ControlServer.cs` + `PerPipeProjectSource.cs` + `Reconciler.cs` (421)
- [x] 11.3 `BridgeSupervisor.cs` + `TwincatFleet.cs` + `TwincatXaeProbe.cs` + `TwincatSupervisor.cs` +
      `IProjectSource.cs` + `DetectedProject.cs` + `IBridgeWire.cs` + `Session.cs` + `BridgeStatus.cs` (489)
- [x] 11.4 Gate + ledger + commit. **`BridgeSupervisor` + `TwincatFleet` are NEW here** (move 24 brought them out
      of the WinForms assembly) and have never been audited.

### 12. `Volt.Cli.Connector` — 3 groups, 1,649 LOC

- [x] 12.1 `TrayContext.cs` (479)
- [x] 12.2 `StatusWindow.cs` + `LogWindow.cs` (504)
- [x] 12.3 `Updater.cs` + `VoltEnv.cs` + `Pruner.cs` + `CodesysActivation.cs` + `Program.cs` +
      `ConnectorSetup.cs` + `LoginItem.cs` (666)
- [x] 12.4 Gate + ledger + commit, then the close-out e2e on both vendors.

## 13. Close-out

- [x] 13.1 **e2e checkpoint 2 (the acceptance gate)** — full `bun test test/e2e` against headless CODESYS on the
      final tree. Green = the audit preserved behavior end to end.
- [x] 13.2 `bun run typecheck` + `bun run lint` (the TS e2e harness and scripts are in scope for staying green),
      and `dotnet build`/both suites one final time on the squashed result.
- [x] 13.3 Finalize `ledger.md`: totals — files audited, issues found by kind, fixed vs skipped, LOC
      before → after, net delta.
- [x] 13.4 Finalize `arch-notes.md` and split it into concrete follow-up proposals (each note = a `## Why` a
      future change can start from). Nothing behavior-changing was implemented here.
- [x] 13.5 Fold the settled conventions into `packages/volt-cli/ARCHITECTURE.md` (0.1's section, revised by what
      the audit actually learned) and fix any `CLAUDE.md`/`ARCHITECTURE.md` drift the audit surfaced.
- [x] 13.6 Decide (and record) whether any convention is worth mechanizing as an analyzer/`.editorconfig` rule
      in CI — a rule a human has to remember is a rule that rots. Out of scope to implement here.
