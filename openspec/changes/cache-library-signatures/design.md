## Context

`FetchService` calls `ide.ExtractLibrarySignatures()` on every pull/init. In CODESYS (`CodesysObjectModel.cs:538`) that does `Build(app)` (a precompile) then reads `LanguageModelMgr.AllPrecompiledSignatures`. A headless-CODESYS spike (fixture: 24 libs, 590 sig items) measured cold fetch **2469 ms** vs warm **97 ms**, with resolutions carrying versions and signatures byte-stable across fetches. So CODESYS keeps the precompile warm within a session; the cold cost is the first pull of a session (or post-Clean) and scales with library count (5220+ sigs on real corpora). The extraction is safely cacheable because a library's API is immutable per version.

`FetchService` already skips extraction for a directed `onlyItems` fetch (the diff preview). This change caches it for the full-fetch (pull/init) path.

## Goals / Non-Goals

**Goals:**
- Skip the cold precompile when the referenced-library resolution set is unchanged.
- Keep the fetch output byte-identical on a hit; keep `projectVersion`/`structureVersion` unaffected.
- Preserve live project-item change detection (either side may edit at any time).
- Vendor-agnostic seam; CODESYS-only behavior for now.

**Non-Goals:**
- No caching of the project-item walk or versions.
- No wire/protocol change.
- Not a per-warm-pull optimization — the spike shows warm pulls are already ~fast; the win is cold/first-fetch and large projects.
- No TwinCAT behavior (no library signatures there yet).

## Decisions

**D1 — Cache key = the referenced-resolution set.** The spike confirmed every `.library` resolution carries its version, and signatures are byte-stable per resolution. A sorted set (or hash) of the live referenced resolutions is the fingerprint. *Alternative:* hash the extracted signature contents — rejected: that requires the extraction we are trying to skip.

**D2 — Wrap in `DriverBase`, over two new driver primitives.** `DriverBase.ExtractLibrarySignatures()` becomes a cache wrapper calling abstract `ReferencedLibraryResolutions()` (build-free fingerprint) and `ExtractLibrarySignaturesUncached()` (the current build+extract). Beckhoff overrides both as no-ops (returns empty) until TC gains signatures. *Alternative:* cache inside each driver — rejected: duplicates the cache logic per vendor.

**D3 — Preserve the extract-before-walk ordering on a miss.** Today extraction runs before `WalkItems` so a build can't stale item handles mid-materialize. The fingerprint read must be build-free so it can run first; on a **hit** there is no build (safe to proceed to the walk); on a **miss** the build still happens before the walk (unchanged ordering). This is why D-spike task T1 (confirm the resolution read is build-free and separable from `AllPrecompiledSignatures`) gates the implementation.

**D4 — Two tiers, phased.** Phase 1: in-proc session cache (simple field, correctness-complete). Phase 2 (optional): persist `fingerprint → rendered signatures` to disk (e.g. under `.git/volt/`) so the first pull after reopening the IDE also skips the cold precompile — this is where the user-visible win concentrates. Ship Phase 1 first; measure; decide on Phase 2.

**D5 — Fingerprint read strategy.** Prefer a targeted Library-Manager reference enumeration (metadata) for `ReferencedLibraryResolutions()`. If that proves entangled with the compile context, fall back to deriving the fingerprint from the `.library` items the walk already produces (build-free manifest reads) and restructure so the fingerprint is available before deciding to build. T1 resolves which.

## Risks / Trade-offs

- [The resolution read secretly needs a build] → **T1 spike gates this**: verify `ReferencedLibraryResolutions()` triggers no precompile against headless CODESYS before building on it. If it can't be made build-free, the change is not worth it (a build to avoid a build) — abort or fall back to D5's walk-derived fingerprint.
- [Cache serves stale signatures after an in-place library re-import at the same version] → treated as out of scope: libraries are immutable per version by the stated invariant; a same-version content change doesn't happen in practice. If ever needed, the disk tier can additionally key on the library file mtime.
- [Marginal within-session benefit] → acknowledged; Phase 1's value is mostly removing the redundant `Build(app)` call + render pass; the headline win needs Phase 2 (cross-session) or a large project. The spike numbers set the expectation honestly.
- [Multi-instance / rebind] → the in-proc cache is per session/driver instance; a `SelectProject` rebind must clear it (new project ⇒ new library set anyway, but clear to be safe).

## Migration Plan

1. **T1 spike** (headless CODESYS): confirm a build-free `ReferencedLibraryResolutions()`; measure cold vs hit; confirm byte-identical output. (The proposal's numbers are the starting evidence.)
2. Implement the `DriverBase` cache seam + CODESYS primitives (Phase 1, in-proc).
3. Verify on headless CODESYS: cache hit skips `Build(app)` (assert via timing + a build-count probe) and the fetch response equals a cold fetch.
4. Measure on a large corpus project to quantify the real cold-first-fetch saving; decide Phase 2 (disk).
5. Rollback is a straight revert (the uncached path is preserved as `ExtractLibrarySignaturesUncached`).

## Open Questions

- Is `ReferencedLibraryResolutions()` genuinely build-free? (T1 — the load-bearing unknown.)
- Phase 2 disk cache location + invalidation (mtime? version-only?) — defer until Phase 1 is measured.
- Does an app edit ever invalidate the CODESYS library precompile within a session (forcing a re-precompile)? The spike didn't edit; worth a follow-up measurement, though libraries shouldn't depend on app code.
