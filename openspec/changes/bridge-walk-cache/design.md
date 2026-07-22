## Context

Measured on a live 893-item CODESYS project: `status` ≈ 8.9 s (silent), `pull` ≈ 8.5 s, `push` ≈ 1.1 s. The status/pull cost is the uncached O(project) walk (`ProjectSnapshot.Walk` / `FetchService`): materialize + hash every item over COM, every call. `push` is cheap because it decides from local git and only calls the bridge when there is something to send. The `src/` watcher amplifies this: each edit burst triggers a ~8.9 s silent `status`.

The precompile is NOT the cost here — `status`/`refs` never build, and `pull`/`fetch`'s build is warm (a no-op) within a session. The walk is the cost, and Method C (library-signature gating) does not touch it.

## Goals / Non-Goals

**Goals (if ever pursued):**
- Make idle `status`/`pull` return in ~ms on large projects.

**Non-Goals:**
- Adding a progress bar to `status` — that papers over the cost, it doesn't remove it.
- Any cache that can silently miss an incoming IDE change.

## Decisions

**D1 — Deferred; gated on a safety spike.** Do NOT implement until a spike establishes a cheap, comprehensive IDE change signal. If none exists, drop the idea — slow-but-correct beats fast-but-occasionally-wrong on a sync tool.

**D2 — Why this is categorically riskier than the library cache.** The library cache is *content-addressed*: the `.library` version is read fresh (cheap) and is immutable per version, so "unchanged?" is answered by reading the actual thing. A walk cache **cannot read the items** (that's the walk it skips), so it must trust an **external** signal. A missed signal → stale map → the client silently misses a real incoming change → divergence. That is worse than being slow.

**D3 — The only safe shape.** *Confirm-then-serve*: on every request, cheaply check a project-modification token; serve the cache only if it matches, else re-walk. Correctness then reduces to "is the token comprehensive?" — which must be proven for undo/redo, programmatic edits, library updates, and externally loaded files, on both CODESYS and TwinCAT.

**D4 — Cheaper middle grounds to consider in the spike.** A per-object change stamp (skip re-materializing unchanged items while still confirming each cheaply) is safer than a project-level cache but needs the same "is it comprehensive?" proof. Or: leave the walk, but speed up the per-item materialize.

## Risks / Trade-offs

- [Stale cache → missed incoming change → silent divergence] → the whole reason this is gated. Never ship a `projectDirty`-edge cache; it has the documented same-dirty-cycle blind spot.
- [False confidence from a signal that looks comprehensive but isn't] → the spike must actively try to break it (undo, script, library swap, external load), not just confirm the happy path.

## Migration Plan

1. **Spike (gates everything):** does CODESYS (and TwinCAT) expose a cheap, comprehensive project-modification token / per-object change stamp? Try hard to find a mutation it misses.
2. If proven → design confirm-then-serve behind it. If not → close this change; pursue per-item materialize speedups instead.

## Open Questions

- Is there such a token on either vendor? (Unknown — the gating question.)
- Is a per-object stamp cheaper/safer than a project-level one?
