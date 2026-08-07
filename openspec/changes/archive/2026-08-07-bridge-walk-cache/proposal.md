## Why

`volt status` (`/refs`) and `volt pull` (`/fetch`) both walk and re-hash **every** project item on **every** call, with no bridge-side cache. Measured on a real 893-item CODESYS project (installed bridge):

- `status` ≈ **8.9 s** — and **silent** (it streams no progress; it just blocks, then prints the result),
- `pull` ≈ **8.5 s** (shows `N/893` progress, but it's re-hashing mostly-unchanged items),
- `push` ≈ **1.1 s** (decides from local git; only hits the bridge if there's something to send).

The ~8.5 s is the uncached O(project) walk: each item is materialized over COM and hashed to compute its version, redone from scratch each time. It's also *amplified* by the `src/` watcher, which fires a `status` refresh after each edit burst — an ~8.9 s silent operation per burst on a large project.

**This is a FUTURE OPTION, deliberately deferred — not scheduled.** It is documented here because the obvious fix (cache the walk) is **too risky to adopt without proof**, and that reasoning should be on record rather than rediscovered.

## What Changes

Nothing yet. This records a deferred optimization and, critically, the safety bar it must clear first.

Sketch of the option: keep the item→version map in the long-lived bridge host and avoid re-walking when nothing changed, so idle `status`/`pull` return in ~ms.

**Why it is NOT safe by default (the load-bearing point):**
- Unlike the *library* cache (which is content-addressed — the `.library` version is read fresh and is immutable per version), a walk cache **cannot read the items** (that's the walk it's skipping). It must trust an **external change signal**.
- `projectDirty` is one boolean for the whole project and only edges clean→dirty; further edits within the same dirty session raise no edge (the documented same-dirty-cycle blind spot). Change *events* may not cover every mutation path (undo/redo, programmatic edits, library updates, externally loaded files).

  > **CORRECTED by the spike (see `tasks.md` 1.1).** `projectDirty` is NOT the only signal available. CODESYS
  > exposes a per-object `ModificationCounter` and `TimeStamp`, including on the not-yet-deserialized STUB
  > (`IMetaObjectStub3`/`IMetaObjectStub2`, reachable via `GetMetaObjectStub`) — i.e. readable without paying the
  > materialization this cache exists to avoid. TwinCAT exposes nothing equivalent (502 members across 10
  > `ITcSmTreeItem*` interfaces, zero stamps). So the change closes on the CROSS-VENDOR gate, not on "there is no
  > signal". The rest of the risk argument below stands unchanged and is the reason a CODESYS-only cache still
  > would not be safe without the break-it matrix.
- A missed signal means the cache serves a **stale version map** → the client **silently misses a real incoming IDE change** → workspace/IDE divergence with no error. That is strictly worse than the current slow-but-always-correct full walk.

**Precondition (the gate):** a **cheap, provably-comprehensive** project-modification token (or per-object change stamp) the bridge can **confirm on every request** — so it *verifies* freshness rather than *assuming* it. Only then does correctness reduce to "does this token cover every mutation path?", which must be **proven**, not assumed.

## Capabilities

### New Capabilities
- `bridge-walk-cache`: (future/deferred) a bridge-side item-version cache for `/refs` and `/fetch`, valid only behind a proven, comprehensive, cheap IDE change signal.

## Impact

- None now (documentation only).
- If ever pursued: `Volt.Engine/Sync` (RefsService/FetchService/ProjectSnapshot), the vendor drivers (the change-signal source), gated by a spike. Would ride the same discipline as the library change (a T1-style spike gates the whole thing).
