# Close-out — the subject shipped; one open item outlived it and moves out

Closed 2026-09-03 at 10 of 12. **The change's actual subject is done**: the write path's `pouVg` boolean, which
forked nine decisions across `PushService`, no longer exists anywhere in the tree. The read/write asymmetry the
`## Why` opened on is gone — `ICodeStore` speaks `ItemContent` in both directions and the per-kind document shape
lives below the vendor seam.

The two remaining boxes are not the subject. Both are findings the work produced, parked here because it was the
open change at the time.

## 1. TwinCAT single-document write — a recorded dead end, kept as one

Attempted, turned on, reverted. Preserved because the next attempt should start from what it cost rather than
rediscover it:

- **DUT/GVL must be excluded.** TwinCAT cannot export them at all (`E_FAIL`, DIALECT C2), so widening the
  document path to every kind put a DUT on a path whose first step is an export that cannot happen.
- **Turning it on lost a POU's CHILDREN — 30 live failures, cause never found.** A method vanished across an
  in-place edit, while a hand-spliced document through the SAME delete-then-import round trip kept its children
  (D2). So the difference was in what `PouDocument.Splice` produced, not in the transport.
- **Placement is still blocked**: `ExportChild`/`ImportChild` exist (D4, corrected), but the archive carries the
  item's SOURCE PATH, so importing into another folder yields `dest/originalPath`.

Since then, `D32` measured something that bears directly on any retry: **`ExportChild` does not see tree-node
writes.** The live node read back `out := a;` while the archive exported in the same instant carried an empty
`<ST/>`. A single-document write that mixes tree writes and archive round trips will reproduce the lost-children
symptom for exactly that reason, and the shipped member-body path only works because it orders the archive
FIRST and the tree writes second. That is the thread the 30 failures were on.

## 2. The dirty-fixture finding moves OUT, because it is still live

> *"The TwinCAT e2e leaves the fixture DIRTY, and a re-run on a used copy reports false failures. Measured the
> confusing way: the same reverted code gave 3, then 8, then 0 failures depending only on how used the project
> copy was."*

**Re-confirmed 2026-09-03, and it cost a day's misattribution.** Four full TwinCAT e2e runs gave 4, 1, 2 and 7
failures. The 7-failure run was the one furthest from a `git restore` of the fixtures; the stable runs followed a
clean. The failures were TIMEOUTS (120 s, 60 s), not assertion failures, which reads like a hung bridge and was
diagnosed that way — as COM contention between two XAE instances — before this note surfaced and offered a
simpler cause that had already been measured once.

That is the real cost of leaving it in a closing change: a finding nobody can find gets re-derived wrong.

It moves to `twincat-e2e-fixture-hygiene` with both measurements attached. The point is not which explanation
wins — it is that a suite whose failure count depends on how used the fixture is cannot tell anyone when
something broke, and every live verification in this repo rests on it.
