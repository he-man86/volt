## 1. Audit — where parity is maintained by discipline, not construction

- [x] 1.1 Inventory every place a **driver** decides a wire-visible outcome (not just provides data): select
      post-condition (DONE — lifted), fetch/init empty handling, health/serving derivation, build result mapping,
      refs. For each: is the decision identical across both drivers today? If not, it's drift.
- [x] 1.2 Inventory every exception a driver throws that can reach the wire. Flag any that is NOT a
      `BridgeException` (it becomes INTERNAL_ERROR or leaks vendor wording). Confirm `NoProjectSelectedException` now
      only escapes on the internal ATTACH path (never the wire) — document that boundary.
- [x] 1.3 Grep Core (`Volt.Engine`) and connector *logic* for `vendor ==` / `"twincat"` / `"codesys"` /
      vendor-specific types. Classify each as sanctioned (identity string, pipe-topology in `IProjectSource`) or
      drift (a behavioral branch that must move below the seam or be unified).
- [x] 1.4 Confirm `IsConnected` and `BuildHealthResponse().Connected` are the SAME signal on BOTH real drivers
      (already true for `FakeIde`) — Core post-conditions rely on it.

## 2. Lift parity-critical decisions into Core (one commit each)

**Test matrix — EVERY lift gets coverage at each applicable layer (write the test with the change, not after):**
- **L1 component** — the pure logic offline, via `FakeIde` (both connected + failing knobs).
- **L2 transport** — the op over a real pipe (`BridgePipeHost` + `PipeClient`), asserting the wire result/error code.
- **L3 CLI black-box** — where the CLI surfaces it (`BridgeClient`/`volt` command), asserting the user-visible outcome.
- **L4 conformance** — the same assertion run against BOTH drivers (see §4), so parity is proven, not assumed.
- **L5 e2e** — the COM-only slice against a live bridge, for what L1–L4 can't reach.
- **Regression net**: `WireContractParityTests` must stay green after every lift (byte-identical responses).

- [x] 2.1 `select` post-condition → `BridgePipeHost` (connected-or-PLC_DISCONNECTED, both vendors). *(shipped — L1+L2)*
      Backfill: L4 conformance assertion; L5 e2e note (the live two-window select).
- [x] 2.2 Empty-result handling: the CLI's `GuardEmptyItems` (0 items + not connected → refuse) is client-side;
      decide whether the bridge should assert the same invariant server-side so a direct pipe client can't be misled
      either. If so, lift to Core; keep the client guard as defense-in-depth. Cover L1/L2/L3.
- [ ] 2.3 Any other decision the 1.1 audit surfaces — each its own commit + the full applicable layer matrix above.
- [x] 2.4 Consider a distinct error code for "project not on this instance" vs the generic PLC_DISCONNECTED, IF the
      audit shows the coarse code hurts the UX — add to `BridgeErrorCodes`, applied uniformly (L2 asserts the code).

## 3. Shrink the seam + single error channel

- [ ] 3.1 Reduce `IIdeDriver` (`IIdeSession`/`IProjectTree`/`ICodeStore`) to irreducible primitives; move any lifted
      policy out. Document at the interface: "this is the ONLY seam; it exposes primitives, never wire decisions."
- [ ] 3.2 Retire vendor exceptions from the wire path (from 1.2). Where a driver must signal a condition, it returns
      state Core inspects or throws a shared `BridgeException`.
- [ ] 3.3 Keep the load-bearing asymmetries BELOW the seam untouched (COM/reflection, ROT, STA pump, NWL parser,
      file-based PlcOpen) — the `ARCHITECTURE.md` list is the guardrail.

## 4. Prove it — conformance + anti-drift

- [ ] 4.1 A shared conformance suite: the same behavioral assertions (select post-condition, error codes, health
      signal, tree-walk invariants) run against BOTH drivers where a fake/headless IDE is feasible. Seed from
      `WireContractParityTests`.
- [ ] 4.2 Mark the COM-only assertions as the e2e tier (run against the live two-window setup, not CI) — document how
      to run them, as with the existing e2e.
- [x] 4.3 Anti-drift guard: a test that fails if a new vendor branch appears in Core/connector logic outside the
      sanctioned spots (from 1.3). Cheap grep-style assertion; turns the convention into a gate.

## 5. Document

- [x] 5.1 `ARCHITECTURE.md`: restate the rule — "any per-vendor difference Volt SEES is a bug; the asymmetry is only
      below the pipe" — and list which differences are legitimate (the mechanisms) vs forbidden (wire behavior/errors).
- [x] 5.2 Point the "load-bearing asymmetries — don't unify" section at the enforcement (the conformance suite + the
      anti-drift guard) so a future reader knows parity is now mechanical, not aspirational.
