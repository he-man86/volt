## Why

The bridge does not recover cleanly across a project lifecycle transition (close project → reopen, switch
project) while the IDE stays open. Observed in the field: after close/reopen the bridge state doesn't come back
right every time.

Root cause (TwinCAT): liveness is checked at the **DTE level only**. `TcObjectModel.ProbeIdeAlive` (`:155-160`)
succeeds as long as `_dte.Solution.Count` is readable — i.e. the IDE process is alive — and the reconnect path
in `BeckhoffDriver.TriggerAsyncProbe` (`:64-82`) only calls `Connect()` when `!IsAttached` (the DTE is gone). So
when the user closes the *project* but leaves the IDE open:

- `_dte` stays alive → `ProbeIdeAlive()` = true → the probe never reconnects;
- `_sysManager` / `_plcProjectPath` are now **stale references to a torn-down project**, but `IsConnected`
  (`_dte && _sysManager && _plcProjectPath != null`) still returns true → `/health` reports "connected" with the
  old project name;
- a data call into the stale COM throws and degrades, but `Disconnect()` only fires when `!alive` (DTE gone), so
  the project is never re-resolved;
- on reopen, nothing re-runs `FindTwinCatProject` / `FindPlcProject` → recovery is incomplete.

The in-proc CODESYS bridge shares the shape of this risk (session references going stale across a project
close/open); it must be verified and fixed for parity.

## What Changes

- **Project-aware liveness.** The probe SHALL validate the *project* is still open and valid (touch
  `_sysManager` / the PLC node), not just that the DTE responds. When the project is gone, the driver reports a
  distinct `no-project` state rather than a false "connected".
- **Soft re-resolve on transition.** On a project close/switch with the IDE still alive, invalidate the stale
  project references (`_sysManager` / `_plcNode` / `_plcProjectPath`) **while keeping the DTE**, and re-resolve
  the project on the next probe — so a reopen (or a switch to the selected target) reconnects cleanly without
  needing the IDE itself to restart.
- **Distinguish transient/busy from gone.** An IDE mid-build / modal / reload should surface as
  degraded-retry, not as a stale "connected" nor a hard failure (leaning on the existing `ShouldMarkDegraded`
  RPC-HRESULT policy), so pull/push don't read half-state.
- **CODESYS parity.** Verify and fix the in-proc bridge's behavior across project close/open (its session
  references / project handle must re-resolve the same way).

## Impact

- `packages/volt-bridge` Beckhoff — `Ide/TcObjectModel.cs` (`ProbeIdeAlive` becomes project-aware; a soft
  re-resolve that keeps `_dte`), `Driver/BeckhoffDriver.cs` (probe/reconnect + health state mapping).
- `packages/volt-bridge` CODESYS in-proc — the equivalent project-lifecycle handling (events or per-probe
  re-resolve).
- `Volt.Bridge.Core` — if the `no-project` / busy state distinction is expressed in the shared health mapping,
  it stays vendor-neutral (parity).
- Interacts with `connector-attach-and-tray-ux`: the `no-project` state defined here is what the tray shows when
  nothing is selected, and re-selection drives the re-resolve.
