# Design — one TwinCAT worker per XAE

## Where the asymmetry comes from (and what actually changes)

| | CODESYS | TwinCAT today | TwinCAT proposed |
|---|---|---|---|
| Automation | in-proc scripting (must be in-proc) | out-of-process COM (DTE) | out-of-process COM (DTE) |
| Hosts | one host **per IDE process**, in-proc | **one** external worker, all XAE | one external worker **per XAE** |
| Pipe | `volt.bridge.codesys.<pid>` | `volt.bridge.twincat` (single) | `volt.bridge.twincat.<pid>` |
| Attach | it IS the process | ROT enumerate + `BindByProject` (name) | attach ONE XAE **by pid** |
| Ops across IDEs | parallel (per process) | **serialized** (one STA thread) | parallel (per process) |
| Lifecycle | dies with the IDE (no supervision) | one long-lived worker | **connector spawns/reaps per XAE** |

The DATA model (per-pipe discovery, self-describing rows, one merged list) becomes **identical** across vendors. The
LIFECYCLE stays asymmetric — and that asymmetry is the whole cost of this change, so it is called out, not hidden:
CODESYS's host is in-proc so the IDE manages it; a TwinCAT per-XAE worker is a separate process the **connector** must
start and stop.

## The supervisor (the hard part)

The connector must know which XAE are running to keep one worker per window. It cannot ask "is this `devenv.exe` a
TwinCAT project?" from the outside without COM, so:

- **The connector runs a LIGHT ROT enumeration itself** (net8 can do COM ROT; `RotInstances` already lists DTE
  monikers) → a set of `(xaePid, projectNames)`. This touches only top-level DTE state (moniker → window pid), never
  the PLC tree, so it is cheap and cannot fault a busy IDE.
- **Reconcile every tick**: for each XAE pid with no worker → spawn `VoltBridgeTwincat --xae-pid <pid>`; for each
  worker whose XAE pid is gone → kill it. This is a small diff loop, the connector's existing supervision extended.
- **Split of duties**: connector = *discovery* (light, which XAE exist); per-pid worker = *serving* (heavy, walk/read/
  build on that one XAE). The heavy COM never runs in the connector.

### Pid targeting in the worker
`--xae-pid <pid>` → the worker enumerates the ROT, maps each DTE to its window process (`DTE.MainWindow.HWnd` →
`GetWindowThreadProcessId`), and claims the one whose pid matches. On a DTE re-registration it re-enumerates and
re-matches **by pid** (stable) — no ephemeral moniker, no name matching. This is expected to remove the reattach
failure mode we hit.

### Lifecycle edge cases the design must handle
- **XAE opens** → next reconcile spawns its worker; worker starts degraded until the DTE is attachable.
- **XAE closes** → worker's DTE dies; the worker self-exits (its pid is gone) AND the connector reaps it — belt and
  suspenders, so a missed signal on either side still converges.
- **XAE crashes / hangs** → the worker reports `degraded` (honest-health), the connector may leave it (honest) or
  respawn after the pid vanishes.
- **Worker crashes, XAE lives** → next reconcile respawns it.
- **Two XAE, same project name** → two workers, two pipes, but the connector still collapses to one row by identity
  (vendor+name) — UNCHANGED, the accepted limit; the difference is the *worker* no longer disambiguates.

## What gets deleted (the payoff)
- `RotInstances.Enumerate`-all + the per-worker multiplexing loop in `BeckhoffDriver.BuildProjects`.
- `TcObjectModel.BindByProject` / the name-based recovery → pid-based attach.
- The `IProjectSource` asymmetry — `CodesysProjectSource` (fan-out) + `PipeProjectSource` (single) → one per-pipe
  source parameterised by vendor/prefix. `ARCHITECTURE.md`'s "per-pipe vs one-worker" asymmetry note is retired.

## Risks / what could make this NOT worth it
- **Supervisor races** — an XAE flicker (opens, a transient ROT gap, "closes") could thrash spawn/kill. Mitigate with
  a debounce / require N consecutive misses before reaping (the same shape as `RotInstances`' empty-ROT retry).
- **Worker leaks** — a worker whose XAE died but that didn't self-exit. The connector's pid-gone reap covers it.
- **The connector doing COM** — it must host a light ROT enumerator on an STA thread. Small, but it moves *some* COM
  into the connector (today none). Kept to moniker→pid only.
- **Net simplicity is a wash-to-slightly-better, not a slam dunk** — we trade one-worker-multiplexing for a supervisor
  fleet. It wins on *robustness* (pid attach, no moniker) and *symmetry*, less clearly on raw line count. If the
  supervisor turns out fiddly, the current single worker is a legitimate `keep`.

## Validation
- Ops parallelism: two per-pid workers each run a slow op concurrently → both finish in ~one op's time (the e2e
  multi-XAE tier, now genuinely parallel).
- The connector supervisor reconcile loop: unit-tested with a fake ROT-enumerator (pids in/out → spawn/kill diff),
  no live IDE.
- Existing wire/health/connect contract tests stay green unchanged (the wire didn't move).
