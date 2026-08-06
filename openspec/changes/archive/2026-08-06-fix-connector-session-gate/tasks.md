## 1. Reproduce first (the method this change exists to correct)

- [x] 1.1 Reproduce the parked `conflict-resolve` failures before designing anything.
- [x] 1.2 **RESULT: the premise was wrong.** The failures were not the session/gate model. One fixture's
      TcXaeShell crashes and respawns (Project13's pid moved 7040 → 6848 → 13940 → 1488 in one session while
      Project14 never moved); when the harness resolved to the dying instance, `volt init` failed and
      `conflict-resolve`'s `pull` assertion failed as a downstream symptom. Found by printing the `message` field
      the test discards. Pinned to a stable XAE the suite is **90 pass / 11 skip / 0 fail**, twice.
- [x] 1.3 Re-scope this change accordingly — acceptance criterion already met, two of three findings demoted
      with reasoning. Recorded in `proposal.md`.

## 2. The one finding with a demonstrable cost

- [x] 2.1 `ControlHarness` drives a REAL `ConnectionManager`/`Reconciler` over a fake `IProjectSource`
      (`FileProjectSource`) instead of its own inline reconcile. Fake the data, use the real decision.
- [x] 2.2 `wantedFile` at a temp path — load-bearing, not hygiene: `ConnectionManager` seeds its restored set
      from it, so the machine's real `wanted.json` would fabricate unbind edges and arm the 20 s startup grace
      hold, holding the unbinds the drop/shutdown tests assert.
- [x] 2.3 The second divergence goes too: the harness matched interests on `ProjectName ?? DisplayName`,
      `Reconciler` matches `DisplayName`. These genuinely differ on TwinCAT.
- [x] 2.4 **Red-first test for the case the old harness made untestable**: a bridge already serving a project
      nobody declared keeps serving, and connecting a neighbour does not gate it. RED against the old harness
      (`Expected: true, Received: false`), green against the real reconciler.
- [x] 2.5 Gate: build 0 errors, 327 + 122 + 77, `@volt/control` e2e 9 → **10 pass / 0 fail**.

## 3. Deliberately NOT done

- [x] 3.1 The disconnect gate's two owners, and the CLI/connector disagreement about "served" — **demoted**.
      True observations, no demonstrated failure, and both were filed as the suspect for what turned out to be a
      crashing IDE. Touching the gate that decides whether a live PLC accepts writes, on a design smell with no
      failing test, is not a trade worth making. Recorded in `optimize-volt-cli-architecture/findings.md`.
