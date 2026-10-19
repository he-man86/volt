> Answers the PLC Assist finding of 2026-10-19 (production test of 0.1.17884): the TwinCAT bridge console names neither
> the solution it serves nor whether the relay took it; both are only in `%LOCALAPPDATA%\Volt\logs\twincat-<date>.log`.
> The CODESYS start line has the same gap.
>
> No wire change; protocol stays 1. Builds AFTER `twincat-double-click-next-free-xae` (same `Program.cs`).

## Why

For a double-click start the console window is the bridge's whole user interface, but everything that says what the
bridge serves goes to `VoltLog`, which writes files only (`Volt.Contracts/VoltLog.cs`): the served solution
(`Ide/TcObjectModel.Session.cs:68`, `:128`), an XAE the worker cannot read (`driver.Unsupported`, DIALECT C2t,
`Program.cs:128`), and every relay state (`Volt.Relay/RelayTunnel.cs:203`, `:216`, `:250`).

Two lines say what is not true:

- `Program.cs:155` prints "Bridge connected to TwinCAT" once the pipe is up, whatever the attach did.
- `RelayTunnel` logs `relay: connected to <host>` when the socket opens (`:250`), before the relay has accepted
  anything; acceptance is the first inbound frame (`_accepted`, `:291`).

One state says nothing: `PipeHostTunnel.StartIfConfigured` returns null without a line when no relay is configured
(`Volt.Relay/PipeHostTunnel.cs:42`).

CODESYS prints one line into its message window at start (`Volt.Ide.Codesys/PipeHost.cs:86-89`); it names neither the
project (`CodesysDriver.ServedProjectName`) nor the relay, nor where the log is.

## What Changes

- **TwinCAT, no-argument start: the log is teed to the console.** Every `VoltLog` line at Info and above is also written
  to the console. That prints the served solution and its changes, `Unsupported`, every relay state with its reason and
  next dial, and start failures, in the words the log already uses. Under `--xae-pid` the tee is off: the connector
  already captures the worker's stdout into the log (`Volt.Connector.Core/BridgeSupervisor.cs:76-77`), so a tee there would
  write every line twice.
- **The pipe-up line says only what is true.** `Program.cs:155` becomes a line stating that the pipe is up and that
  closing the window stops the bridge. It claims no connection to TwinCAT or to the relay.
- **Relay "connected" means accepted.** `RelayTunnel` logs `relay: connected to <host>` on the first inbound frame of a
  connection (when `_accepted` turns true), once per connection; opening the socket is no longer reported as connected.
- **No relay is a line.** `PipeHostTunnel.StartIfConfigured` logs `relay: not configured` through its existing `logInfo`
  when there is no sidecar and no setup code.
- **CODESYS start line** (`PipeHost.cs:89`) adds the served project (`ServedProjectName`), the relay state at start
  (`dialing <host>`, `not configured`, or that it did not start), and `VoltLog.Dir`, where later relay states are.

Per-op relay lines (`relay: <- op`, `RelayTunnel.cs:333`, and its `->` pair, `:405`) are Info and so reach the console;
if the live run shows them noisy, they move to Debug (task 3.1). The default is: every Info line is shown.

Rejected: a separate relay-state observer with its own console strings, because the `log` parameter `RelayTunnel` and
`StartIfConfigured` already take is that observer, and the tee shows it. Writing into the CODESYS Messages view, because
the start line names the log directory and no measured API is needed for it.

## Impact

`Volt.Contracts/VoltLog.cs` (a console tee, off by default); `Volt.Ide.Twincat/Program.cs` (or the start class from
`twincat-double-click-next-free-xae`); `Volt.Relay/RelayTunnel.cs`, `PipeHostTunnel.cs`; `Volt.Ide.Codesys/PipeHost.cs`.
Offline tests.
