## Why

**Read this first: the evidence that motivated this change was disproved before it started.**

The original premise was that the two parked `lifecycle/conflict-resolve` e2e failures were caused by the
connector's session/gate model. They were not. Pinned to a stable XAE the TwinCAT suite is **90 pass / 11 skip /
0 fail**; the failures came from one fixture's TcXaeShell crashing and respawning mid-run, which made `volt init`
fail and produced a downstream assertion failure in an unrelated test. See
`openspec/changes/optimize-volt-cli-architecture/ledger.md`.

So this change **loses its acceptance criterion and most of its urgency**, and is re-scoped down to the one
finding that still has a demonstrable cost.

### What survives, and why

**`test/Volt.Cli.Connector.ControlHarness` re-implements the interest→serving reconcile inline instead of
driving `Reconciler` — with the OPPOSITE trigger semantics.** This is verifiable by reading, needs no live IDE,
and its cost is concrete: the `@volt/control` e2e can pass against behaviour the product deliberately rejects.
`ARCHITECTURE.md` §Conventions 10 already records why that class of defect matters — a fake that encodes an
invariant the implementation breaks is worse than no fake, because a green suite then asserts a world where the
divergence cannot exist. That is exactly how the `IsConnected` / `BuildHealthResponse().Connected` divergence
survived 500+ green tests.

It is also the last of the two "fakes that lie" identified as the ground floor. `FakeIde` was addressed by
moves 12 and 13 of the previous change; this is the other one.

### What is DEMOTED, not fixed

These remain true observations with **no demonstrated failure** behind them. They are recorded in
`optimize-volt-cli-architecture/findings.md` and should not be acted on until something concrete fails:

- the wire `disconnect` gate has two owners (a client sets `_paused`; the connector's reconcile can clear it);
- the CLI and the connector can both answer "is this project served", and the CLI never consults the connector.

Both were filed as the suspect for a failure that turned out to be a crashing IDE. Touching the gate that
decides whether a live PLC accepts writes, on the strength of a design smell with no failing test, is not a
trade worth making. **A finding whose cost cannot be stated as a concrete scenario is a preference.**

## What Changes

- **`ControlHarness` drives `Reconciler`** instead of its own inline copy, so the e2e cannot agree with a
  reconcile the product does not run.
- If that surfaces a real behavioural disagreement, it lands **red-first** as its own commit.
- Nothing else. The gate is not touched.

## Capabilities

### New Capabilities

- `connector-test-integrity`: a harness that exists to make an end-to-end test non-mock must exercise the
  product's own decision code, not a second implementation of it.

## Impact

- **Code:** `test/Volt.Cli.Connector.ControlHarness` only, unless driving the real `Reconciler` exposes a
  product defect — in which case that lands separately and red-first.
- **Tests:** `packages/volt-control`'s e2e must stay green, and must now be green for the right reason.
- **Risk:** low, and deliberately so. The high-risk half of the original proposal is demoted above with its
  reasoning, rather than carried along because it was already written down.
