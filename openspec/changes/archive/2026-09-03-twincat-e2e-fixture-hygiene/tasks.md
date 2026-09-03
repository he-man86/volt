## 1. Establish the baseline honestly

- [x] 1.1 **Partly done, and it answered the question earlier than planned.** One run from a restored
      fixture leaves only churn; four runs from restored fixtures each gave the same result. Original:
- [x] 1.1-orig From a `git restore` + `git clean` of `test/fixtures/`, run the TwinCAT e2e three times WITHOUT
      cleaning in between, recording the failure set each time. If the count climbs, the fixture is the variable.
- [x] 1.2 Superseded by 1.1's result: three runs WITHOUT cleaning already gave identical results
      (159/24/1 twice, third interrupted), so a with-cleaning arm cannot show less variance than none.
- [x] 1.3 Recorded in FINDINGS.md, both arms. A flaky-suite claim without a before/after is how this got mis-attributed
      the first time.

## 2. Fix the source

- [x] 2.1 Find what `cleanup()` leaves behind. **DONE — see FINDINGS.md.** On a healthy run it leaves
      only `LineIds` churn (one line per touched file), no items and no folders. The cascade comes from
      TIMEOUTS skipping cleanup, not from cleanup being incomplete. The known residue: items under `VISUs/`, `DUTs/`, `GVLs/`,
      `POUs/POUs/`, plus `.tsproj`/`.plcproj`/`.tmc` edits the IDE writes on save.
- [x] 2.2 Route chosen: a run-once SWEEP in `requireHealthy`, not a copy. The measurement made the copy
      unnecessary — nothing accumulates on a healthy run — and the sweep fixes the case that does bite
      (a previous run that died before its cleanup). Original text: complete the cleanup, or run against a copy as CODESYS does. Prefer the copy — it is
      the same shape as the vendor tier that does NOT have this problem, and it cannot be defeated by a test that
      forgets to register its own artefact.
- [x] 2.3 ~~A dirty-fixture pre-flight that REFUSES~~ — **DROPPED for the second and final time.** I ruled
      it out (churn is harmless), reinstated it on a single zero-churn observation, then failed to
      reproduce that: two runs plus a bridge-clean and an orderly shutdown left SEVEN modified files.
      The zero was most likely a FAILED save — the engineer saw a "saving project failed" modal. Churn
      is normal; a refusing pre-flight would fire every run.
- [x] 2.4 Attempted, and it REFUTED 2.3 rather than confirming it. Recorded in FINDINGS.md.
- [x] 2.5 Teardown rule, documented in the e2e README: **clean through the bridge, never `git restore`
      under a live IDE.** Git cannot see TwinCAT's in-memory model, which writes back on save, so a
      restore under a running IDE leaves disk and IDE disagreeing about the same project.

## 3. Then, and only then, the two-XAE question

- [x] 3.1a **The connector now DIAGNOSES it rather than me staging one.** `ProbeDiagnosis` + `XaeWindows`:
      on a probe failure the log names the open dialog and the window it belongs to, falls back to a
      non-responding window, and says "not visible from outside" when neither applies. Validated live — during
      XAE startup it correctly reported no dialog rather than blaming one. So the next occurrence identifies
      itself, on any machine, without anyone watching.
- [x] 3.1 **CONFIRMED — staged one and reproduced the exact failure shape.** With a `#32770` dialog verified
      open BEFORE and AFTER the run, `endpoints/refs` went 3 pass / 6.6s → 0 pass, 2 fail, two 60s
      timeouts. Took three attempts: a hand COM probe answers in 4ms THROUGH a modal (it pumps its own
      message loop), so two earlier probes read as refutations. `ARCHITECTURE.md`'s "a modal blocks every
      COM call" was the misleading fact and is corrected. Original text: **Test the MODAL DIALOG first — it is now the better hypothesis.** A modal blocks COM on TwinCAT (a
      trap already recorded here), and the engineer saw a "saving project failed" modal during these runs. That
      explains the whole shape at once: a blocked COM call makes the ROT walk hang (measured >180s against a 6s
      budget), which BOTH suspends supervision and stalls the worker, producing the 60s/120s test timeouts.
- [x] 3.1b **RETRACTED, as this task required.** One clean run, both fixtures open, no dialogs: 159 pass /
      24 skip / 1 fail in 3.6 min, no timeouts (the failure is the deliberately-excluded Execute box; the
      skip delta is `vendor-parity` needing CODESYS, which was down). COM contention was never the cause.
      Original: Only then the two-XAE question. One clean run with two distinct projects open; if it is green, COM
      contention was never the cause and the 2026-09-03 diagnosis is retracted in writing.
- [x] 3.2 It did not still fail — 3.1 identified the initiator, so this arm does not apply. It did surface a
      defect in the diagnosis itself: `XaeWindows` matched dialogs by class `#32770`, and TcXaeShell's own
      `Help > About` is WPF — so the connector reported "no dialog open" while one blocked the probe. The
      rule now keys off the DISABLED window a modal leaves behind, moved into pure `ProbeDiagnosis` with
      five tests, and validated live. Original: If it still fails, the contention reading survives — and the probe log now says when supervision was
      suspended (`ProbeHealth`, shipped 2026-09-03), so the windows can be correlated with the failing tests.
