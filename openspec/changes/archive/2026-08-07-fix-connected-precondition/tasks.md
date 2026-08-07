## 1. Make the divergence reproducible FIRST (red before green)

- [x] 1.1 Give `test/shared/FakeIde.cs` independent control of the live signal vs the health snapshot. Today
      `IsConnected` and `BuildHealthResponse().Connected` are deliberately the same signal (`FakeIde.cs:217-218`),
      which is exactly why 505 green tests cannot see this bug. Keep the current defaults so existing tests are
      unaffected; add the knob.
- [x] 1.2 Add a failing test: live-connected + a health snapshot with no serving row ⇒ a **write** (`push`) passes
      its precondition, and a read and a write reach the same verdict. **Must be red before the fix.**
- [x] 1.3 Add a test that a genuine mismatch still refuses `WRONG_PROJECT`, and a detached bridge still refuses
      `PLC_DISCONNECTED` — the guard must not be weakened into permissiveness.

## 2. One live signal

- [x] 2.1 Add `string? ServedProjectName { get; }` to `Ide/IIdeSession.cs` — a lock-free live state read, documented
      the same way as `IsConnected`, explicitly NOT a cached value.
- [x] 2.2 Implement it in both drivers off the state each already reads: `CodesysDriver` (`_om.ProjectName`, see
      `CodesysObjectModel.cs:56`) and `BeckhoffDriver` (`_om.ProjectName`, as `BuildProjects()` does). It must not
      touch COM beyond the same top-level state read, and must not marshal.
- [x] 2.3 Rewrite `Sync/OpGuard.RequireBoundProject` to use `ide.IsConnected` for the connected check and
      `ide.ServedProjectName` for the identity comparison. Keep returning the health it read where callers echo the
      identity back — or change the signature if that is now dishonest, and update the callers.
- [x] 2.4 Confirm `RefsService` and `OpGuard` now express the SAME precondition, and delete whichever duplicate
      wording is left over. One rule, one place.

## 3. Stop swallowing the probe failure

- [x] 3.1 In `Ide/DriverBase.cs`, `SingleFlight` must log the exception at Warn (`VoltLog`) and `MarkDegraded` with
      the reason. It stays best-effort for the request path — `health` still answers from the last snapshot — but
      the failure becomes audible.
- [x] 3.2 Check the `MarkDegraded` interaction: `SnapshotHealth` clears degraded when the selection is healthy
      again, so a transient probe failure must be able to recover. Do not create a sticky degraded state.

## 4. Verify (nothing here is "done" on inspection)

- [x] 4.1 `dotnet build Volt.Cli.sln -c Release` (IDEs must be DOWN — a running CODESYS holds the net48 DLLs), then
      all three suites: `Volt.Engine.Tests` (313), `Volt.Cli.Tests` (116), `Volt.Cli.Connector.Tests` (76). Use
      `C:\Program Files\dotnet\dotnet.exe`.
- [x] 4.2 1.2's test goes green; no existing test is edited to accommodate the change.
- [x] 4.3 Live e2e **CODESYS**: `bun run test:e2e:codesys` = 92 pass / 0 fail. This is the parity claim — the change
      must be a no-op on CODESYS.
- [x] 4.4 Live e2e **TwinCAT**: `bun run test:e2e:twincat` = 90 pass / 0 fail.
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

- [x] 4.5b **DONE 2026-08-07 — `ide-restart` is 2 pass / 0 fail**, confirmed on two consecutive runs. The
      save-on-push defect was already fixed (`File.SaveAll`, see `fix-push-data-loss` 3.0-RESULT); it had simply
      never been re-checked against this test. The symptom this change was chasing is closed.

<details><summary>original 4.5 wording</summary>

- [x] 4.5 **The acceptance test:** with exactly one live XAE,
      `VOLT_E2E_IDE_CHAOS=1 VOLT_VENDOR=twincat bun test test/e2e/lifecycle/ide-restart.test.ts` goes **2 pass /
      0 fail**, with its assertions intact. If it still fails, the diagnosis was incomplete — do NOT weaken the
      test; go back to `audit-volt-cli-src/arch-notes.md` and the open question in 5.1.

</details>

## 5. Open question to resolve or record

- [x] 5.1 **ANSWERED: it was unreachable BEFORE this change, and this change is what makes it reachable.**
      `TcObjectModel.IsConnected` is `_dte is not null && _sysManager is not null` — a pure field check that never
      touches COM, so after an IDE restart it stays **true** (the RCWs are dead but non-null). Before the fix,
      `OpGuard` read the THROTTLED health snapshot, found no serving row, and threw `PLC_DISCONNECTED` before any
      COM call — so `ShouldMarkDegraded` never saw a transient and `Recover()` never ran. Now `OpGuard` reads live
      `IsConnected`, which does not short-circuit, so the first real COM call raises the RPC transient (0x800706BA),
      `ShouldMarkDegraded` classifies it, and `RunRead` recovers. **The doctrine in `BeckhoffDriver.SnapshotHealth`'s
      doc comment therefore has a live path, and the code is correct as written — no doc or code change needed.**
      Empirically corroborated: `ide-restart`'s reopen-and-recover assertions now pass twice in a row.
      Scope note: this is the READ path. Writes go through `RunOp`, which deliberately does not retry (a write
      could double-apply), so recovery after a restart happens on the next read — by design.
      Original question:
- [~] 5.1 Is `RunRead`'s Recover-on-transient reachable for a restarted IDE at all? The guard throws
      `PLC_DISCONNECTED` *before* any COM call, so `ShouldMarkDegraded` never classifies a transient, so `Recover()`
      may never run on that path — which would mean the "recovery is deferred to the content ops" doctrine in
      `BeckhoffDriver.SnapshotHealth`'s doc comment has no live path. Prove it either way and fix the doc or the
      code.
- [x] 5.2 **DONE (verified in code 2026-08-07).** `IIdeSession` now names `IsConnected` + `ServedProjectName` as
      "the ONLY source for the not-connected + right-project precondition (`Sync/OpGuard`)", checked once in the
      wire host — no wording left implying it lives anywhere else. `FakeIde`'s false claim is gone, replaced by an
      explicit note that the two are SEPARATE sources "because they are separate on a real driver … This double
      used to assert they were the same signal, which made the divergence unrepresentable — and hid a real bug."
      Original:
- [~] 5.2 Update `Ide/IIdeSession.cs`'s doc if the wording still implies the precondition lives anywhere else, and
      remove the now-false claim in `FakeIde` that the two signals are the same signal.


---

## CLOSE-OUT — 2026-08-07

Verified in code that §1-§3 had all landed; those checkboxes were stale bookkeeping, not open work (the third
time in this programme that a change's checkbox count overstated what was left).

The two genuinely open items are now closed:

- **4.5b** — `ide-restart` is **2 pass / 0 fail**, twice. The symptom this change was chasing is gone. It was
  blocked on `fix-push-data-loss`'s save defect, which was already fixed and merely never re-checked here.
- **5.1** — answered, and the answer is that the concern was REAL and this change is the fix. See the task for the
  full chain; in short, `TcObjectModel.IsConnected` never touches COM so it stays `true` across an IDE restart —
  which means the old snapshot-based guard short-circuited before any COM call and made `RunRead`'s recovery
  unreachable, while the live-signal guard lets the RPC transient surface and be recovered. No doc or code change
  was needed; the existing doctrine is correct now that the precondition reads the right signal.
