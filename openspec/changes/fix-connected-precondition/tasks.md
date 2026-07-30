## 1. Make the divergence reproducible FIRST (red before green)

- [ ] 1.1 Give `test/shared/FakeIde.cs` independent control of the live signal vs the health snapshot. Today
      `IsConnected` and `BuildHealthResponse().Connected` are deliberately the same signal (`FakeIde.cs:217-218`),
      which is exactly why 505 green tests cannot see this bug. Keep the current defaults so existing tests are
      unaffected; add the knob.
- [ ] 1.2 Add a failing test: live-connected + a health snapshot with no serving row ⇒ a **write** (`push`) passes
      its precondition, and a read and a write reach the same verdict. **Must be red before the fix.**
- [ ] 1.3 Add a test that a genuine mismatch still refuses `WRONG_PROJECT`, and a detached bridge still refuses
      `PLC_DISCONNECTED` — the guard must not be weakened into permissiveness.

## 2. One live signal

- [ ] 2.1 Add `string? ServedProjectName { get; }` to `Ide/IIdeSession.cs` — a lock-free live state read, documented
      the same way as `IsConnected`, explicitly NOT a cached value.
- [ ] 2.2 Implement it in both drivers off the state each already reads: `CodesysDriver` (`_om.ProjectName`, see
      `CodesysObjectModel.cs:56`) and `BeckhoffDriver` (`_om.ProjectName`, as `BuildProjects()` does). It must not
      touch COM beyond the same top-level state read, and must not marshal.
- [ ] 2.3 Rewrite `Sync/OpGuard.RequireBoundProject` to use `ide.IsConnected` for the connected check and
      `ide.ServedProjectName` for the identity comparison. Keep returning the health it read where callers echo the
      identity back — or change the signature if that is now dishonest, and update the callers.
- [ ] 2.4 Confirm `RefsService` and `OpGuard` now express the SAME precondition, and delete whichever duplicate
      wording is left over. One rule, one place.

## 3. Stop swallowing the probe failure

- [ ] 3.1 In `Ide/DriverBase.cs`, `SingleFlight` must log the exception at Warn (`VoltLog`) and `MarkDegraded` with
      the reason. It stays best-effort for the request path — `health` still answers from the last snapshot — but
      the failure becomes audible.
- [ ] 3.2 Check the `MarkDegraded` interaction: `SnapshotHealth` clears degraded when the selection is healthy
      again, so a transient probe failure must be able to recover. Do not create a sticky degraded state.

## 4. Verify (nothing here is "done" on inspection)

- [ ] 4.1 `dotnet build Volt.Cli.sln -c Release` (IDEs must be DOWN — a running CODESYS holds the net48 DLLs), then
      all three suites: `Volt.Engine.Tests` (313), `Volt.Cli.Tests` (116), `Volt.Cli.Connector.Tests` (76). Use
      `C:\Program Files\dotnet\dotnet.exe`.
- [ ] 4.2 1.2's test goes green; no existing test is edited to accommodate the change.
- [ ] 4.3 Live e2e **CODESYS**: `bun run test:e2e:codesys` = 92 pass / 0 fail. This is the parity claim — the change
      must be a no-op on CODESYS.
- [ ] 4.4 Live e2e **TwinCAT**: `bun run test:e2e:twincat` = 90 pass / 0 fail.
### Verification results (2026-07-30)

- [x] 4.1 build ✓ 0 errors · **317**/317 (313 + the 4 new tests) · 116/116 · 76/76
- [x] 4.2 the three red tests from 1.2/1.3 go green; **no existing test edited** to accommodate the change
- [x] 4.3 **CODESYS e2e 92 pass / 0 fail** — the no-op parity claim holds
- [x] 4.4 **TwinCAT e2e 90 pass / 0 fail**, against a freshly built worker (see the stale-worker note below)
- [~] 4.5 `ide-restart` is **1 pass / 1 fail**, NOT the required 2/0 — but the residual failure is a DIFFERENT
      defect, not this one. Evidence it is different: the test now reaches its FINAL assertion (line 113,
      `fetchSource`), which requires the write after recovery, the kill, the reopen and
      `expect(recovered).toBe(true)` to have all passed. Before this fix it failed at the `createItem` WRITE with
      `PLC_DISCONNECTED`. The remaining failure is "a pushed item did not survive the IDE being killed" —
      logged as its own data-loss-shaped finding in `audit-volt-cli-src/arch-notes.md`. **This change is therefore
      verified for what it claims; the test stays red for the other defect and must NOT be weakened.**

> **Stale-worker trap (cost a full cycle).** The always-on connector spawns the **installed**
> `VoltBridgeTwincat.exe`, whose `Volt.Engine.dll` was a day old — so a live TwinCAT run silently verifies OLD
> code. Point the connector at the fresh build with the `VOLT_TWINCAT_BRIDGE` env var
> (`ConnectorSetup.ResolveWorker`, env is first in precedence) and confirm with
> `Get-Process VoltBridgeTwincat | Select Path` before trusting any TwinCAT result. Restart the connector plainly
> afterwards to restore normal operation.
> **Also:** prefer fixture **Project14**. Project13's XAE self-closed three times mid-run; Project14 is the one
> that actually serves (it has both `_CompileInfo`s).

- [ ] 4.5b **Re-run `ide-restart` to 2 pass / 0 fail once the save-on-push defect is fixed.** That is the true
      close-out of the symptom this change was chasing.

<details><summary>original 4.5 wording</summary>

- [ ] 4.5 **The acceptance test:** with exactly one live XAE,
      `VOLT_E2E_IDE_CHAOS=1 VOLT_VENDOR=twincat bun test test/e2e/lifecycle/ide-restart.test.ts` goes **2 pass /
      0 fail**, with its assertions intact. If it still fails, the diagnosis was incomplete — do NOT weaken the
      test; go back to `audit-volt-cli-src/arch-notes.md` and the open question in 5.1.

</details>

## 5. Open question to resolve or record

- [ ] 5.1 Is `RunRead`'s Recover-on-transient reachable for a restarted IDE at all? The guard throws
      `PLC_DISCONNECTED` *before* any COM call, so `ShouldMarkDegraded` never classifies a transient, so `Recover()`
      may never run on that path — which would mean the "recovery is deferred to the content ops" doctrine in
      `BeckhoffDriver.SnapshotHealth`'s doc comment has no live path. Prove it either way and fix the doc or the
      code.
- [ ] 5.2 Update `Ide/IIdeSession.cs`'s doc if the wording still implies the precondition lives anywhere else, and
      remove the now-false claim in `FakeIde` that the two signals are the same signal.
