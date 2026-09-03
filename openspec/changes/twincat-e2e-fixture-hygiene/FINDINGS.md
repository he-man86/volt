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

**A "zero churn" observation on 2026-09-03 turned out NOT to reproduce, and chasing it is the most instructive
part of this change.** One bridge-clean-then-shutdown left the fixture with zero modified files, which suggested
the churn was an artefact of tearing down badly and that a refusing dirty-fixture pre-flight (task 2.3) was worth
having after all. It was recorded as one observation, explicitly not a pattern — and re-running it settled the
matter the other way: after two full runs plus a bridge-clean and an orderly `twincat-instances.ps1 down`, the
fixture came back with **seven modified files**. `.tsproj`, `.tmc` and three POUs' `LineIds`.

**The likely explanation for the zero arrived from outside the measurement.** During a later run the engineer
saw a TwinCAT modal: *"saving project failed"*. A save that FAILS writes nothing — which is indistinguishable,
from git's point of view, from a run that had nothing to write. So the clean fixture was probably a broken save,
not a tidy one.

**Conclusion, now with three data points instead of one: the churn is normal and unavoidable.** Task 2.3's
refusing pre-flight would fire on every run, and it stays dropped. This is the second time this change has been
about to build something on a single observation; both times the discipline in task 1.3 — record a before AND an
after — is what caught it.

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

## Runs 2026-09-03: results are stable while dirt accumulates

Three consecutive runs from a restored fixture, with NO cleaning in between (task 1.1). The third was cut short
by a tool timeout on my side, not by a test failure — and that accident produced the most useful result.

| Run | Result | Fixture files dirty after |
|---|---|---|
| 1 | 159 pass / 24 skip / 1 fail | 2 |
| 2 | 159 pass / 24 skip / 1 fail | 7 |
| 3 | interrupted mid-run | 9, one of them a LEAKED ITEM |

**The results did not move while the dirt grew.** The single failure both times is the Execute box, which is
excluded on purpose. So accumulated churn does not manufacture failures — which is the claim this change was
started to test, and it does not hold in the form it was written.

**What DOES leak is an interrupted run**, exactly as predicted: killing the runner mid-flight meant `afterAll`
never ran and `VltE2E_pf_fbtype.fb` stayed in the project, with an orphan `.TcPOU` on disk. The next invocation's
sweep found and removed it before any test executed — the mechanism shipped in `harness.ts`, demonstrated by
accident on the exact case it was written for.

## What remains open

The INITIATOR is still not identified, and there is now a much better candidate than COM contention: **a modal
dialog blocks COM on TwinCAT** — a trap already recorded in this repo — and the engineer saw
*"saving project failed"* during these runs. That would explain the whole shape at once: a blocked COM call makes
the ROT walk hang (measured at over 180s against a 6s budget), which both suspends worker supervision and stalls
the worker's own operations, producing the 60s/120s test timeouts. Worth testing directly before the two-XAE
question, which is now the weaker hypothesis.
