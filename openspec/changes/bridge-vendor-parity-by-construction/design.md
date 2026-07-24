## Context

Two vendor bridges (CODESYS in-proc net48 library; TwinCAT standalone net8 exe over COM) must serve **byte-identical
responses** to the `volt` CLI over a named pipe. Today the shared `Volt.Engine` Core (`Wire/BridgePipeHost` + the
`Sync/` services + the DTOs) is genuinely shared, and each vendor implements one seam (`IIdeDriver`). That gets most
of the parity for free. But the *behavior* of the seam's methods is not constrained by types, and it drifted — the
two-window TwinCAT select bug is the proof: `SelectProject` "succeeded" into a not-connected state on one vendor and
was never checked on the other.

The first fix (committed) moved the select post-condition into Core. This design is about doing that **systematically**
and adding the enforcement so it can't drift again.

## Goals / Non-Goals

**Goals:**
- Any per-vendor difference **Volt sees** is a bug the tooling catches. Only the IDE-connection layer (below the pipe)
  may differ.
- Parity-critical decisions have exactly ONE implementation (in Core), so the type system prevents a driver from
  diverging them.
- A single wire-error vocabulary; the same failure is the same code on both vendors.
- Both drivers pass one conformance suite for the behavior types can't express.

**Non-Goals:**
- Unifying the *mechanisms* the `ARCHITECTURE.md` calls load-bearing: in-proc-library vs COM-attach, one-pipe-per-IDE
  vs one-worker-multiplexed, in-memory vs file-based PlcOpen, the TwinCAT NWL parser. Those live **below** the seam
  and stay per-vendor. This change sharpens the boundary; it does not erase the asymmetry.
- Changing the wire contract. Clients see the same ops/DTOs — just more uniform behavior and error codes.
- A multi-session model (syncing several projects at once). TwinCAT is one-worker-one-project by construction; that's
  a separate, larger question, explicitly out of scope.

## Decisions

**The seam is a set of PRIMITIVES, not POLICIES.** A driver should expose "attach to instance X / project Y,"
"what am I attached to," "walk the tree," "read/write this item," "raw health state" — and nothing that *decides* a
wire outcome. Every decision ("is this a valid selection?", "is 0 items real?", "which error code?") belongs to Core.
Rule of thumb: if two correct drivers could reasonably answer a method differently in a way the CLIENT would notice,
that method is a policy and must move up.

**One error channel.** Only `BridgeException` (with a `BridgeErrorCodes` string) may cross the wire. Drivers throwing
vendor-specific exceptions on the wire path is the defect — those become `INTERNAL_ERROR` or leak vendor wording.
Sweep them; where a driver genuinely needs to signal a condition, it either returns state Core inspects, or throws a
`BridgeException` with a shared code. (The TwinCAT `NoProjectSelectedException` stays ONLY for the internal attach
path, which never reaches the wire — verify that boundary.)

**Post-conditions live in Core, checked against shared state reads.** The select post-condition reads `IsConnected`
(a plain field read — no COM, safe on the STA thread). Generalize: any op whose success is a state invariant checks
that invariant in Core after delegating the vendor primitive. This is why `IsConnected`/`BuildHealthResponse` must be
the SAME signal on every driver (already aligned in `FakeIde`; verify both real drivers).

**Conformance suite over both real drivers.** Types can't assert "select leaves the bridge connected or throws
PLC_DISCONNECTED." A parametrized suite that runs the same assertions against `CodesysDriver` and `BeckhoffDriver`
(where a fake/headless IDE is feasible) — plus the existing `WireContractParityTests` at the wire level — is the
mechanical enforcement. Some assertions can only run live (COM), and are marked as the e2e tier.

**Anti-drift guard.** A cheap test that greps Core + connector logic for `vendor ==`/`"twincat"`/`"codesys"` outside
the sanctioned identity/pipe-topology spots, and fails on a new one. Cheap, and it turns the convention into a gate.

**Sequencing — small, independently shippable steps** (each green before the next):
1. Audit + inventory every place a driver decides a wire outcome or throws a non-`BridgeException` on the wire path.
2. Lift them into Core one at a time, each with a `FakeIde`-driven transport test (the select one is the template).
3. Introduce the conformance suite; move existing per-driver behavioral tests into it.
4. Add the anti-drift guard; fix whatever it flags.
5. Update `ARCHITECTURE.md`: legitimate-below-the-pipe vs forbidden-above-it, and point at the enforcement.

## Risks / Trade-offs

- **Lifting logic into Core can subtly change a vendor's behavior.** → Each lift is one step with a transport test
  that pins the before/after wire result; the 461-test suite + `WireContractParityTests` are the net. Never lift two
  things in one commit.
- **A post-condition that's right for one vendor is wrong for the other.** (e.g. CODESYS "select" is a no-op refresh;
  a naive "served name must equal requested name" check could reject a legitimate refresh.) → Post-conditions are
  stated in terms of the SHARED contract (connected/serving), not vendor specifics; where a genuine difference
  exists, it's a capability (`canServeConcurrently`) surfaced explicitly, not a hidden branch.
- **Over-shrinking the seam** — forcing an irreducibly-vendor thing (NWL parse, COM ROT) up into Core. → The
  `ARCHITECTURE.md` asymmetry list is the guardrail; those explicitly stay below the seam. The guard checks Core, not
  the driver internals.
- **Conformance tests that need a live IDE can't run in CI.** → Split: the FakeIde/wire-level assertions run in CI;
  the COM-level ones are the documented e2e tier (run on a dev box / the two-window setup), same as today.

## Migration Plan

Incremental, no big-bang. The select post-condition (already shipped) is step 2's template. Each subsequent lift is a
self-contained commit: identify the per-vendor decision, move it to Core, add/inherit the transport test, confirm the
full suite + parity tests stay green. The conformance suite and anti-drift guard land once the lifts are done, so they
codify the end state rather than a moving target. `ARCHITECTURE.md` is updated last, describing what IS rather than
what's intended.

**Rollback:** every step is a revertible commit that restores the per-driver logic; the wire contract never changed,
so a revert is invisible to clients.
