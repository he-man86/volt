## Why

Today every CODESYS bridge serves the single shared pipe `volt.bridge.codesys`, guarded only by a
per-process static. If the activation script runs in two CODESYS instances, **both bind the same pipe** and a
client (`volt pull`/`push`, or the connector) is routed to an *arbitrary* one — so a push can silently land in the
wrong live IDE. This is a data-integrity bug. The product must let the user run the script in **multiple CODESYS
projects and have multiple TwinCAT projects running at once**, while keeping exactly **one project "really
connected"** (the active sync target) at a time — and be able to disconnect/switch cleanly.

## What Changes

- **BREAKING (wire): CODESYS bridges use a per-instance pipe** `volt.bridge.codesys.<pid>` instead of the shared
  `volt.bridge.codesys`. Multiple CODESYS hosts coexist without colliding. (TwinCAT keeps its single worker pipe
  `volt.bridge.twincat` — one worker already multiplexes every running project via the COM Running Object Table.)
- **Pipe discovery**: a helper enumerates `\\.\pipe\volt.bridge.codesys.*` to find every live CODESYS bridge
  (self-cleaning — pipes die with their process; no registry/coordination file).
- **Connector fan-out**: the CODESYS project source discovers all live pipes and lists **one entry per running
  CODESYS** in the unified "Connect to" list; each `DetectedProject` carries the pipe that serves it.
- **One-connected model + Disconnect**: the connection model stays one selected project per vendor. A new
  **Disconnect** action (tray "Connect to" menu + desktop/VS Code UI) clears the active selection so the user can
  switch. CODESYS disconnect optionally stops that instance's in-proc host (frees its pipe); TwinCAT disconnect
  deselects the DTE (worker stays).
- **CLI op-time resolution**: `volt pull/push/status/build` resolve the **target bridge from the bound project**,
  not a fixed pipe — for CODESYS by matching the bound project name against each live pipe's health; for TwinCAT by
  selecting the bound instance on the worker. Absent or ambiguous (two IDEs with the same project open) → **refuse
  loudly**, never guess. `VOLT_PIPE` still overrides for dev/tests.
- **UI**: instance labels gain the IDE version when a vendor has more than one instance (so two same-named projects
  across CODESYS/VS versions are distinguishable).
- **No start-guard**: explicitly NOT refusing a second host — running the script in several IDEs is a supported
  workflow, made safe by per-instance pipes rather than prevented.

## Capabilities

> Per this repo's convention (CLAUDE.md), load-bearing invariants live in the package docs
> (`packages/volt-cli/ARCHITECTURE.md`, the connector `README.md`), not a parallel `specs/` tree. This change
> updates those docs rather than creating `openspec/specs/**` files.

### New Capabilities
- (none — no new `openspec/specs` capability tree; behavior is documented in the package docs)

### Modified Capabilities
- (none at the `openspec/specs` level)

## Impact

- **Transport** (`Volt.Cli.Transport`): `PipeNames` (per-instance name), new `PipeDiscovery`.
- **CODESYS host** (`Volt.Cli.Ide.Codesys`): `PipeHost` binds a per-pid pipe, gains `Stop()`; `start_pipe.py`
  unchanged (DLL resolution already covers it).
- **Wire** (`Volt.Engine/Wire`): `BridgePipeHost` gains a `disconnect` op; `IIdeDriver`/`DriverBase` gain
  `Disconnect()`.
- **Connector.Core**: `IProjectSource`/`PipeProjectSource` (discovery + per-instance targeting), `DetectedProject`
  carries the pipe, `ConnectionManager.DisconnectAsync`.
- **Connector**: `ControlServer` `/disconnect`; tray "Disconnect" menu item; instance-aware labels.
- **CLI** (`Volt.Cli`): bound-project → bridge resolution in the pull/push/status/build path.
- **volt-control / desktop / VS Code**: `disconnect` client + UI button (parity with the Reconnect button).
- **Docs**: `ARCHITECTURE.md` (pipe-per-instance CODESYS, single-worker TwinCAT), connector `README.md`.
- **Tests**: transport discovery, connector fan-out + disconnect, CLI resolution (absent/ambiguous refuse).
