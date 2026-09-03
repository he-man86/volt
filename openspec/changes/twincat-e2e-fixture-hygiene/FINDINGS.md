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

**This means a dirty-fixture pre-flight that REFUSES (task 2.3) would be wrong as specified.** It would fire
after every single run, on churn that harms nothing, and the first thing anyone would do is disable it.

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
