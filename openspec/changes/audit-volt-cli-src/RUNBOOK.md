# Runbook — run one audit batch in a clean context

Everything a fresh session needs. Read `proposal.md` for why, `design.md` for the three agent roles, this file to
*execute*. Append results to `ledger.md`; put anything behavior-changing in `arch-notes.md`.

## 0. Non-negotiables (each one cost real time to learn)

1. **`dotnet` on PATH is an x86 stub with no SDK.** Always `C:\Program Files\dotnet\dotnet.exe`.
2. **A running headless CODESYS holds the net48 bridge DLLs — the build FAILS while it is up** (`MSB3027`,
   "locked by: CODESYS Development System"). The order is always
   **`codesys down` → build → unit tests → `codesys up` → e2e**.
3. **There are THREE C# test suites**, not the two CLAUDE.md used to list: `Volt.Engine.Tests` (313),
   `Volt.Cli.Tests` (116), `Volt.Cli.Connector.Tests` (76).
4. **Never run e2e until the per-pid pipe exists.** A cold run reports phantom failures. Wait for
   `\\.\pipe\volt.bridge.<vendor>.<pid>` (a bare `volt.bridge.codesys` with no pid suffix means nothing is up).
5. **Agents must not run `dotnet build`/`dotnet test`** — concurrent builds corrupt each other's `obj/bin`. The
   gate is serial, run by the main loop.
6. **Only the 4 audited `.cs` files get staged.** TwinCAT fixtures under `test/TwinCAT Project*/` are rewritten by
   the IDE whenever it builds; `git commit -a` would sweep that churn in. Stage explicitly.

## 1. Baseline (already recorded — re-verify only if the tree changed)

Build 0 errors / 14 warnings · 313 + 116 + 76 unit · e2e CODESYS 92 pass / 0 fail · e2e TwinCAT 90 pass / 0 fail.
A red baseline invalidates every verdict that follows, so if in doubt, re-run section 4 before section 2.

## 2. Run the batch

The workflow script is persisted and reusable — do **not** re-send it:

```
C:\Users\marce\.claude\projects\C--Users-marce-Github-volt\<session>\workflows\scripts\audit-volt-cli-src-wf_03c10b19-735.js
```

If that path is gone (it is session-scoped), re-create it from `design.md`'s three roles; the only subtlety is
that `args` can arrive **JSON-stringified**, so the script starts with
`const input = typeof args === 'string' ? JSON.parse(args) : args`.

```
Workflow({ scriptPath: "<path above>", args: { batch: "2", label: "Volt.Engine contracts", groups: [ ...see §6... ] } })
```

It runs `pipeline(groups, audit → surgeon → verify)`: ≤4 groups per invocation (≤12 agents). One file has exactly
one owning group — that partition IS the concurrency safety property, so never list a file in two groups.

## 3. Apply the verdict

- `accept` → proceed to the gate.
- `accept-with-reverts` → revert every `mustRevert` hunk **before** the gate.
- `reject` → `git checkout --` the group's files and re-queue it with the objection appended to the auditor prompt.
- The verifier's `missed[]` is not authoritative but has been consistently right — triage it by hand.

## 4. Gate (serial, never an agent)

```powershell
# CODESYS must be down or the build cannot copy the net48 DLLs
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 down
$d = "C:\Program Files\dotnet\dotnet.exe"; $r = "packages\volt-cli"
& $d build "$r\Volt.Cli.sln" -c Release --nologo
& $d test "$r\test\Volt.Engine.Tests"        -c Release --nologo   # expect 313
& $d test "$r\test\Volt.Cli.Tests"           -c Release --nologo   # expect 116
& $d test "$r\test\Volt.Cli.Connector.Tests" -c Release --nologo   # expect 76
```

Then append to `ledger.md`: per file → issues found / fixed / skipped+reason / **LOC before → after**
(`git show HEAD:<path> | wc -l` vs `wc -l <path>`), plus the verifier verdict. Commit:
`refactor(cli): audit <project-or-slice>` — staging only the audited `.cs` files.

## 5. e2e (after the `Volt.Engine` batches, and at close-out)

```powershell
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up      # rebuilds the bridge first; ~45 s to serve
# WAIT for \\.\pipe\volt.bridge.codesys.<pid>, then:
cd packages/volt-cli; bun run test:e2e:codesys          # expect 92 pass / 8 skip / 0 fail
```

