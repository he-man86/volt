## Why

The bridge silently **skips or drops** items in several situations, with no trace. When something goes
missing at a **customer** site — "my POU / a library type isn't in the workspace" — there is currently no
log and no field in the API response that says *what* was skipped and *why*. The recent strict **no-fallback**
policy sharpens this: a library element whose owning library doesn't match a `.library` ref by `RESOLUTION`
is now skipped entirely, silently. We need observability so these edge cases are debuggable in the field —
surface every skip/error (with a reason) in the `/fetch` (+ `/refs`) response and/or a structured, retrievable
log — and a deliberate analysis of the known edge cases so we decide per-case whether to fix, surface, or accept.

## Principle

**No fallback = never mask a bug.** The bridge (and the LSP) SHALL only return something when it actually
*identifies* it. When identification fails, it SHALL either **throw an error** or return an explicit
**`.unknown`** — never silently skip it (which hides the gap just like a fallback) and never guess it into a
plausible-but-wrong place. A silent skip and a fallback are the same sin: they cover a hidden bug. This
proposal's report + `.unknown` surfacing is how that principle is made observable.

## What Changes

- **Structured skip/error report** on the fetch/refs response — an additive `diagnostics` (or `skipped`) array,
  each entry `{ kind, name, reason, detail? }`, emitted at every drop site so a caller (CLI/LSP/support) can
  see exactly what the bridge omitted and why.
- **And/or a leveled bridge log** capturing the same, retrievable via an endpoint (extend `/debug`) or a file —
  so a customer session can be diagnosed after the fact.
- **Analyze the known edge cases** (below), decide per-case: fix the root cause, surface it, or accept it.

### Known edge cases (found 2026-07-06 against the AWA corpus; capture, don't fix here)

1. **Library facade / Interfaces↔Implementation split matching.** A `.library` ref's `RESOLUTION`
   (`CmpEventMgr, 3.5.17.0 (System)`) does not match its elements' concrete `LibraryPath`
   (`cmpeventmgr implementation, …`). CODESYS splits many libraries into Interfaces + Implementation and
   resolves placeholders to concrete libs with different identities — so RESOLUTION-based foldering orphans the
   elements. ~50 of 156 AWA library folders ended up EMPTY. (Previously masked by a fallback folder; the
   no-fallback change now skips them silently — the motivating example.)
2. **Libraries with NO precompiled signatures.** E.g. `L_MC1P_MotionControlBasic` (a target/device library)
   yields 0 sigs in a headless build. Genuinely-unavailable vs. a bug is indistinguishable without a signal.
3. **Render-null signatures.** Method/property sub-signatures (rendered via their parent FB) + unknown
   `POUType` — currently dropped by `LibSignatureRenderer.Render` returning null.
4. **Deliberate omissions.** `omitDeadCode` (uncompiled/unreachable project POUs) and `ExcludeFromBuild`
   objects are dropped on purpose — a customer needs to know a missing POU was *excluded*, not *lost*.
5. **Malformed items.** `Versioning.SafeVersion` returns null (unreadable/uncrashable) → the item is skipped.

## Impact

- `packages/volt-bridge` — `Volt.Bridge.Core/Sync/FetchService.cs` + `RefsService.cs` (the drop sites), the wire
  response types (`Wire/RefsFetch.cs`), and the `/debug` surface.
- Parity: both vendors (Core-shared, so CODESYS + Beckhoff get it uniformly).
- Non-breaking: an additive response field / log; no existing behavior changes.
- Consumers (`volt-git` pull/push, the LSP) MAY surface the report to the user; not required to.
