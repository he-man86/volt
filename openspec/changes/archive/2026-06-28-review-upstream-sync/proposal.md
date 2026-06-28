## Why

The additive-fork foundation (phase **0**) and attribution (phase **0.5**) are shipped:
`.opencode/*` config, the verifier scripts, and `NOTICE`. Walk it to verify the invariants
still hold and capture them as the `upstream-sync` spec — including the **real seam surface**
(`check-divergence` reports **13**, not the stale "4 / 7–9" the prose docs claim).

## What Changes

- Author `specs/upstream-sync/spec.md` — the additive-fork rule, the 13-seam ledger (4
  clusters), `check-divergence` enforcement, and the merge/verify signal flow.
- Fold the relevant decision outcomes (D1, D2, D3, D5, D8, D9, D10) into that spec.

## Capabilities

### New Capabilities
- `upstream-sync`: Volt stays a purely-additive fork; the entire upstream-merge conflict surface is the enumerated 13 seams, enforced by `check-divergence`.

## Impact

Spec/docs only. No runtime change — this captures shipped behavior.
