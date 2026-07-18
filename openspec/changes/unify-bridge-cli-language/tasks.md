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
- [x] 5.2 `volt-config/tool` drops `log`; the tool calls bare `volt` on PATH, so it targets the new exe with NO
      change (the bare-name design pays off).
- [x] 5.3 (live half) Shipped `dist/Cli/volt.exe` green against real headless CODESYS over the pipe: `init` (593
      items, git seeded), `status --json` "in sync" (`merging:null` present), incremental `pull` "already up to
      date". `build-cli.ps1` passes 25 Volt.Cli tests before publishing. REMAINING: full install-smoke gate
      (`build:installer` + `test:install`) + cold-start record + TwinCAT full pull (needs an XAE with a selected
      project).

## 6. Consolidation — one package, backups deleted (DONE)

The "keep backups in parallel" plan was superseded: `volt-cli` is now the single self-contained package.

- [x] 6.1 Moved `Volt.Bridge.Core` + both drivers + the connector + the C# tests into `volt-cli`, renamed
      `Volt.Bridge.*` → `Volt.Cli.*`. **Deleted `packages/volt-bridge` and `packages/volt-git`.**
- [x] 6.2 Stripped the HTTP layer entirely: `BridgeHttpServer`, the HTTP entry points, the `WireProtocol.Version`
      handshake, openapi/swagger, and the HTTP-only tests. Dropped the `WIRE_VERSION` symmetry check + the volt-git
      binary checks from `check-wiring`.
- [x] 6.3 One project per IDE (driver folded into its pipe host), then collapsed 8 → 6 projects: `Sync` → the
      `volt.exe` CLI, `Host` (`BridgePipeHost`) → `Core/Wire`. Kept Transport (the Connector's wire-only decoupling),
      Core (netstandard2.0 multi-TFM), the CLI, the two IDE hosts, the Connector.
- [x] 6.4 Frontends moved off the deleted HTTP wire: `volt-control` `probeHealth` → the `health` op over the pipe;
      `cli.ts` → the shipped `volt.exe` / `volt` on PATH; desktop dev path; vscode drops the bundled TS `cli.js`
      (the CLI comes from the Volt install on PATH). Progress-frame contract verified live (`VOLT_PROGRESS` frames).
- [x] 6.5 Rewired build/CI/scripts/docs: root workspaces, `@volt/cli`, `build-cli.ps1`, `codesys-pipe.ps1`,
      `ci.yml` (windows `volt-cli` job builds the sln + Core.Tests), CLAUDE.md + all package docs.
- Validated throughout: consolidated sln builds 0 errors; Core.Tests 268/0, Cli.Tests 25/0; `build-cli.ps1`
  publishes + bundles; shipped `volt.exe init` pulled 593 files from live headless CODESYS.
- [x] 6.6 Install-smoke gate GREEN: `build:installer` → `Volt-win-Setup.exe` (196 MB); `test:install` verified the
      install (VoltConnector, `OPENCODE_CONFIG_DIR`, PATH, vsix, shortcut, login item, Add/Remove, tray) **and** a
      clean uninstall. Inno `FileCopy`→`CopyFile` hint fixed.
- [x] 6.7 Cold-start recorded: self-contained `volt.exe` no-op ~146 ms warm (118 min / 187 cold). Also cut the
      no-bridge wait 5s → 2s (`volt status` with the IDE closed used to hang on the connect timeout).
- [x] 6.8 Live TwinCAT full pull GREEN: worker attached to `TwinCAT Project13 / Untitled1` (`VOLT_TC_PROJECT`),
      `volt init --port 8555` pulled 7 files, `status --json` "in sync", `pull` "already up to date". (An init in
      the ~1s after the worker launches can race the XAE COM attach — retry once it's steady.)
