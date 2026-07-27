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
reference. A **`ConnectionManager`** owns the merged list across every **`IProjectSource`**, the client **sessions**
and their declared **interests**, the tray's force-off overrides, and the **reconcile loop** that drives the bind
dispatch. The tray menu and the control plane are both thin views over it, and **neither branches on vendor** — the
vendor is a field (for the platform badge + routing), never a UI lane. The whole model lives in the UI-free
`Volt.Cli.Connector.Core` assembly (unit-tested without WinForms).

**Declared desired-state, not imperative connect** (openspec `connector-session-model`). A frontend (a desktop
instance, a VS Code window) opens a **session** and, on every sync, declares the FULL set of projects it is currently
using. The connector computes `desired = ⋃ interests over non-expired sessions \ forceOff` and the pure
**`Reconciler`** turns it into bind/unbind actions. Two rules make it correct against bridges that **serve by
default**: *bind is level-triggered* (resume any wanted project not yet serving) but *unbind is edge-triggered* (gate
a project only when the LAST session using it leaves — the wanted→unwanted edge — or the tray force-offs it). So a
bridge no session ever declared keeps serving (standalone `volt push` and an un-connected neighbour are never cut
off), while closing the last window that used a project gates it. Presence is a **lease** renewed on each sync, so a
crash is the same as a clean leave — its interests just expire.

Because both bridges expose the **same `instances` / `select` / `health` wire ops**, there is exactly one source
implementation — `PipeProjectSource` — parameterized only by pipe + vendor. All the per-vendor attach mechanism
stays behind the wire.

## Two activation archetypes (the load-bearing asymmetry — kept behind the wire)

| archetype | how the bridge attaches | vendors | the connector's job |
|---|---|---|---|
| **ExternalAttach** | a headless worker process attaches to the running IDE via its external API | TwinCAT (COM/DTE) | spawn + supervise the worker |
| **InIdeLoad** | a DLL must load *inside* the IDE (no external API) | CODESYS | **guide** the user to activate it — never launch |

The **data wire is a named pipe** — one `volt.bridge.<vendor>.<pid>` **per running IDE** (both vendors are per-pid;
`PerPipeProjectSource` discovers them all, so multiple IDEs are live at once and their projects serve in parallel).
The `health`, `select`, `deselect`, and sync ops flow over it. There are no HTTP data ports. The only HTTP is the
localhost **control plane on `:8550`**: the session API — `POST /session`, `POST /session/{id}/sync`,
`DELETE /session/{id}` — is the ONLY way to drive serving; `GET /status` is the ambient read of the detected-project
list (the connect picker), and `POST /workers/{id}/restart` respawns a worker. There is no imperative
connect/disconnect.

**Many live hosts, served in parallel.** Every activated CODESYS + every running TwinCAT project is listed; each
serves iff some session declares interest in it (or the tray hasn't force-offed it). The reconciler binds every
wanted project across their independent per-pid pipes at once — no "one active connection". The single narrow limit
is a TwinCAT XAE worker holding ≥2 projects in one solution: that one pipe serves one at a time (the incumbent holds,
siblings report `idle`), which the reconciler honours without thrashing.

**Disconnect is a gate, not a shutdown.** When the last session using a project drops it (or the tray force-offs it),
reconcile sends `deselect` to that project's bridge, which then refuses every sync op with `PLC_DISCONNECTED` until
the next `select`. **Nothing is torn down:** the CODESYS in-proc host stays loaded (the `start_volt_codesys.py`
activation survives), the TwinCAT worker keeps its COM attach, the project stays listed, and reconnecting is just
another declared interest with no IDE restart. The gate has to live on the bridge because **the CLI reaches the pipe
directly and never talks to the connector** — a connector-side flag alone would leave `volt push`/`volt pull` working
after a disconnect (it did, until this existed). The flag is in-memory: restarting the host or the connector resets
it to "serving" (so a connector restart never gates anything — `previouslyWanted` is empty, so there are no leave
edges).

## What it does

- **Tray icon** colour = aggregate connection state: green (connected) · amber (degraded) · orange (up, waiting
  for a project) · grey (nothing running). A vendor with no IDE running never paints a fault colour.
- **Tray menu**: the detected projects (status), "Activate in CODESYS…", Show logs, Exit. Connecting is done from
  the app (the frontends declare interest); the tray is the **supervisor escape hatch** — a serving project row is
  clickable to **force-off** it (pause its bridge regardless of any session's interest, for a stuck bridge), a paused
  row to resume it, and "Resume all Volt sync" clears every force-off at once.
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

## Testing the connection model

`test/Volt.Cli.Connector.Tests` runs the model with no pipes and no tray, CI-runnable in seconds:

- `ReconcilerTests` — the pure planner: `(sessions, forceOff, previouslyWanted, detected, now) → bind/unbind`.
  Edge-triggered gating, the one-project-per-worker limit, force-off, and the anti-thrash convergence invariant.
- `ConnectionManagerTests` — detection, the immutable-`State` concurrency discipline, `Aggregate` (serving ∧ wanted).
- `ConnectionManagerSessionTests` — the session loop end-to-end through fake sources: a Sync declaring an interest
  resumes the project; the union keeps it served until the last session leaves; force-off pauses/resumes.
- `ControlServerTests` — the HTTP edge: the session API (open/sync/close), `GET /status`, `/workers/{id}/restart`,
  and the CSRF guard, over a real loopback `HttpListener`.

The live bridge **gate** itself (deselect refuses sync until the next select, over a real pipe) is covered by
`test/e2e/lifecycle/disconnect-cycle.test.ts`; multi-instance parallelism by `test/e2e/stability/parallel-instances`.
