## 1. New package + transport (DONE)

- [x] 1.1 `packages/volt-cli` solution: Transport / Host / Cli / Tests; backups untouched.
- [x] 1.2 Named-pipe transport (PipeServer + PipeClient + frames) replacing HTTP — concurrent connections so
      `/health` isn't blocked behind a long op.
- [x] 1.3 `BridgePipeHost` wires the pipe to Core's services (refs/fetch/push/build) + the activeOp busy signal.
- [x] 1.4 Bridge wire tests reformatted onto the pipe (streaming, phaseless progress-fold, concurrent activeOp).
- [x] 1.5 The volt-bridge e2e behavioral+parity suite (CRUD/lifecycle/children/clear/graphical/kinds — 14 files)
      made dual-transport: `harness.ts` speaks HTTP (default, backup) or the named pipe when `VOLT_PIPE` is set
      (path→op map; HTTP-wire-only openapi/swagger/404 skip under pipe). **Ran over the pipe vs live headless
      CODESYS: 68 pass / 0 fail / 3 skip.** TwinCAT: gated on the XAE having an active PLC project (same driver +
      Core + pipe host as CODESYS — architecturally identical; not run live).

## 2. Port volt-git/src → C# (Volt.Cli.Sync) (DONE, verified vs FakeIde + a real repo)

- [x] 2.1 Git plumbing (`git.ts` → `Process`), ordinal string compares.
- [x] 2.2 config / files / extensions / materialize / sidecar (camelCase JSON = byte-compatible with the backup).
- [x] 2.3 `buildVoltIdeTree` merge engine — review-agent-verified faithful; data-loss invariant pinned.
- [x] 2.4 status model, bridge client (pipe + Core DTOs; no zod, no wire-version handshake).
- [x] 2.5 commands: status / pull / push / build / show / merge / diff. (`log` DROPPED — use `git log volt/ide`.)
- [x] 2.6 `Program.cs` — full CLI dispatch (`--json`/`--porcelain`/exit codes), `--pipe`/`VOLT_PIPE` override.

## 3. Finish the CLI surface + the parity oracle

- [x] 3.1 `init` — bind + git init + scaffold + first `/init` fetch (tested end-to-end). Corpus install (from the
      TS `@volt/lsp-iec`) stubbed with a note — the workspace is functional without the AI reference files.
- [x] 3.2 Black-box parity net: spawns the real `volt` binary (via `VOLT_PIPE`) against a pipe host, drives
      pull + status, asserts `--json` shape (incl. `merging: null` present-not-omitted) + git state.
- [ ] 3.3 NativeAOT/ReadyToRun `volt status` cold-start vs the Bun binary — recorded.

## 4. Real-IDE entry-point hosts (COMPILE ✓; live smoke pending)

- [x] 4.1 `Volt.Cli.Ide.Codesys` (net48 in-proc DLL): `PipeHost.Start(...)` → `new BridgePipeHost(new
      CodesysDriver(projects), PipeNames.Codesys)`. Reuses the real driver by reference. Builds.
- [x] 4.2 `Volt.Cli.Ide.Twincat` (net8 exe): STA + attach to XAE + `new BridgePipeHost(new BeckhoffDriver(),
      PipeNames.Beckhoff)` (copied the internal ComMessageFilter to avoid touching the backup). Builds.
- [x] 4.3 Live smoke DONE. CODESYS: headless `PipeHost.Start` (scripts/run_pipe_headless.py + codesys-pipe.ps1) →
      real `volt.exe init --port 8556` over pipe `volt.bridge.codesys`: streamed 593 items (phaseless fold), seeded
      git, `refs/remotes/volt/ide` + `volt: IDE @…` merge commit, `status --json` = "in sync" (`merging:null`
      present). TwinCAT: pipe `volt.bridge.beckhoff` up (real BeckhoffDriver attached to live XAE); CLI got the
      clean domain error "no PLC project loaded" (exit 1) — transport + driver + error path proven; full pull blocked
      only by the XAE active-project SELECTION (UI state, same backup driver — not a code issue).

## 5. Cutover

- [x] 5.1 `build-payload.ts` now ships the .NET `volt` (packages/volt-cli via `build-cli.ps1` → `dist/Cli/volt.exe`
      + the two pipe IDE hosts + connector bundle), not the Bun compile. Connector migrated HTTP → pipe:
      `HealthProbe` calls the `health` op over `PipeClient`; `VendorProvider` spawns `VoltBridgeTwincat.exe` +
      launches CODESYS with `start_pipe.py`; references `Volt.Cli.Transport` (wire-only, keeps the no-vendor-code
      decoupling). New live-IDE `start_pipe.py` + headless `run_pipe_headless.py`/`codesys-pipe.ps1`. Stray HTTP
      apphost pruned from the bundle. ponytail: each exe is self-contained (runtime duplicated) — dedupe into a
      shared runtime dir only if installer size measurably matters.
- [x] 5.2 (partial) `volt-config/tool` drops `log`; the tool calls bare `volt` on PATH, so it targets the new exe
      with NO change (the bare-name design pays off). DEFERRED (gated on production validation — backups stay):
      retiring `packages/volt-git`, dropping the `WIRE_VERSION` symmetry check (still guards the backup pair),
      `Updater.cs`/installer confirmation.
- [x] 5.3 (live half) Shipped `dist/Cli/volt.exe` green against real headless CODESYS over the pipe: `init` (593
      items, git seeded), `status --json` "in sync" (`merging:null` present), incremental `pull` "already up to
      date". `build-cli.ps1` passes 25 Volt.Cli tests before publishing. REMAINING: full install-smoke gate
      (`build:installer` + `test:install`) + cold-start record + TwinCAT full pull (needs an XAE with a selected
      project).
