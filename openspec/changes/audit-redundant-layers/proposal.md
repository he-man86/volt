## Why

Two consecutive refactors this week removed the **same antipattern** — a layer of derived/wrapper state built *on
top* of a data source that already carried everything, instead of just exposing the source:

- **`787381e991`** — the bridge served a separate `instances` op + a `health` op with a nested
  `instances[].projects[]` tree and 8 fields most consumers ignored. Folded into ONE flat, self-describing
  `health.projects[]` array; deleted the `instances` op, `activeOp`, and 8 dead/derived fields.
- **`47ab25c7a1`** — the connector's `/status` returned `{ aggregate-status, bridges[], projects[] }`. The
  aggregate word had **no consumer**, and `bridges[]` was read in **one** place only for a field the rows lacked.
  Collapsed to just `{ projects[] }` with the missing field moved onto the row.

Both were found by *following one consumer* and asking "does this layer add information the source doesn't already
have?" — the answer was no. The premise of this change: **that antipattern is not rare in this codebase, it is
systemic**, and a one-consumer-at-a-time discovery rate is too slow. There are almost certainly many more:
DTOs/views that re-shape a source with nothing added, fields duplicated across layers, dead compatibility shims,
forwarding wrappers, and re-fetches of data a prior call already returned.

The guiding principle the audit enforces: **what a layer exposes should BE the shape of its source, not a transform
on top of it.** A layer earns its existence only by adding information, enforcing a boundary, or absorbing an
irreducible asymmetry — never by re-packaging.

## What Changes

This is a **read-only audit first, then targeted cleanup** — not a predetermined edit list. It runs as a
**multi-agent fan-out**, one agent per subsystem, **starting at the CLI** and working outward, each hunting the
antipattern catalog in `design.md` and reporting findings; then a synthesis pass dedups + ranks them; then the
clear wins are applied in priority order, each landing green.

- **Audit** every subsystem for: redundant wrapper/view DTOs, derived fields that duplicate source data, dead or
  legacy compatibility shims + unused fields, one-implementation interfaces / pure-forwarding methods, redundant
  round-trips, and UI transforms an endpoint could return directly. (Full catalog + severity rubric in `design.md`.)
- **Triage** into a single ranked ledger: `delete` (dead), `collapse` (redundant layer), `derive` (duplicated
  field), `keep` (earns its place — record *why*, so the next audit doesn't re-flag it).
- **Apply** the confirmed wins, each a self-contained commit with the C# + volt-control + e2e suites green, in the
  same style as the two reference commits.
- **Guard** the classes that can re-rot (a vocabulary/shape re-spelled, a field re-duplicated) with a test where one
  exists cheaply — following the `VendorParityGuardTests` / `WireVocabularyGuardTests` precedent.

## Non-Goals

- No behavior changes, new features, or contract changes that a finding doesn't justify.
- Not a rewrite: the load-bearing asymmetries (`ARCHITECTURE.md` — CODESYS in-proc vs TwinCAT COM, per-pipe vs
  one-worker, the parity boundary at the wire) are **kept**; the audit must distinguish an irreducible asymmetry
  from redundant packaging and never "simplify" the former.
- Not a correctness/security review — that is `/code-review`'s job. This one hunts *structure*, not bugs (though a
  bug found in passing gets filed).
