## Why

**The TwinCAT e2e suite's failure count depends on how used the fixture project is, and every live verification
in this repo rests on that suite.** A tier that reports a different number each run cannot tell anyone when
something broke — and worse, it invites a wrong diagnosis, because the failures look like a hung bridge.

Measured twice, ten months of work apart, by two people who did not know about each other's measurement:

| When | Evidence |
|---|---|
| `unify-item-pipeline` | *"the same reverted code gave 3, then 8, then 0 failures depending only on how used the project copy was"* |
| 2026-09-03 | four full runs gave **4, 1, 2 and 7** failures; the 7-failure run was the one furthest from a `git restore` of the fixtures, the stable runs immediately followed a clean |

The second measurement cost a day. The failures are TIMEOUTS — 120 s, 60 s, on `CRUD cycle` and
`clear-on-empty` — so they read as an unresponsive bridge, and were diagnosed as COM contention between two XAE
instances before the earlier note surfaced. Both explanations still fit the data; that is exactly the problem.

**The suite's cleanup does not fully undo itself.** That is not only a test-hygiene issue: it is also how the
committed fixtures came to reference files that do not exist, which took a separate fix.

## What Changes

- **Make the suite's cleanup complete**, or make each run start from a copy. CODESYS already runs against its
  own copy (`codesys-pipe.ps1`); TwinCAT opens `test/fixtures/TwinCAT Project13|14` IN PLACE, which is the
  difference.
- **Fail loudly on a dirty start.** A pre-flight that refuses to run against a fixture with uncommitted changes
  turns a silent false failure into a one-line instruction.
- **Then re-test the two-XAE hypothesis on a clean fixture.** The COM-contention reading is not disproven — it
  is unmeasurable while the fixture is a second variable. One clean run with two distinct projects settles it.

## Impact

- `packages/volt-cli/test/e2e/harness.ts` — cleanup, and the pre-flight
- `packages/volt-cli/scripts/twincat-instances.ps1` — the copy, if that is the route chosen
- No product code. This is about being able to trust the only tier that touches a real PLC.

## Not in scope

The Execute box, which is the one CONSISTENT failure on both vendors and is excluded deliberately.
