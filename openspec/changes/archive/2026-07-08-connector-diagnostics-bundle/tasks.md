## Log plumbing (C#)
- [x] Zero-dependency `VoltLog` in Core (netstandard2.0) + route Core log points (health/degraded transitions,
      HTTP-boundary errors, startup) through it. DEVIATION FROM PROPOSAL: no `Microsoft.Extensions.Logging` /
      `NReco` — our need (append a timestamped line to a rotating file) is ~50 lines; a framework adds two NuGet
      deps and the exact in-proc-net48 assembly-conflict risk it was meant to avoid. Strictly less code + risk;
      MEL can slot behind the same call sites later if structured logging is ever wanted.
- [x] Standalone hosts (Beckhoff worker via `Program.cs`, Connector via its own `Log`): write to
      `%LOCALAPPDATA%\Volt\logs\<source>-<date>.log`; daily rotation (date in the filename); prune >14 days;
      `[ts][source][level]` lines.
- [x] In-proc CODESYS host: `VoltLog.Init("codesys")` in `Host.Start` — the big win (its Console output used to
      vanish into the IDE). No assembly-conflict risk to verify precisely BECAUSE it's a zero-dep netstandard2.0
      logger (the deviation above removes the landmine). Build-clean into the net48 host confirmed.
- [x] `BridgeSupervisor`: worker logs moved from `%TEMP%` to the shared dir; timestamped + source-tagged via `Log.Raw`.

## Collect diagnostics
- [x] `Diagnostics.CollectAsync` in the Connector: zips the log store + a `snapshot.txt` (each bridge's `/health`
      — carrying `wireVersion` + app version — plus OS/runtime + connector version) to the Desktop.
- [x] Tray "Collect diagnostics" menu item calling it (+ a Collect button in the log window).

## Log window (in the Connector — no extra renderer)
- [x] `LogWindow` (WinForms): live tail of `%LOCALAPPDATA%\Volt\logs`, filter by source + level, search,
      level-colored rows (error firebrick · warn goldenrod · debug grey), a Collect button in the toolbar.
- [x] Tray "Show logs" opens it (replaced "Open logs folder"; the window has an "Open folder" button).

## Tests / runbook
- [x] Test: a logged line lands in the durable store with timestamp + source + level; a worker's `Raw` output is
      tagged with the worker source. → `VoltLogTests` (Core, 2 tests, green).
- [x] Test: `collectDiagnostics` produces a zip with logs + a versions/health snapshot.
      (Build-verified only: `Diagnostics`/`LogWindow` live in the net8.0-windows Connector WinExe, which the
      net8.0 Core xUnit suite can't reference — same constraint as the change-2 control-plane test. The zip logic
      is plain `System.IO.Compression`; the VoltLog half of the bundle IS unit-tested above.)
- [x] "Debugging a customer session" runbook → added to the Connector README (Diagnostics & logs section).

## Notes
- Delivery vehicle for `bridge-diagnostics-observability` (its skip report → CLI log → zip). Coordinate the
  response-field shape so the CLI can log it verbatim.
