# Tasks

## Phase 0 — decide (before any code)
- [ ] Confirm the supervisor split (connector = light ROT enum for pids; per-pid worker = heavy ops) is the model,
      vs. alternatives (a single discovery worker reporting pids; process-name-only detection).
- [ ] Confirm the reap policy: worker self-exit on pid-gone AND connector reap, with an N-miss debounce.
- [ ] Confirm pipe naming `volt.bridge.twincat.<xae-pid>` and that discovery reuses the CODESYS pipe-listing path.

## Phase 1 — the per-XAE worker (attach by pid)
- [ ] `VoltBridgeTwincat --xae-pid <pid>`: attach to the ONE XAE whose window process is `<pid>` (DTE.MainWindow.HWnd
      → GetWindowThreadProcessId), serve `volt.bridge.twincat.<pid>`.
- [ ] `TcObjectModel`: pid-targeted attach + re-attach (replace `BindByProject`/name recovery with pid match).
- [ ] `BeckhoffDriver.BuildProjects`: single-XAE (this worker's window) — no ROT-enumerate-all, no serving-pick across
      windows.
- [ ] Worker self-exits when its XAE pid is gone.

## Phase 2 — the connector supervisor
- [ ] A light ROT enumerator in the connector (moniker → xaePid + projectNames; no PLC walk), on an STA helper thread.
- [ ] Reconcile loop: spawn a worker per new XAE pid; reap a worker per vanished pid; debounce flicker (N misses).
- [ ] Crash handling: respawn a worker whose XAE still runs; reap an orphan whose XAE is gone.

## Phase 3 — unify IProjectSource (the payoff)
- [ ] Collapse `CodesysProjectSource` (fan-out) + `PipeProjectSource` (single) into ONE per-pipe source
      parameterised by vendor + pipe prefix; both vendors now discover per-pipe.
- [ ] Delete `RotInstances.Enumerate`-all multiplexing + `BindByProject`.
- [ ] Update `ARCHITECTURE.md`: retire the "per-pipe vs one-worker" asymmetry note; both vendors are per-pipe.

## Phase 4 — lifecycle + parallel-ops tests
- [ ] Supervisor reconcile unit test (fake pid-enumerator: pids in/out → correct spawn/kill diff; flicker debounced).
- [ ] Ops-parallelism test: two per-pid workers each run a slow op → both complete in ~one op's duration.
- [ ] The wire/health/connect contract tests stay green unchanged (no wire change) — verify.
- [ ] e2e multi-XAE (local tier): two XAE, two workers, parallel refs/push; disconnect one leaves the other serving.

## Phase 5 — parity + cleanup
- [ ] Confirm CODESYS is untouched and both vendors now serve byte-identical health per pipe.
- [ ] Remove any now-dead moniker/instance code paths; run the redundant-layers lens over the diff.

## Notes
- The wire does not move, so this is safe to build incrementally: land the per-pid worker + supervisor first (it can
  coexist behind a flag with the single worker), verify parity, then delete the multiplexing path.
- Bail-out criterion: if the supervisor reconcile proves fiddly/racy beyond the value, the current single worker is a
  legitimate `keep` — record that decision here and archive.