The 8/11 "skips" are per-`describe` hook entries plus three real suites. To run them all:

```powershell
# parallel-instances (3 tests) — SLOW must be the 9.9 MB fixture or the test is meaningless
pwsh scripts/codesys-pipe.ps1 up                                                         # -> FAST
pwsh scripts/codesys-pipe.ps1 up -Instance b -Project test\Pro2193-94-95-96_COdesys.project  # -> SLOW
VOLT_PIPE_SLOW=volt.bridge.codesys.<bigPid> VOLT_PIPE_FAST=volt.bridge.codesys.<smallPid> `
  bun test test/e2e/stability/parallel-instances.test.ts --timeout 300000                 # expect 3/3

# TwinCAT (needs the connector running — it supervises the workers)
pwsh scripts/twincat-instances.ps1 up ; bun run test:e2e:twincat                           # expect 90 pass / 0 fail

# ide-restart (2 tests) — REQUIRES exactly one live XAE; the test asserts this now
Get-Process TcXaeShell | Stop-Process -Force ; pwsh scripts/twincat-instances.ps1 up -Which 13
VOLT_E2E_IDE_CHAOS=1 VOLT_VENDOR=twincat bun test test/e2e/lifecycle/ide-restart.test.ts   # 1 pass / 1 KNOWN FAIL
```

`libcache` (2 tests) is skipped on TwinCAT **by design** — no signature-extraction surface there. It is a feature
gap, not configuration; do not try to make it run.

**Known-failing, do not treat as a regression:** `ide-restart`'s second test. Top entry in `arch-notes.md`.

TwinCAT environment notes: TcXaeShell is best-effort COM and **closed itself unprompted** once in this session; an
XAE that is replaced gets a new pid → new worker → **new pipe**, and the old worker keeps serving a dead pipe for
up to ~15 s before the connector reaps it. Re-verify anything conclusive twice before believing it.

## 6. Remaining batches — copy-paste `groups` args

Paths are repo-relative, exactly as the script expects. Dependency order; do not reorder.

| Batch | label | groups (file → LOC) |
|---|---|---|
| **2** | `Volt.Engine contracts` | **2.1** `Volt.Engine/Ide/*` (9) + `BridgeException.cs` + `Polyfills.cs` = 414 · **2.2** `Volt.Engine/Wire/*` (7) = 537 · **2.3** `Diagnostics/VoltLog.cs` + `Library/*` (3) = 321 |
| **3** | `Volt.Engine/Sync` | **3.1** `PushService.cs` 550 · **3.2** `FetchService.cs` + `ProjectSnapshot.cs` + `Hasher.cs` = 415 · **3.3** `DebugService.cs` + `BuildService.cs` + `RefsService.cs` + `Versioning.cs` + `OpGuard.cs` = 271 |
| **4** | `Volt.Engine/Workspace` | **4.1** `SourceText/StSplitter.cs` 688 · **4.2** `SourceText/StAssembler.cs` + `CodeHelper.cs` = 308 · **4.3** `ItemKind.cs` + `Materializer.cs` = 438 · **4.4** `PouToStText.cs` + `FolderPath.cs` + `PouData.cs` + `WorkspaceItem.cs` = 216 |
| **5** | `Graphical I` | **5.1** `Vg/VgParser.cs` 562 · **5.2** `Vg/VgWriter.cs` + `VgBody.cs` = 328 · **5.3** `PlcOpenWriter.cs` 432 · **5.4** `PlcOpenReader.cs` 372 |
| **6** | `Graphical II` | **6.1** `PlcOpenDocument.cs` + `PlcOpenPouParser.cs` = 340 · **6.2** `GraphicalCode.cs` + `GraphModel.cs` + `GraphicalRoundTrip.cs` = 277 · **6.3** `PouToXml.cs` + `FbdOperators.cs` = 121 → **then e2e checkpoint 1** |
| **7** | `Ide.Codesys` | **7.1** `Ide/CodesysObjectModel.cs` 1100 (alone) · **7.2** `Ide/CodesysTypeMap.cs` + `CodesysDispatcher.cs` + `Reflection.cs` = 264 · **7.3** `Driver/*` (3) + `PipeHost.cs` = 431 |
| **8** | `Ide.Twincat` | **8.1** `Ide/TcObjectModel.cs` 465 · **8.2** `Ide/RotInstances.cs` + `ComMessageFilter.cs` + `StaDispatcher.cs` + `TcPlcOpen.cs` + `TcPouReader.cs` = 341 · **8.3** `Driver/*` (3) + `Program.cs` = 477 |
| **9** | `Volt.Cli core` | **9.1** `Sync/Commands.cs` 509 · **9.2** `Sync/Git.cs` 435 · **9.3** `Program.cs` + `Sync/Types.cs` + `Sync/Config.cs` = 488 |
| **10** | `Volt.Cli support` | **10.1** `Sync/StatusModel.cs` + `Extensions.cs` + `IdeTree.cs` + `BridgeClient.cs` + `BridgeResolver.cs` = 399 · **10.2** `Sync/Scaffold.cs` + `Sidecar.cs` + `PhaseProgress.cs` + `Reporter.cs` + `Files.cs` + `Materialize.cs` = 291 |
| **11** | `Connector.Core` | **11.1** `ConnectionManager.cs` 387 · **11.2** `ControlServer.cs` + `PerPipeProjectSource.cs` + `Reconciler.cs` = 415 · **11.3** the 8 small ones = 327 |
| **12** | `Connector` | **12.1** `TrayContext.cs` 488 · **12.2** `StatusWindow.cs` + `LogWindow.cs` = 506 · **12.3** `Updater.cs` + `BridgeSupervisor.cs` = 402 · **12.4** `VoltEnv.cs` + `Pruner.cs` + `CodesysActivation.cs` + `Program.cs` + `ConnectorSetup.cs` + `LoginItem.cs` = 423 |

All source paths are prefixed `packages/volt-cli/src/<Project>/`.

### Aim these batches at a specific question

- **8 (Beckhoff) + 11 (connector core):** the open `ide-restart` failure — a bridge reporting itself serving
  (`connect` ok, `refs` ok) while the next **write** answers "waiting for an IDE project". Also: should a
  session's declared interest survive its worker's death and re-bind the replacement XAE?
- **8:** every CODESYS bug gets checked on TwinCAT and vice versa (shared Core, parity boundary is the wire), and
  **Beckhoff's per-node tree-walk `try/catch` stays** — that is the single most likely "helpful" regression.
- **11:** one clock — the session poll drives `onConnectorView`; a second cadence is a regression, not a cleanup.
- **7:** reflection / `dynamic` / IronPython entry points mean static search cannot prove code dead. Deletions
  here need positive proof, and only the live e2e run really checks them.

## 6b. The auditor prompt carries a KNOWN-DEFECTS list

The persisted script's context block names three diagnosed defects (the OpGuard/RefsService precondition
divergence, `SingleFlight`'s swallowed probe failure, `FakeIde` asserting the two signals are identical) and tells
agents to **report and move on, never fix**. Keep that list current as defects are found — a half-fix inside a
behavior-preserving pass changes wire behavior without the two-vendor live verification it needs.

## 7. State as of this writing

- Batch 1 (`Volt.Cli.Transport`) **done, gate green, NOT committed.** Working tree also carries: the CLAUDE.md
  third-suite line, and 3 test fixes (`harness.ts` pid-liveness + loud no-pipe error,
  `parallel-instances.test.ts` assertion, `ide-restart.test.ts` single-XAE precondition).
- Batch 2 (`Volt.Engine` contracts, 3 groups) **launched**; gate not yet run. All IDEs are torn down, so the gate
  build can run immediately.
- **Nothing is committed yet.** One review-ready diff covers batches 1-2 plus the test/doc fixes. Stage explicitly
  — the TwinCAT fixture files under `test/TwinCAT Project*/` are dirty from IDE builds and must NOT be swept in.
- The `ide-restart` recovery test is **still red on purpose**: the bridge defect behind it is diagnosed in
  `arch-notes.md` (top entry) and NOT worked around in the test. Do not "fix" the test to make it pass.
- Task 0.1 (write the conventions into `packages/volt-cli/ARCHITECTURE.md`) is **still open** — deliberately, so
  it is derived from real findings rather than guessed. Batch 1's findings are the first input.
- Headless CODESYS may still be running (`codesys-pipe.ps1 down` to tear down; `down -Instance b` for a second).
