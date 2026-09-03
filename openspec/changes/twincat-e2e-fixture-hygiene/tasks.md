## 1. Establish the baseline honestly

- [x] 1.1 **Partly done, and it answered the question earlier than planned.** One run from a restored
      fixture leaves only churn; four runs from restored fixtures each gave the same result. Original:
- [ ] 1.1-orig From a `git restore` + `git clean` of `test/fixtures/`, run the TwinCAT e2e three times WITHOUT
      cleaning in between, recording the failure set each time. If the count climbs, the fixture is the variable.
- [ ] 1.2 Run it three times WITH a clean between each. If those are identical, that is the proof.
- [ ] 1.3 Record both in the close-out. A flaky-suite claim without a before/after is how this got mis-attributed
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
- [ ] 2.3 ~~A dirty-fixture pre-flight that REFUSES~~ — **NOT AS SPECIFIED.** It would fire after every
      run, on `LineIds` churn that harms nothing, and would be disabled within a day. What is worth
      doing instead is silencing the churn so a dirty tree stays meaningful; see FINDINGS.md.

## 3. Then, and only then, the two-XAE question

- [ ] 3.1 One clean run with two distinct projects open. If it is green, COM contention was never the cause and
      the 2026-09-03 diagnosis is retracted in writing.
- [ ] 3.2 If it still fails, the contention reading survives — and the probe log now says when supervision was
      suspended (`ProbeHealth`, shipped 2026-09-03), so the windows can be correlated with the failing tests.
