> Implemented in commit 17a8f26978 (per-instance CODESYS pipes); checkboxes reconciled at archive time.

## 1. Transport: per-instance pipes + discovery (the stable core)

- [x] 1.1 `PipeNames`: add `CodesysInstance(int pid)` → `"volt.bridge.codesys." + pid` and `CodesysPrefix` = `"volt.bridge.codesys."`. Keep `Twincat`; keep `Codesys` as the prefix base only.
- [x] 1.2 New `PipeDiscovery.List(string prefix)`: enumerate `Directory.GetFiles(@"\\.\pipe\")`, strip the path, return names starting with `prefix`; per-entry try/catch (skip un-enumerable names). Returns `[]` on any failure.
- [x] 1.3 Unit test: discovery finds two live servers on distinct instance pipes; `[]` when none; survives an odd pipe name in the namespace.

## 2. CODESYS host: per-pid pipe

- [x] 2.1 `PipeHost.Start`: serve `VOLT_PIPE` if set, else `PipeNames.CodesysInstance(Process.GetCurrentProcess().Id)` — **honoring VOLT_PIPE for the host's OWN pipe keeps the headless dev loop + e2e stable** (fixed pipe name). Report the actual pipe in the start message + `VoltLog`. Per-process `IsRunning` static stays. No cross-process guard.
- [x] 2.2 `CodesysDriver.EnumerateInstances`: keep the single-instance shape but make `InstanceId` the pid (not the constant `"codesys"`) so two hosts are distinguishable end-to-end.

## 3. Connector.Core: discovery source + one active connection

- [x] 3.1 `DetectedProject`: carry the serving `Pipe` (string). `MakeId` already keys by instance — now unique per host.
- [x] 3.2 CODESYS `IProjectSource` → discovery-backed: `EnumerateAsync` = `PipeDiscovery.List` → per pipe `instances`/`health` → one `DetectedProject` per live host (carrying its pipe). `BindAsync`/health target the carried pipe. A wire per pipe, built on demand. TwinCAT `PipeProjectSource` unchanged (single pipe, ROT).
- [x] 3.3 `ConnectionManager`: replace the per-vendor `_selected` dict with a single nullable `Connected` (`DetectedProject?`) — vendor-neutral, one active. `ConnectAsync(project)` sets it (TwinCAT also `select`s the DTE; CODESYS is pipe-addressed, no wire op). New `Disconnect()` clears it (no wire op, no teardown).
- [x] 3.4 Update `SelectedOf`/`Aggregate`/`Connected` consumers to the single-active model; the 4s refresh clears `Connected` when its project is no longer detected (host closed).
- [x] 3.5 **Health shape ripple (the main one):** with per-instance CODESYS there is no single "codesys bridge" health. Move connection state to **per-project** in `ConnectorView.projects` (each carries `connected` + a health-ish state) and report the **active connection's** health as the headline. Keep `bridges[vendor]` populated for TwinCAT/back-compat but drive `boundStatus` (task 6.4) off the project list.

## 4. Connector: control plane + tray

- [x] 4.1 `ControlServer`: `POST /disconnect` (no body) → `ConnectionManager.Disconnect()`. `/status` `ConnectorView` gains each project's `pipe`.
- [x] 4.2 Tray `RebuildConnectMenu`: flat radio list (the one `Connected` checked); clicking switches. Add a **Disconnect** item (enabled when connected). Append IDE version to a label when a vendor has >1 live instance.

## 5. CLI: bound-project → bridge resolution

- [x] 5.1 `Program.cs`: replace fixed `VOLT_PIPE ?? vendor` with a resolver — `VOLT_PIPE` override; CODESYS = discovery (1 live → use it; several → health-match bound `projectName`; 0 → refuse "activate it"; >1 same-name → refuse "close one"); TwinCAT = `volt.bridge.twincat` + `select` the bound instance if needed.
- [x] 5.2 `volt init` path: the shells pass the picked `DetectedProject.pipe` via `VOLT_PIPE`; pure-CLI init resolves via discovery (1 live) or refuses.
- [x] 5.3 Keep `Config.VerifyBinding` as the residual guard; error messages name the ambiguity.
- [x] 5.4 Tests: resolver picks the right pipe with two CODESYS live; refuses on 0 and on 2 same-name.

## 6. volt-control + desktop + VS Code UI

- [x] 6.1 `volt-control/bridge/connector.ts`: `disconnect()` (POST `/disconnect`); `DetectedProject` type gains `pipe`; `initFromProject` sets `VOLT_PIPE` from the project's pipe for the init run.
- [x] 6.2 `volt-control/bridge/cli.ts` (`runVolt`): thread a `VOLT_PIPE` env override through to the `volt` subprocess (init needs it; check `runVolt` currently forwards env).
- [x] 6.3 `volt-control` `boundStatus(root)`: resolve from the project list (bound vendor+name → its `connected`/health) instead of `bridges[vendor]`, so a bound CODESYS workspace reflects its specific instance.
- [x] 6.4 Desktop: `volt:disconnect` IPC + preload + a **Disconnect** button in `shell.html` beside Reconnect (`doDisconnect`).
- [x] 6.5 VS Code: `volt.disconnect` command + `$(debug-disconnect)` button in the sync view + `package.json` contribution.
- [x] 6.6 The `reconnectBound` action I already shipped stays valid (it sets the active connection to the bound project); confirm it still matches with the new per-instance project list.

## 7. Docs + parity + gates

- [x] 7.1 `ARCHITECTURE.md`: CODESYS per-instance pipes + discovery vs TwinCAT single-worker/ROT; one-active-above-the-bridge; asymmetry deliberate.
- [x] 7.2 Connector `README.md`: multiple-live + click-to-switch + Disconnect; pipe-per-instance model.
- [x] 7.3 Update anything hardcoding `volt.bridge.codesys` (VOLT_PIPE in `codesys-pipe.ps1`, e2e, tests) to the per-instance name / discovery.
- [x] 7.4 Gates: `dotnet build Volt.Cli.sln` + `dotnet test` + `bun test` (control) green.

## 8. Live verification (real bridges — user-provided)

Test assets: CODESYS `test/testproject1.project` + `test/CodesysTestProject.project` (run both headless via
`codesys-pipe.ps1`); TwinCAT `project13` + `project14` open in the live IDE.

- [x] 8.1 CODESYS ×2 headless (distinct `VOLT_PIPE` per host, or per-pid): `PipeDiscovery` lists both; connector shows two entries; CLI targets the bound one; two same-named → refuse.
- [x] 8.2 TwinCAT ×2 (project13 + project14): both enumerated via ROT on the one worker; select/switch between them; labels disambiguate.
- [x] 8.3 Cross-platform: switch the single active connection CODESYS↔TwinCAT; Disconnect deselects; every host stays live and re-clickable.
- [x] 8.4 Reinstall smoke-check: connector runs, `Documents\Volt` script unaffected, tray Disconnect + switch behave.

## Known limitations (accepted, documented — not blockers)

- **Shared TwinCAT `_dte`**: the CLI may `select` a different instance on the one worker than the connector's active
  connection, briefly flipping the worker's bound DTE (UI stale until the 4s refresh). No data risk — each op selects
  what it needs; `VerifyBinding` guards mismatch. Concurrent TwinCAT ops in two workspaces at the exact same instant
  can race on `_dte`; the bridge's activeOp/busy signal serializes ops in practice.
- **Two CODESYS with the same project name**: the CLI refuses (can't disambiguate by name) rather than guess. The
  connector UI still lists both (pid differs) so the user can pick.
