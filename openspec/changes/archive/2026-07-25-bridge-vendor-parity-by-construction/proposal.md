## Why

Volt's promise is that both PLC vendors are **byte-identical over the pipe** — "the parity boundary is the pipe,"
per `ARCHITECTURE.md`. But that parity is currently maintained by *discipline*, not by *construction*, and it
drifted: a two-window TwinCAT `select` returned zero items and reported a misleading error, while CODESYS had no
equivalent check at all. The rule "a select must leave the bridge serving the requested project or fail loud" lived
**per driver** — TwinCAT threw its own exception, CODESYS didn't check — so the same failure produced *different*
(or no) wire behavior. That is exactly the class of bug the pipe-parity boundary is supposed to make impossible.

The user's framing is the right test: *if Volt sees a per-vendor difference, that is unintentional; only the
IDE-connection layer (below the pipe) may differ.* Today the type system enforces ~80% of that — both vendors
implement one `IIdeDriver` seam and the whole `Wire`/`Sync` layer is shared Core — but the **semantics and error
identity** of the driver methods are not enforced. A driver can silently do the wrong thing and the types are happy.

A first increment already landed: the `select` post-condition moved into `BridgePipeHost` so both vendors get it
identically (committed). This change generalizes that move into a principle the codebase enforces mechanically.

## What Changes

- **Lift every parity-critical decision out of the drivers into shared Core**, so there is ONE implementation of the
  wire semantics and the type system guarantees a driver can't override it (it won't have the method). The `select`
  post-condition was the first; audit the rest (health/serving derivation, empty-result handling, error mapping).
- **One error channel: the shared `BridgeException`/`BridgeErrorCodes`.** Drivers may not throw vendor-specific
  exception types that reach the wire — "can't serve the requested project," "wrong project," etc. must be the same
  code on both. Retire vendor exceptions from the wire path (the TwinCAT `NoProjectSelectedException` on the select
  path is already gone; sweep the rest).
- **Shrink `IIdeDriver` to irreducible vendor primitives** — attach/detach, tree walk, code read/write, raw health
  state — documented as "the only seam." Anything that isn't irreducibly vendor-specific moves up to Core.
- **A shared conformance suite run against BOTH drivers** for the behavior types can't express (post-conditions,
  error codes, tree-walk invariants). `WireContractParityTests` is the seed; grow it into the enforcement.
- **A guard against re-drift**: a check (test or lint) that fails if a vendor branch (`vendor == "twincat"` /
  vendor-specific type) appears in Core or the connector's logic — the parity boundary is the pipe, and the tooling
  should say so.
- **BREAKING**: none externally. The wire contract is unchanged (it becomes *more* uniform, not different); the
  drivers' internal responsibilities shrink.

## Capabilities

### New Capabilities
- `bridge-parity-enforcement`: how vendor parity is guaranteed by construction — where the seam is, which decisions
  are Core-only, the single error contract, and the conformance suite that proves both drivers honor it.

### Modified Capabilities
<!-- None in openspec/specs (the archived spec tree was removed; bridge invariants live in ARCHITECTURE.md). This
     change adds the first, and updates ARCHITECTURE.md's "load-bearing asymmetries" section to state which
     differences are legitimate (below the pipe) vs forbidden (above it). -->

## Impact

- `src/Volt.Engine/Wire/BridgePipeHost.cs` — the home for lifted post-conditions (the single error boundary already).
- `src/Volt.Engine/Ide/IIdeDriver.cs` (+ `IIdeSession`/`IProjectTree`/`ICodeStore`) — shrink to primitives; document
  the seam.
- `src/Volt.Cli.Ide.Codesys/*`, `src/Volt.Cli.Ide.Twincat/*` — remove lifted logic + vendor exceptions from the wire
  path; keep only irreducible glue (COM/reflection, ROT, STA pump, NWL parsing — the documented asymmetries).
- `src/Volt.Engine/BridgeException.cs` — the one error vocabulary; possibly new codes (e.g. a distinct "project not
  on this instance" if PLC_DISCONNECTED is too coarse).
- `test/` — a shared conformance suite driving both drivers; the anti-drift guard.
- `packages/volt-cli/ARCHITECTURE.md` — restate the asymmetry rule as "below the pipe only," list what's legitimate.
