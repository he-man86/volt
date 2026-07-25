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
      → GetWindowThreadProcessId), serve `volt.bridge.twincat.<pid>`.
- [x] `TcObjectModel`: pid-targeted attach + re-attach (`_xaePid` → `BindByPid`; recovery re-acquires by pid). NOTE:
      the name-based `BindByProject` is KEPT for the legacy no-arg fallback — delete after the live smoke test.
- [x] `BeckhoffDriver.BuildProjects`: single-XAE (this worker's window via `OwnSolution`) when `_xaePid != 0`.
- [ ] Worker self-exits when its XAE pid is gone (deferred — the connector's N-miss reap covers cleanup for now).

## Phase 2 — the connector supervisor
- [x] XAE pid discovery — the `--list-xae-pids` subprocess (`TwincatXaeProbe`), replacing the in-tray STA enumerator.
- [x] Reconcile loop (`ReconcileTwincatWorkers`): spawn per live pid (idempotent EnsureWorker), reap per vanished
      pid; debounce flicker (N misses). Throttled to ~every 3rd tick.
- [x] Crash handling: EnsureWorker respawns a worker whose XAE still runs; reap covers an orphan whose XAE is gone.

## Phase 3 — unify IProjectSource (the payoff)
- [x] Collapse `CodesysProjectSource` + `PipeProjectSource` into ONE `PerPipeProjectSource(vendor, display, prefix)`;
      both vendors discover per-pipe.
- [ ] Delete `RotInstances.Enumerate`-all multiplexing + `BindByProject` — DEFERRED to the cleanup pass (kept as the
      legacy no-arg worker fallback until the live smoke test passes).
- [x] `ARCHITECTURE.md`: pipe topology is now symmetric; the remaining asymmetry is lifecycle — documented as such.

## Phase 4 — lifecycle + parallel-ops tests
- [x] Supervisor reconcile unit test (6 tests: spawn-once, per-XAE, brief-absence, sustained-reap, flicker-reset,
      returns-respawn) + `TwincatXaeProbe.Parse` tests. All green.
- [ ] Ops-parallelism test: two per-pid workers each run a slow op → both complete in ~one op's duration (needs a
      live bridge — part of the smoke test).
- [x] The wire/health/connect contract tests stay green unchanged (no wire change) — verified (496 offline green).
- [ ] e2e multi-XAE (local tier): two XAE, two workers, parallel refs/push; disconnect one leaves the other serving
      (needs live XAE — the smoke test).

## Phase 5 — parity + cleanup (after the live smoke test)
- [ ] Confirm CODESYS is untouched and both vendors serve byte-identical health per pipe (live).
- [ ] Once one-XAE → two-XAE is validated live: delete the legacy no-arg worker mode + `Enumerate`-all +
      `BindByProject`, and run the redundant-layers lens over the diff.

## Notes
- Built incrementally: (1) the per-XAE worker serving-half DORMANT (legacy no-arg path unchanged), then (2) the
  connector cutover. The legacy path is kept ONE commit as a git-revert fallback (no runtime flag) — deleted in
  Phase 5 once the live smoke test passes.
- **Live-validation gap (open):** the pid-attach + supervisor-driven fleet cannot be validated headless (TcXaeShell
  instability). Ships proven-in-unit, unproven-live. Smoke test: open ONE XAE → confirm a worker attaches + serves
  `volt.bridge.twincat.<pid>` + `volt status` sees it; then TWO XAE → two workers, parallel ops, close one, the
  other keeps serving.
- Bail-out: if the fleet proves racy beyond its value, `git revert` the connector-cutover commit — the dormant
  serving-half stays (harmless) and the connector falls back to the single worker.
