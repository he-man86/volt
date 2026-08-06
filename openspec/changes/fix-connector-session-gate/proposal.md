## Why

`optimize-volt-cli-architecture` closed 31 of 49 structural findings. Three of the ones it left are the same
defect wearing three faces, and they are the standing suspect for the two `conflict-resolve` e2e failures that
change parked with evidence:

1. **The wire `disconnect` gate has two owners.** Any pipe client can set `_paused` on the host; the connector's
   reconcile loop un-sets it within ~4 s by re-`connect`ing any project a live session wants. Whether a bridge
   stays gated depends on which of the two spoke last.
2. **Two systems answer "is this project served".** A project serves iff a live client session declares
   interest — but the CLI opens the pipe directly and never consults the connector. `volt push` cannot be gated
   by the connector's selection, by design; yet the connector's reconcile can un-gate a bridge the CLI paused.
3. **`test/Volt.Cli.Connector.ControlHarness` re-implements the interest→serving reconcile inline** instead of
   driving `Reconciler`, **with the opposite trigger semantics**. So the volt-control e2e asserts behaviour the
   product deliberately rejects — a fake that does not merely simplify but *contradicts*.

(3) is the ground floor. `ARCHITECTURE.md` §Conventions 10 already records why: a fake that encodes an invariant
the implementation breaks is worse than no fake, and 500+ green tests then assert a world where the divergence
cannot exist. That is exactly how the `IsConnected` / `BuildHealthResponse().Connected` divergence survived.

## What Changes

**Start by reproducing the failure, not by mapping.** This is the explicit method correction from the previous
change: its two highest-value defects — the TwinCAT save that never ran, and an e2e harness silently targeting
the wrong IDE — were both found in the first hour of running the baseline, while ~120 analysis agents produced
narrowing and correction. The map and the findings already exist with quoted evidence. What these gaps lack is a
**decision**, not discovery.

So: no phase 1, no phase 2. Reproduce, then design → refute → execute on the three questions above, ~10 agents.

- **Reproduce first.** The two parked `conflict-resolve` failures pass alone and fail in suite order, and
  `volt pull` fails at RESOLUTION (a `BridgeError`, never a wire refusal) rather than being refused. Move 19
  turned that distinction into a contract, so the signal is now reliable. Find which earlier suite leaves the
  bridge in the state, and whether the gate or the session model is what leaves it.
- **Decide who owns the gate**, and write it down: pause is a host fact and the connector must not silently
  resume it, OR pause is a session fact and the CLI must participate. One answer, not two.
- **Make `ControlHarness` drive `Reconciler`** so the e2e cannot agree with a reconcile the product does not run.
- Anything that turns out to be a behaviour change lands **red-first**, as its own commit.

**Explicitly NOT in scope**, with the arguments already recorded in the previous change's `findings.md` — do not
re-litigate without new evidence: relocating `Ops`/`BridgeErrorCodes`/`HealthStatus`/`Vendors` out of
`Volt.Cli.Transport` (moving the file enforces nothing, since `Volt.Cli` references both projects); the
`Volt.Engine` `using` cycle (no compile, build-order or test cost); and publishing `PipeJson.Options` (its
camelCase-write / case-insensitive-read asymmetry is deliberate, and a swap silently empties `PushRequest`).

## Capabilities

### New Capabilities

- `connector-session-gate`: who owns the disconnect gate, what "served" means when two systems can answer it,
  and the requirement that a test harness drive the product's own reconciler rather than its own copy.

## Impact

- **Code:** `Volt.Engine/Wire/BridgePipeHost` (the `_paused` gate), `Volt.Cli.Connector.Core`
  (`ConnectionManager`, `Reconciler`, `PerPipeProjectSource`), and `test/Volt.Cli.Connector.ControlHarness`.
- **Tests:** the two parked `conflict-resolve` e2e failures are the acceptance criterion. If the change is right
  they go green without being edited; if they need editing, the change is wrong.
- **Risk:** the gate decides whether a live PLC accepts writes. Every behaviour change lands red-first and is
  verified on both vendors live, because no C# suite reaches a real driver.
