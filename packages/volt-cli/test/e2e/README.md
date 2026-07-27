# Live-bridge e2e — running it

This suite drives a **live IDE bridge** over the named pipe (the same wire the CLI uses). It is a **local tier**,
not CI: it needs a real CODESYS or TcXaeShell running, so it can't run headless on a build agent. The *same* suite
runs against either vendor — a pass on one and a fail on the other is a real parity bug, not an expected difference.
Tests provision their own `VltE2E_*` items and clean them up, so they never depend on ambient project content.

**Pick a vendor with `VOLT_VENDOR`; the harness does the rest.** It **discovers the live per-pid pipe** by prefix
(so an IDE that restarts with a new pid is followed — no need to hunt for `volt.bridge.<vendor>.<pid>`), and
`requireHealthy()` **selects the detected project and waits for it to serve** (CODESYS serves its project by default;
a TwinCAT XAE starts every project `idle` and must be told which to serve — the harness does that). `VOLT_PIPE` still
overrides for a specific pipe/prefix. One command per vendor:

```bash
bun run test:e2e:codesys      # = VOLT_VENDOR=codesys bun test test/e2e
bun run test:e2e:twincat      # = VOLT_VENDOR=twincat bun test test/e2e
```

## Fixtures (committed, deterministic)

Instead of running against whatever you happen to have open, the suite targets committed fixture projects under
`packages/volt-cli/test/`:

| Fixture | Vendor | Use |
|---|---|---|
| `CodesysTestProject.project`, `testproject1.project` | CODESYS | single / multi-instance |
| `TwinCAT Project13/`, `TwinCAT Project14/` | TwinCAT | single / **multi-XAE** |

The TwinCAT fixtures are committed **source-only** — a `test/.gitignore` strips the regenerated build cache
(`_CompileInfo`, `_Boot`, `_Libraries`), which is ~140 MB. TwinCAT re-resolves system libraries and rebuilds on open.

## CODESYS

`scripts/codesys-pipe.ps1` loads the in-proc pipe host into CODESYS against a **copy** of the fixture (never your
live IDE). Two modes:

```powershell
# headless (fast dev/CI-ish loop) — no window, --noUI
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up
# GUI — production-like: the real IDE, the same in-proc host a user activates via "Activate in CODESYS"
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Ui
# multiple instances (per-pid pipes): -Instance a / -Instance b
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up -Instance a
pwsh packages/volt-cli/scripts/codesys-pipe.ps1 down          # (add -Instance a to stop that one)

bun run test:e2e:codesys   # discovers the live codesys pipe + runs the suite
```

## TwinCAT

TwinCAT has **no in-proc host and no headless mode** (TcXaeShell is Visual-Studio-based). The connector's
`VoltBridgeTwincat` worker attaches to whatever XAE windows are running over the COM ROT, so the launcher only
*opens* the fixtures:

```powershell
pwsh packages/volt-cli/scripts/twincat-instances.ps1 up            # both fixtures = the multi-XAE scenario
pwsh packages/volt-cli/scripts/twincat-instances.ps1 up -Which 13  # just one
pwsh packages/volt-cli/scripts/twincat-instances.ps1 down          # close the ones it opened

# TcXaeShell takes ~30-60s to load; the runner discovers the pipe + selects the project + waits, so just:
bun run test:e2e:twincat
```

**One-time build per fixture.** The committed fixtures ship source-only (no `_CompileInfo`), so a freshly-opened
one isn't fully serveable until it's built: **Build → Build Solution** in TcXaeShell once after opening. Until then
the DTE registers but the PLC project isn't fully accessible; `requireHealthy()` selects it and waits, and if it
never serves within 60s the suite fails with a clear message ("selected it but it stayed idle — is the IDE still
loading?"). The connector must be running (it supervises the worker).

## A note on TwinCAT stability

TcXaeShell is an out-of-process COM automation target and is **best-effort by nature** — a window can go busy,
re-register its DTE (the ROT moniker is ephemeral), drop a call with `0x800706BA`, or even close on its own. The
bridge is built to survive this: it recovers a selection by **stable project name** (not the ephemeral moniker),
retries a transient read once after re-acquiring, and otherwise refuses cleanly with `PLC_DISCONNECTED` + a full ROT
diagnostic in the log (`%LOCALAPPDATA%\Volt\logs\twincat-*.log`). If a run flaps, it's the IDE, not the bridge —
restart the XAE windows for a clean multi-XAE environment. `library-signature` tests are CODESYS-only
(`skipIf twincat`): TwinCAT has no signature-extraction surface yet (a tracked parity gap).
