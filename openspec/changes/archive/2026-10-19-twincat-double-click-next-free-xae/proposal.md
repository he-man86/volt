> Answers the PLC Assist finding of 2026-10-19 (production, `%LOCALAPPDATA%\Volt\logs\twincat-2026-10-19.log`
> 16:48:27): a second `VoltBridgeTwincat.exe` started by double-click picked an XAE another bridge already served, logged
> `twincat bridge FAILED to start on pipe volt.bridge.twincat.<pid> … already served by another process — refusing to start
> a second server …` and exited; the console window vanished before anyone could read why.
>
> No wire change; protocol stays 1. Build FIRST; `bridge-console-says-what-it-serves` follows in the same `Program.cs`.

## Why

The no-argument start (the double-click, `Volt.Ide.Twincat/Program.cs:73-109`) takes `found[0]` (`:96`), served or not,
attaches the STA thread to it (`:115-135`), and only then takes the pipe name (`host.Start()`, `:144`), which throws when
another bridge holds it (`PipeServer.TakeName`, `Volt.Wire/PipeServer.cs:99-114`). Its exits close the console window
with the reason unread: the collision (`:144-150`, log only, exit 3), the 10-minute deadline (`:101-105`, exit 2), and
anything thrown before the host starts.

The scan itself calls every XAE: `RotInstances.TryEnumeratePids` binds each DTE and asks its `MainWindow.HWnd`
(`Ide/RotInstances.cs:104-116`), so one busy XAE stalls the scan of all of them. `BindByPid` already avoids this: it reads
the pid from the ROT display name and never binds another process's DTE (`PickWindow`, `PidInName`, `:65-84`).

## What Changes

Design:

- **Pids from names.** The double-click scan lists XAE pids from the ROT display names (`PidInName`), binding nothing.
  Only an entry whose name states no pid is bound and asked for its window, then released, as `PickWindow` does.
- **Claim before attach.** For each candidate pid in ROT order, the start takes that pid's pipe name
  (`PipeServer.TakeName`, made callable before the server exists; the server then serves under the claim it is given).
  The first pid it can claim is the one it attaches to. A pid whose name is taken is skipped, untouched: no bind, no STA
  work. With `--xae-pid`, the claim also comes first: a taken name exits 3 with the reason in the log, as today, but
  without having attached.
- **All served: say so and keep scanning.** When every open window's name is taken, the console lists each pid with its
  window caption (`Process.GetProcessById(pid).MainWindowTitle`: user32, no COM) as already served by another Volt
  bridge, and the scan continues. It prints again only when that list changes. There is no deadline; closing the window
  stops the bridge.
- **Several free: take the first, name the rest.** The start serves the first claimable window and prints its pid and
  caption, then the other open windows by pid and caption. Those it found taken are marked as served.
- **No silent exit.** Every exit of a no-argument start that the user did not ask for prints its reason and waits for
  Enter. A `--xae-pid` start keeps the log line and a non-zero exit.
- **Testable.** The no-argument start moves out of top-level `Program.cs` into a class with injected parts: the pid
  source, the claim, the caption, the console (writer + Enter), and the wait between scans.

Rejected: probing whether a name is served (`IsServed`) before taking it, because a probe-then-take leaves a race that
the claim itself does not have. Reading the other bridge's `health` to name its solution, because the caption is
already readable without COM or a pipe call.

Not in this change (follow-up): `TryEnumeratePids`, which serves the connector's `--list-xae-pids`, still binds and
calls every DTE.

## Impact

`Volt.Ide.Twincat/Program.cs` and the new start class; `Ide/RotInstances.cs` (pid list from names);
`Volt.Wire/PipeServer.cs` (`TakeName` callable before `Start`, one `MutexName`). Offline tests; one live run on two XAE
windows.
