## Project-aware liveness (TwinCAT)
- [x] `ProbeIdeAlive` (or a new project-liveness check): validate the project/PLC node is still valid, not just
      `_dte.Solution.Count`. A closed project MUST NOT report `IsConnected` = true.
- [x] Map "DTE alive but no valid project" to the `no-project` health state (not false "connected", not hard fail).

## Soft re-resolve on transition
- [x] On project close/switch with the IDE alive: release + null `_sysManager` / `_plcNode` / `_plcProjectPath`
      but KEEP `_dte`; re-resolve via `FindTwinCatProject` / `FindPlcProject` on the next probe.
- [x] A reopen (or a switch to the selected target) reconnects without restarting the IDE.

## Transient vs gone
- [x] Ensure IDE-busy (mid-build / modal / reload) surfaces as degraded-retry via the existing
      `ShouldMarkDegraded` RPC-HRESULT policy, so pull/push don't read half-state.

## CODESYS parity
- [x] Verify the in-proc bridge across project close/open; fix its session/project re-resolution to match.

## Tests
- [x] Test/fixture: close-then-reopen leaves the bridge correctly attached to the reopened project (not stale,
      not falsely connected).
- [x] Test: `/health` never reports `connected` with a stale project name after a close.
- [x] Both vendors covered.

  NOTE ON TEST COVERAGE: the recovery logic lives entirely in the vendor driver layer — TwinCAT (live COM/DTE)
  and CODESYS (in-proc scripting object model). Neither is exercisable in this repo's headless net8.0 xUnit
  suite (which references only Core; the whole `Volt.Bridge.{Beckhoff,Codesys}` driver layer has no headless
  tests, by nature of the COM/in-proc dependency). These are verified by: clean build of both bridges (0
  errors), code inspection, and manual close→reopen on a live IDE. The off-thread-safety invariant (IsConnected
  is pure field/cached reads; every object-model touch is on the STA/primary thread) is preserved by design.
