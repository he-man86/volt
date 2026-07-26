# Tasks

## Phase 0 — decide (before any code)
- [x] Confirm the supervisor split — RESOLVED to: connector discovers XAE pids via the worker's `--list-xae-pids`
      one-shot (COM in a short-lived child, NOT an in-tray STA thread — better isolation, less code); per-pid worker
      does the heavy ops.
- [x] Reap policy: connector reap with an N-miss debounce (`TwincatSupervisor.ReapAfterMisses = 3`). Worker
      self-exit on pid-gone is still TODO (belt-and-suspenders — see Phase 1); the connector reap covers cleanup.
- [x] Pipe naming `volt.bridge.twincat.<xae-pid>`; discovery reuses the CODESYS pipe-listing path (`PipeDiscovery`).

## Phase 1 — the per-XAE worker (attach by pid)
- [x] `VoltBridgeTwincat --xae-pid <pid>`: attach to the ONE XAE whose window process is `<pid>` (DTE.MainWindow.HWnd
      → GetWindowThreadProcessId), serve `volt.bridge.twincat.<pid>`. `--xae-pid` is now REQUIRED (no all-XAE mode).
- [x] `TcObjectModel`: pid-targeted attach + re-attach (`_xaePid` → `BindByPid`; recovery re-acquires by pid). The
      name-based `BindByProject` / no-arg `Connect` / `First` / `Enumerate` are DELETED (Phase 5).
- [x] `BeckhoffDriver.BuildProjects`: single-XAE — always this worker's own window via `OwnSolution`.
- [ ] Worker self-exits when its XAE pid is gone (deferred — the connector's N-miss reap covers cleanup for now).

## Phase 2 — the connector supervisor
- [x] XAE pid discovery — the `--list-xae-pids` subprocess (`TwincatXaeProbe`), replacing the in-tray STA enumerator.
- [x] Reconcile loop (`ReconcileTwincatWorkers`): spawn per live pid (idempotent EnsureWorker), reap per vanished
      pid; debounce flicker (N misses). Throttled to ~every 3rd tick.
- [x] Crash handling: EnsureWorker respawns a worker whose XAE still runs; reap covers an orphan whose XAE is gone.

## Phase 3 — unify IProjectSource (the payoff)
- [x] Collapse `CodesysProjectSource` + `PipeProjectSource` into ONE `PerPipeProjectSource(vendor, display, prefix)`;
      both vendors discover per-pipe.
- [x] Delete `RotInstances.Enumerate`-all multiplexing + `BindByProject` + `First` (Phase 5 — live-validated first).
- [x] `ARCHITECTURE.md`: pipe topology is now symmetric; the remaining asymmetry is lifecycle — documented as such.

## Phase 4 — lifecycle + parallel-ops tests
- [x] Supervisor reconcile unit test (6 tests: spawn-once, per-XAE, brief-absence, sustained-reap, flicker-reset,
      returns-respawn) + `TwincatXaeProbe.Parse` tests. All green.
- [x] Ops-parallelism: two per-pid workers answered health CONCURRENTLY over their two pipes (~620ms for both) —
      genuinely parallel (two processes), not serialized on one STA thread. Verified live below.
- [x] The wire/health/connect contract tests stay green unchanged (no wire change) — verified (496 offline green).
- [x] Live multi-XAE (local tier): two XAE (Project13/14) → `--list-xae-pids` saw both; two workers each served
      `volt.bridge.twincat.<pid>` reporting ONLY its own window; closed one → the other kept serving; survivor's
      pid alone in `--list-xae-pids`.

## Phase 5 — parity + cleanup ✅ DONE (live-validated)
- [x] CODESYS untouched; both vendors serve the same flat per-pipe health rows.
- [x] Deleted the legacy no-arg worker mode + `RotInstances.{First,Enumerate,BindByProject}` + `TcObjectModel.Connect`;
      `--xae-pid` is required, `BeckhoffDriver.Connect()` (the DriverBase contract CODESYS uses) throws for TwinCAT.

## Live smoke test — PASSED (2026-07-25, real TcXaeShell + the two committed fixtures)
- ONE XAE (pid 17844): `--list-xae-pids` → 17844; worker `--xae-pid 17844` served `volt.bridge.twincat.17844`;
  health → only `TwinCAT Project13` (v15.0). `connect` → `{ok:true}`; health flipped `idle`→`healthy` (the pid-based
  `BindByPid`→resolve path). No-arg worker rejected with exit 2.
- TWO XAE (+pid 33512, Project14): both pids discovered; two pipes, each reporting ONLY its own window (13 vs 14);
  both answered health in parallel (~620ms); closing XAE 14 left XAE 13 serving cleanly.

## Notes
- Built incrementally: (1) per-XAE worker serving-half DORMANT, (2) connector cutover (legacy kept one commit as a
  git-revert fallback), (3) after the live smoke test passed, Phase 5 deleted the legacy path. No runtime flag.
- **Only remaining deferral:** the worker doesn't self-exit when its XAE pid vanishes — the connector's N-miss reap
  handles cleanup. Add self-exit if orphan workers ever show up in practice.
