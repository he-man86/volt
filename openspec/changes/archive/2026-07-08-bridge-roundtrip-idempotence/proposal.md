## Why

Data-loss bugs in the bridge have shipped before and were only caught by chance — e.g. TwinCAT `WriteText`
skipping empty impls so an emptied body was never cleared (the "empty-body-clear" incident). There is no
systematic gate proving the bridge is **lossless and idempotent**: that reading a project and writing it back
unchanged is a no-op, and that what you push is exactly what you get back. Every such bug is silent corruption of
a customer's PLC code — the highest-consequence failure this tool can have — and today nothing across the corpus
guards against the whole class.

## What Changes

- A **round-trip property test** over the existing test corpus (the 4 real projects), run against a live-ish or
  recorded bridge, asserting two invariants for both vendors:
  1. **Idempotence** — `pull` then `push` with no local edits produces zero write ops / a no-op push (the
     bridge and the workspace agree; nothing is "changed" that wasn't).
  2. **Losslessness** — `push X` then `pull` returns `X` byte-identical (`sourceText`, folder, name) for every
     item kind, including editable graphical VG bodies and the boundary cases that have bitten us (emptied
     bodies, whitespace-only impls, items with no declaration or no implementation).
- The gate SHALL exercise the boundary cases explicitly, not just the happy path, so a regression like
  empty-body-clear fails the gate rather than a customer.
- Wire it into the corpus/ratchet cadence already used for the LSP, so it runs as part of the normal check.

**Non-goals:** this does not add a wire field or change behavior; it is a test/verification gate. Where it
surfaces a real bug, that bug's fix gets its own colocated regression test (per the existing test policy).

## Impact

- `packages/volt-bridge` — a new round-trip test (C# e2e and/or the TS-side e2e in `test/e2e/**`), plus any
  fixtures needed to pin the boundary cases as ground truth.
- Parity: the property runs for CODESYS and TwinCAT identically (the wire is the boundary), so a divergence is a
  parity bug surfaced by the same gate.
- No runtime/product code change unless the gate finds a bug — then that fix is a separate, tested change.
