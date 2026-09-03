## 1. Establish the baseline honestly

- [ ] 1.1 From a `git restore` + `git clean` of `test/fixtures/`, run the TwinCAT e2e three times WITHOUT
      cleaning in between, recording the failure set each time. If the count climbs, the fixture is the variable.
- [ ] 1.2 Run it three times WITH a clean between each. If those are identical, that is the proof.
- [ ] 1.3 Record both in the close-out. A flaky-suite claim without a before/after is how this got mis-attributed
      the first time.

## 2. Fix the source

- [ ] 2.1 Find what `cleanup()` leaves behind. The known residue: items under `VISUs/`, `DUTs/`, `GVLs/`,
      `POUs/POUs/`, plus `.tsproj`/`.plcproj`/`.tmc` edits the IDE writes on save.
- [ ] 2.2 Decide the route: complete the cleanup, or run against a copy as CODESYS does. Prefer the copy — it is
      the same shape as the vendor tier that does NOT have this problem, and it cannot be defeated by a test that
      forgets to register its own artefact.
- [ ] 2.3 A dirty-fixture pre-flight that REFUSES rather than warns, naming the paths and the command to fix it.

## 3. Then, and only then, the two-XAE question

- [ ] 3.1 One clean run with two distinct projects open. If it is green, COM contention was never the cause and
      the 2026-09-03 diagnosis is retracted in writing.
- [ ] 3.2 If it still fails, the contention reading survives — and the probe log now says when supervision was
      suspended (`ProbeHealth`, shipped 2026-09-03), so the windows can be correlated with the failing tests.
