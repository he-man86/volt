# Volt Connector

The **single user-facing Volt app**: a Windows system-tray supervisor over one connection model. One install,
one tray icon, one menu — and behind it, however many vendor bridges you need, each reached over its own named
pipe.

```
┌─ Volt Connector ── tray icon · menu · toasts · control plane (:8550) ────────┐
│                                                                              │
│   ConnectionManager  ── one vendor-neutral model ──                          │
│     merged project list · selection · aggregate status                       │
│        ▲                         ▲                                            │
│        │ IProjectSource          │ IProjectSource   (same instances/select/  │
│        │                         │                   health wire — no vendor  │
│   [TwinCAT pipe]            [CODESYS pipe]            branch above it)         │
│   volt.bridge.twincat      volt.bridge.codesys                                │
│        ▲                         ▲                                            │
│   spawns + supervises       user activates in-proc                           │
│   [VoltBridgeTwincat.exe]   (Tools → Scripting → start_volt_codesys.py)               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## The connection model

Everything the surface shows is a **`DetectedProject`** — display name, vendor, dirty, and an opaque attach
reference. A **`ConnectionManager`** owns the merged list across every **`IProjectSource`**, the current
selection, the bind dispatch, and the aggregate status. The tray menu and the control plane are both
thin views over it, and **neither branches on vendor** — the vendor is a field (for the platform badge +
routing), never a UI lane. The whole model lives in the UI-free `Volt.Cli.Connector.Core` assembly (unit-tested
without WinForms).

Because both bridges expose the **same `instances` / `select` / `health` wire ops**, there is exactly one source
implementation — `PipeProjectSource` — parameterized only by pipe + vendor. All the per-vendor attach mechanism
stays behind the wire.

## Two activation archetypes (the load-bearing asymmetry — kept behind the wire)

| archetype | how the bridge attaches | vendors | the connector's job |
|---|---|---|---|
| **ExternalAttach** | a headless worker process attaches to the running IDE via its external API | TwinCAT (COM/DTE) | spawn + supervise the worker |
| **InIdeLoad** | a DLL must load *inside* the IDE (no external API) | CODESYS | **guide** the user to activate it — never launch |

The **data wire is a named pipe** — `volt.bridge.twincat` (one worker, ROT-multiplexed) and one
`volt.bridge.codesys.<pid>` **per running CODESYS** (`CodesysProjectSource` discovers them all, so multiple IDEs
are live at once). The `health`, `instances`, `select`, `deselect`, and sync ops flow over it. There are no HTTP data ports.
The only HTTP is the localhost **control plane on `:8550`** (orchestration only: `/status`, `/connect`,
`/disconnect`, `/workers/{id}/restart`).

**One active connection, many live hosts.** Every activated CODESYS + every running TwinCAT project is listed and
clickable; clicking makes it the ONE active connection (vendor-neutral), so switching is just another click. A
vendor with >1 live instance shows the IDE version in the label.

**Disconnect is a gate, not a shutdown.** It sends `deselect` to that project's bridge, which then refuses every
sync op with `PLC_DISCONNECTED` until the next `select` — and clears the selection. **Nothing is torn down:** the
CODESYS in-proc host stays loaded (the `start_volt_codesys.py` activation survives), the TwinCAT worker keeps its
COM attach, the project stays listed, and reconnecting is just another connect with no IDE restart. The gate has
to live on the bridge because **the CLI reaches the pipe directly and never talks to the connector** — a
connector-side flag alone would leave `volt push`/`volt pull` working after you pressed Disconnect (it did, until
this existed). The flag is in-memory: restarting the host or the connector resets it to "serving".

## What it does

- **Tray icon** colour = aggregate connection state: green (connected) · amber (degraded) · orange (up, waiting
  for a project) · grey (nothing running). A vendor with no IDE running never paints a fault colour.
- **Tray menu**: quick actions — "Connect to" (the same unified list), "Activate in CODESYS…", Show logs, Exit.
- **CODESYS activation is guided, never driven.** The connector does not launch any IDE. "Activate in CODESYS…"
  copies the `start_volt_codesys.py` path to the clipboard and shows the steps (Tools → Scripting → Execute Script
  File); once the user runs it, the in-proc host serves the pipe and the project appears in the list.
  On startup the connector publishes `start_volt_codesys.py` to a **visible `Documents\Volt\`** folder (so it's reachable
  in the file dialog without un-hiding AppData); the install-dir copy under `codesys-scriptcommands\` stays as a
  backup, and both find the bridge DLLs in the install dir via `%LOCALAPPDATA%`. The activation dialog shows both
  paths.
- **Project selection is a wire op.** Picking a project sends `select` to its bridge (TwinCAT re-resolves on the
  live DTE; CODESYS confirms its primary) — no worker respawn, no target env. On connect, the notification
  **names the platform** ("Connected to MyMachine (CODESYS)").
- **Supervises**: spawns the ExternalAttach workers on start, respawns on crash, kills its own child tree on
  exit (never a broad process-name kill — that could take down a live IDE).
- **Single-instance** (a named mutex) so two connectors don't fight over the bridges.

## Config (env overrides)

| var | purpose |
|---|---|
| `VOLT_TWINCAT_BRIDGE` | path to `VoltBridgeTwincat.exe` (else: next to the connector, then the dev build output) |
| `VOLT_CODESYS_SCRIPT` | path to `start_volt_codesys.py` (overrides the published `Documents\Volt\` + install-dir copies the "Activate" action points at) |
| `VOLT_BRIDGE_DLL` | path to `Volt.Cli.Ide.Codesys.dll` (overrides `start_volt_codesys.py`'s own resolution for a custom install dir) |

Data wire: named pipes — `volt.bridge.twincat`, `volt.bridge.codesys`. Control plane: HTTP `127.0.0.1:8550`.

## Diagnostics & logs

Every Volt component writes to ONE durable store — **`%LOCALAPPDATA%\Volt\logs`** — in daily per-source files
(`connector-<date>.log`, `twincat-<date>.log`, `codesys-<date>.log`, …). Lines are `[timestamp][source][level]
message`. The bridges log via Core's zero-dependency `VoltLog`; the connector via its own tiny `Log` (same
location + format). A deliberate ~50-line file logger, not a framework.

- **Show logs** — a live, filterable window over that store.

## Dev

```
dotnet build src/Volt.Cli.Connector -c Release
./src/Volt.Cli.Connector/bin/Release/net8.0-windows/VoltConnector.exe
```

`build-cli.ps1` places `VoltConnector.exe`, the worker binaries, and `codesys-scriptcommands/` together so path
resolution is zero-config. The UI-free model + its tests live in `Volt.Cli.Connector.Core` /
`test/Volt.Cli.Connector.Tests`.

## Testing the connection lifecycle

`test/Volt.Cli.Connector.Tests` runs the real model over **real named pipes** with only the IDE faked — no CODESYS,
no tray, CI-runnable in seconds. The parity boundary is the pipe wire, so a live `BridgePipeHost` on a real pipe
reproduces every state a real IDE can put the connector in; a headless CODESYS would only add confidence in the
vendor glue *below* the wire, which is `test/e2e`'s job.

- `CodesysSourceLiveTests` — multi-instance discovery: N live hosts, each on its own pipe, connect/switch, and a
  host closing mid-session (dropped + deselected).
- `DisconnectLifecycleTests` — connect/disconnect/reconnect asserted from **both sides after every transition**:
  the connector's view (`ConnectionManager`) *and* a raw `PipeClient` standing in for the CLI, which reaches the
  bridge directly and never consults the connector. That second assertion is the point — it is what catches the
  bug this gate exists for (Disconnect left `volt push` working). Also covers: disconnecting one host leaves its
  neighbours serving, *switching* is not a disconnect, a disconnected host that then closes is dropped normally,
  disconnecting an already-dead bridge is silent, and disconnect is idempotent.

When changing anything in this area, verify the tests are **red without the fix** — comment out the `_paused` gate
in `BridgePipeHost.Dispatch` and three of them must fail.
