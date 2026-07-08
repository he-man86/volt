## Why

When something breaks at a customer site there is **no single artifact to ask for**. Logs are scattered and
fragile: worker stdout/stderr → `%TEMP%\volt-connector` (OS-cleaned, no timestamps, no rotation —
`BridgeSupervisor.cs:25,130`); the in-proc CODESYS bridge `Console.WriteLine` → effectively lost inside the IDE;
the `volt-git` CLI → stderr, captured by `volt-control` but not persisted; the LSP → the editor's output channel.
There is no leveled logging, no rotation, and no "collect diagnostics" action. Supporting a field user is
guesswork — this change gives them one file to send and gives us a real logging seam to write to.

## What Changes

- **One durable log location**: `%LOCALAPPDATA%\Volt\logs\` (survives reboot, unlike `%TEMP%`). Per-source daily
  files (`connector-YYYY-MM-DD.log`, `twincat-…`, `codesys-…`, `cli-…`), pruned after ~14 days. Every line
  prefixed `[timestamp][source][level]`.
- **A proper logging seam, not a reinvented one — respecting the `netstandard2.0`-in-CODESYS constraint**
  (`Volt.Bridge.Core.csproj:6`; Core loads inside CODESYS's net48 IronPython host):
  - `Microsoft.Extensions.Logging.Abstractions` (`ILogger`) as the seam in `Volt.Bridge.Core` — canonical .NET,
    netstandard2.0, **abstractions-only**, so it is safe to load in-proc without fighting the host's assembly
    loader. Every Core log point goes through `ILogger`, so both vendors log identically (**parity**).
  - A small rolling-file provider (`NReco.Logging.File`, netstandard2.0, minimal deps) wired in each *standalone*
    host (Beckhoff worker, Connector) — don't reinvent rotation/levels.
  - The in-proc CODESYS host is the one assembly-binding risk. Use the same provider there if it loads clean;
    otherwise a ~20-line custom `ILoggerProvider` writing to the same dir behind the same `ILogger` seam — nothing
    else changes. (Serilog is deliberately rejected: heaviest transitive graph = worst for the in-proc case.)
- **A "Collect diagnostics" action** (tray + control-plane + VS Code command) that zips the log dir plus a
  snapshot — every `/health`, the connector `/status`, `wireVersion` + app versions, OS/IDE versions — to a
  timestamped `volt-diagnostics-<ts>.zip` on the Desktop. **This is the one file to ask a user for.**
- **A log window in the Connector itself** — no extra renderer layer (deliberately not surfaced through
  `volt-control` / `volt-app` / `volt-vscode`; that's not the ROI). Opened from the tray menu ("Show logs"), a
  WinForms window with a live tail, filter by source + severity, search, colors matching the tray status palette,
  and the Collect button in its toolbar. The one user-facing Volt app owns its own logs surface.

This is also the **delivery vehicle** for the existing `bridge-diagnostics-observability` change: its structured
skip/`.unknown` report lands in the `/fetch` response, the CLI logs it, and it rides along in the zip.

## Impact

- `packages/volt-bridge` — Core: an `ILogger` seam + a shared `VoltLog` helper; Connector/Beckhoff: the
  rolling-file provider + write to `%LOCALAPPDATA%\Volt\logs`; `BridgeSupervisor.cs` (log dir + timestamps +
  rotation); a new WinForms **log window** in the Connector + a "Show logs" / "Collect diagnostics" tray item;
  in-proc CODESYS host wiring. All within `volt-bridge` — no other package changes.
- **Dependency**: `bridge-diagnostics-observability` (its report becomes a log source and a zip payload).
- New NuGet deps (`Microsoft.Extensions.Logging.Abstractions`, `NReco.Logging.File`) — verify they load inside
  the CODESYS net48 host before committing to them there.
