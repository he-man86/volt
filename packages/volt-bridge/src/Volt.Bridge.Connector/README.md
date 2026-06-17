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

- **Tray icon** colour = aggregate bridge state (green connected · amber degraded ·
  orange no-project · red not-running · grey unknown), read from the same `/health`
  the CLI and VS Code extension consume.
- **Context menu**: per-vendor status + actions (Restart/Stop a worker; "Open CODESYS
  (Volt)" launches CODESYS with `--runscript` so its in-proc bridge auto-loads;
  per-vendor Enable toggle), Open logs, Exit.
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

## Dev

```
dotnet build src/VoltBridge.Connector -c Release
./src/VoltBridge.Connector/bin/Release/net8.0-windows/VoltConnector.exe
```

The shipped bundle (`build-bridges.ps1`) places `VoltConnector.exe`, the worker
binaries, and `codesys-scriptcommands/` together so path resolution is zero-config.

## Status / build order

- [x] Connector shell + supervisor + tray UI + TwinCAT worker (this).
- [ ] CODESYS provider: verify the `--runscript` interactive launch; "open with Volt".
- [ ] Provider abstraction hardening + a small control-plane API (`:8550`) for the
      extension / opencode app to query and manage bridges.
- [ ] Siemens / Allen-Bradley workers (new adapters as providers).
