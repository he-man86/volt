# Findings — the residue is not what the proposal assumed

Measured 2026-09-03. The proposal said *"the suite's cleanup does not fully undo itself"* and inferred that
leftover ITEMS accumulate. That is half right, and the half it got wrong changes the fix.

## What one clean run actually leaves

From a `git restore`d fixture, one full TwinCAT run leaves **five modified files and nothing else** — no leaked
items, no leftover folders. And every one of the five is a single changed line:

```
-      <LineId Id="76691" Count="40" />
+      <LineId Id="82922" Count="40" />
```

`LineIds` is TwinCAT's own line-number bookkeeping, bumped whenever the IDE rewrites a textual body. The ST
above it is byte-identical. So on a HEALTHY run `cleanup()` does undo itself: the residue is cosmetic IDE churn
that dirties `git status` and changes nothing a test can observe.

**…but that churn may be an artefact of how I was tearing down, not of running the suite.** Later the same day,
after cleaning the projects THROUGH THE BRIDGE (delete the `VltE2E_*` items over the wire, so the IDE performs
the removal) and then closing the IDEs with `twincat-instances.ps1 down`, the fixture came back **completely
clean — zero modified files.** The earlier five-file measurement was taken with the IDE still open and after I
had been `git restore`-ing underneath it, which is its own kind of mess: TwinCAT holds an in-memory model and
writes it back on save, so restoring files under a live IDE leaves disk and IDE disagreeing about the project.

That is one observation, not a proven pattern, and it is recorded as such — claiming reproducibility from a
single run is the mistake this change exists to stop. But it points at a different conclusion than the paragraph
above: if an orderly run leaves NO churn, then a dirty fixture is meaningful after all, and **task 2.3's refusing
pre-flight becomes worth having rather than noise.** Confirming it needs three runs each followed by a
bridge-clean shutdown.

**The operational rule is settled either way: clean through the bridge, not with `git restore`.** Git cannot see
the IDE's in-memory state; the bridge is the only route that leaves both ends agreeing.

## Where the cascade actually comes from

`cleanup()` runs in `afterAll`/`afterEach` — precisely where it does NOT run when a test **times out** or the
runner is interrupted. Everything that run created stays in the project, and the next run starts against it.
Leftovers make more tests fail, more failures skip more cleanup, and the count climbs run over run.

That fits both measurements exactly. `unify-item-pipeline`: *"3, then 8, then 0 failures depending only on how
used the project copy was"* — the 0 is the run after a restore. 2026-09-03: 4, 1, 2, 7, where the 7 was furthest
from a restore, and every run from a restored fixture gives the same number.

**So the fixture is an AMPLIFIER, not an initiator.** Something else causes the first timeout; the missing
cleanup turns one bad run into a bad afternoon. Both halves are worth fixing and only one of them is this change.

## What was done

**A run-once sweep in `requireHealthy`** (`harness.ts`). It deletes any `VltE2E_*` item left by a previous run,
once per process, before any test executes, and logs what it found. `requireHealthy` is the hook because it is
the one call every file already makes first — 32 of 35 — and the per-file hooks are what failed: several files
clean only AFTER themselves, so a file running behind a timed-out one still started dirty. Best-effort by
design: a sweep that could fail the suite would be worse than the problem.

**The stray root folder is gone.** `endpoints/push.test.ts` passed a BARE `FOLDER` ("POUs") as a top-level
`toFolder` at eight sites, creating a stray `POUs` at the project root on every run — the harness gained
`plcFolder()` precisely because a bare name is not a wire folder, and this file predates it. Its assertion had
been loosened to `.endsWith(FOLDER)` to tolerate exactly that; it is an exact compare now, so the same mistake
cannot pass again.

## Result

Both vendors now report **170 pass / 12 skip / 1 fail**, identically, the one failure being the Execute box that
is excluded on purpose. TwinCAT had been reporting 159/24/1 — eleven tests that were skipping now run, so the
two tiers agree for the first time.

## Still open

- **The initiator.** What causes the first timeout is not established. The COM-contention reading (two XAE
  instances) is not disproven — it is now testable, because the fixture is no longer a second variable, and
  because `ProbeHealth` (shipped 2026-09-03) logs when worker supervision was suspended so the windows can be
  correlated with the failing tests.
- **The line-id churn.** Cosmetic, but it means `git status` is never clean after a run, which is its own small
  tax: it trains people to ignore a dirty tree, and it is how a real fixture edit gets committed by accident.
