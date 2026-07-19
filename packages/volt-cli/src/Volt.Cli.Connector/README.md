# Volt Connector

The **single user-facing Volt app**: a Windows system-tray supervisor that owns every
vendor bridge. One install, one tray icon, one settings surface — and behind it,
however many bridges you need, each running isolated.

```
┌─ Volt Connector ── the ONE tray app (icon · menu · toasts) ──────────────┐
│   spawns + supervises ↓        ↓                ↓                         │
│   [twincat worker]    [siemens worker]   [allen-bradley worker]  (headless)│
│   launches + monitors ↓                                                   │
│   CODESYS (in-proc bridge, loaded via --runscript)                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## Two activation archetypes (the only structural axis)

| archetype | how the bridge attaches | vendors | the connector's job |
|---|---|---|---|
| **ExternalAttach** | a headless worker process attaches to the running IDE via its external API | TwinCAT (COM/DTE), Siemens (Openness), Allen-Bradley (LDSDK) | spawn + supervise the worker |
| **InIdeLoad** | a DLL must load *inside* the IDE (no external API) | CODESYS | launch the IDE with the in-proc loader, monitor the port |

The connector only ever speaks the **HTTP wire** (`/health`) to its workers — never
their internal SDK/adapter shape. That's why the tray app stays identical no matter
how different the vendors get, and why adding a vendor is just a new `VendorProvider`
descriptor + a worker binary.

## What it does

- **Tray icon** colour = aggregate bridge state: green (something connected) · amber
  (a live channel degraded) · orange (up, waiting for a project) · grey (nothing
  running / vendor not in use). A vendor with no IDE running is **neutral grey, never a
  fault colour** — that's why there's no per-vendor "enable" toggle: an unused vendor
  simply doesn't alarm. Read from the same `/health` the CLI and VS Code extension consume.
- **Context menu**: per-vendor status + actions — for TwinCAT, **"Connect to" picks the
  instance/project** (Restart/Stop the worker); for CODESYS, "Open CODESYS (Volt)"
  launches it with `--runscript` so its in-proc bridge auto-loads. **Show logs**,
  **Collect diagnostics**, Exit.
- **Project selection is explicit (TwinCAT).** The worker never auto-attaches to an
  arbitrary open project — with nothing selected it stays unattached and reports
  "no project loaded" (orange). The user picks from "Connect to". For tests/dev a target
  can be forced non-interactively via `VOLT_TC_INSTANCE`/`VOLT_TC_PROJECT`/`VOLT_TC_PLC`
  env or the control-plane `POST /bridges/{id}/select`.
- **Balloon toasts** on state changes ("TwinCAT bridge not running", "… connected").
- **Supervises**: spawns workers on start, respawns on crash, kills its own child tree
  on exit (never a broad process-name kill — that could take down a live IDE).
- **Single-instance** (a named mutex) so two connectors don't fight over the bridges.

## Config (env overrides for now; a JSON next to the exe later)

| var | purpose |
|---|---|
| `VOLT_TWINCAT_BRIDGE` | path to `BeckhoffBridge.exe` (else: next to the connector, then the dev build output) |
| `VOLT_CODESYS_EXE` | path to `CODESYS.exe` |
| `VOLT_CODESYS_SCRIPT` | path to `start_bridge.py` passed to `--runscript` |

Ports: TwinCAT `8555`, CODESYS `8556` (Siemens `8557`, Allen-Bradley `8558` reserved).

## Diagnostics & logs

Every Volt component writes to ONE durable store — **`%LOCALAPPDATA%\Volt\logs`** — in daily per-source files
(`connector-<date>.log`, `twincat-<date>.log`, `codesys-<date>.log`, …), pruned after 14 days. Lines are
`[timestamp][source][level] message`. The bridges log via Core's zero-dependency `VoltLog`; the connector via its
own tiny `Log` (same location + format — it stays Core-free by design). This is a deliberate ~50-line file logger,
not a logging framework: our need is "append a line to a rotating file", and a framework would only add
dependencies and risk assembly conflicts inside the in-proc CODESYS (net48) host.

- **Show logs** — a live, filterable window (by source + level, searchable) over that store, with a Collect button.
- **Collect diagnostics** — zips the whole log store plus a snapshot (each bridge's `/health`, which carries its
  wire + app version, the OS/runtime, and the connector version) to `volt-diagnostics-<stamp>.zip` on the Desktop.

### Runbook — debugging a customer bridge session

1. Ask the customer for **one file**: tray → **Collect diagnostics** → the `volt-diagnostics-*.zip` on their Desktop.
2. Open `snapshot.txt` first: it shows each bridge's `/health` — `connected`/`degraded`/`degradedReason`, the
   attached project, and the **`wireVersion`** (a mismatch vs. the shipped client is the "stale bridge" class).
3. Read `logs/<source>-<date>.log`: `degraded:` lines carry the reason (e.g. "no project selected"), `error` lines
   carry stack traces from the HTTP boundary. The in-proc CODESYS bridge now logs here too (previously lost).

## Dev

```
dotnet build src/Volt.Cli.Connector -c Release
./src/Volt.Cli.Connector/bin/Release/net8.0-windows/VoltConnector.exe
```

The shipped bundle (`build-bridges.ps1`) places `VoltConnector.exe`, the worker
binaries, and `codesys-scriptcommands/` together so path resolution is zero-config.

## Status / build order

- [x] Connector shell + supervisor + tray UI + TwinCAT worker (this).
- [ ] CODESYS provider: verify the `--runscript` interactive launch; "open with Volt".
- [ ] Provider abstraction hardening + a small control-plane API (`:8550`) for the
      extension / opencode app to query and manage bridges.
- [ ] Siemens / Allen-Bradley workers (new adapters as providers).
