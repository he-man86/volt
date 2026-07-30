## Why

The not-connected precondition — the check that decides whether a project op may touch the IDE — has **two
different answers**, and the write path reads the staler one.

`Ide/IIdeSession.cs:11-12` states the design: *"the select post-condition and the not-connected precondition are
checked there against `IsConnected`, not in each driver."*

- `Sync/RefsService.cs:17` obeys it: `if (!ide.IsConnected) throw PlcDisconnected()` — a **live** state read.
- `Sync/OpGuard.cs:20-21` — which **every fetch / push / build** runs as its first act — instead does
  `var h = ide.BuildHealthResponse(); if (!h.Connected) …`. `h.Connected` is `ServingProject != null`, i.e. "is any
  row non-idle" in a list that `BeckhoffDriver.BuildHealthResponse` serves from a **≤5 s-throttled cached
  snapshot**. `OverlayLiveHealth` refreshes the served row's *verdict*, but it cannot resurrect a serving row the
  cached list does not contain.

So on TwinCAT a **write can be refused `PLC_DISCONNECTED` on stale state while a read of the same bridge
succeeds**. Observable symptom: after an IDE is closed and reopened, `connect` succeeds and `refs` succeeds, then
the first write fails — which is `test/e2e/lifecycle/ide-restart.test.ts`'s second test, currently red.

Two things kept this invisible:

1. **`DriverBase.SingleFlight` swallows every health-probe failure** (`catch { /* the cache keeps its last
   snapshot */ }`). When `EnsureAttached()`/`SnapshotHealth()` fails after an IDE returns, nothing throws, nothing
   logs, nothing marks degraded — health repeats a stale snapshot indefinitely. Diagnosing this took three live
   IDE cycles with **no log line to read**. It is a defensive fallback masking a real failure.
2. **The test double asserts the bug away.** `test/shared/FakeIde.cs:217-218` says *"Mirror a real driver:
   IsConnected and BuildHealthResponse().Connected (derived from Status) are the SAME signal."* They are not, on
   the real TwinCAT driver. All 505 green unit tests therefore assert a world in which this divergence cannot
   exist.

## What Changes

- **One signal for the precondition.** `OpGuard` takes the connected check from the live `ide.IsConnected`, per the
  documented invariant — the same signal `RefsService` already uses.
- **A live identity read on the seam.** Taking `IsConnected` live while reading the project *name* from the cached
  rows would trade a spurious `PLC_DISCONNECTED` for a spurious `WRONG_PROJECT` (a connected bridge whose cached
  list has no serving row reports `ProjectName == null`). So `IIdeSession` gains
  `string? ServedProjectName { get; }` — a lock-free live state read, the same shape as `IsConnected`. Both drivers
  already hold it (`CodesysObjectModel.cs:56`, and `BeckhoffDriver.BuildProjects()` reads `_om.ProjectName`).
- **Stop swallowing.** A failed health probe logs at Warn and marks the session degraded, so a stale snapshot is
  never silently presented as truth. The probe stays best-effort — it must not fault the `health` request — but it
  becomes *audible*.
- **Make the fake able to lie.** `FakeIde` gets independent control of the live signal and the health snapshot, so
  a test can reproduce the divergence, plus a regression test pinning the live precondition.

Not in scope: the throttled cache itself (correct — a poll must never marshal onto the IDE thread), the
`_paused` gate, and whether `RunRead`'s Recover-on-transient is reachable for a restarted IDE (recorded as an open
question in `audit-volt-cli-src/arch-notes.md`; the guard throws before any COM call, so no transient is ever
classified).

## Capabilities

### New Capabilities

- `bridge-connected-precondition`: the single live signal every project op's not-connected precondition is
  decided by, and the requirement that a health-probe failure is never silent.

## Impact

- **Parity-critical, shared Core.** `Sync/OpGuard.cs`, `Ide/IIdeSession.cs`, `Ide/DriverBase.cs`, plus one live
  accessor in each driver (`CodesysDriver`, `BeckhoffDriver`). CODESYS's host dies with its IDE and its `Recover()`
  is a no-op, so the change should be a **no-op on CODESYS** — that must be proven, not assumed.
- **Wire-visible:** a write that previously refused with `PLC_DISCONNECTED` on stale state now proceeds. No error
  code, payload shape or op is added or removed.
- **Verification:** all three C# suites, then live e2e on **both** vendors, and `ide-restart` must go green
  without its assertions being weakened.
