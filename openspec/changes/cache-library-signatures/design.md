## Context

`FetchService` calls `ide.ExtractLibrarySignatures()` on every pull/init. In CODESYS (`CodesysObjectModel.cs:538`) that does `Build(app)` (a precompile) then reads `LanguageModelMgr.AllPrecompiledSignatures`. A headless-CODESYS spike (fixture: 24 libs, 590 sig items) measured cold fetch **2469 ms** vs warm **97 ms**, with resolutions carrying versions and signatures byte-stable across fetches. So CODESYS keeps the precompile warm within a session; the cold cost is the first pull of a session (or post-Clean) and scales with library count (5220+ sigs on real corpora). The extraction is safely cacheable because a library's API is immutable per version.

`FetchService` already skips extraction for a directed `onlyItems` fetch (the diff preview). This change avoids it for the full-fetch (pull/init) path when the referenced libraries are unchanged.

## Facts established by headless-CODESYS spikes (this session)

- **The build is genuinely needed.** On a freshly-loaded project `AllPrecompiledSignatures` returns only **281 of 852** signatures; `Build(app)` (**1904 ms**) produces the rest. So skipping the build when unchanged is a real ~1.9 s cold-start saving (and it scales — real corpora have 5220+ sigs).
- **CODESYS keeps the precompile warm within a session.** fetch #1 = 2469 ms (cold) vs fetch #2 = 97 ms (warm, `Build(app)` is a no-op). ⇒ The win is the **first fetch of a session / after a Clean / a library version swap**, NOT warm pulls.
- **Library SIGNATURE items are not tracked.** They are absent from `Items`/`removed` (the sidecar's `Items` never contains them); they ride in `changed` every fetch and are materialized. So skipping them is safe — the client keeps its existing files and `BuildVoltIdeTree` carries them forward by SHA. **There is no "removed" miscount to handle.**
- **`.library` MANIFEST items ARE tracked and hashed exactly like files.** Each is a normal item versioned by `SafeVersion` (content hash of its manifest, which encodes name+version+deps), carried in `Items`/`knownItems`/the sidecar. So "did a library change?" is already answered by the same machinery that answers it for every other file. `FakeIde.Item.Library(...)` can emit one, so this is offline-testable.

## Method comparison — how to decide whether to extract

| | A. In-proc cache (currently on `dev`) | B. New client fingerprint field | C. Reuse `.library` versions from `knownItems` |
|---|---|---|---|
| **Mechanism** | Bridge caches the extraction keyed by a build-free fingerprint (sorted `.library` manifests joined); hit within a session skips | FetchRequest carries the client's last-synced fingerprint (a dedicated manifest hash), response returns the live one, client persists it in the sidecar | Bridge compares the live `.library` item versions (from the walk) against the `.library` subset the client already sends in `knownItems`; unchanged ⇒ skip |
| **Wire change** | none | request + response field | **none** |
| **Sidecar change** | none | new fingerprint field | **none** |
| **New hashing** | separate fingerprint (manifests joined) | separate fingerprint | **none — reuses the file-version hash** |
| **Survives IDE restart?** | ❌ cold every session start (rebuilds even if unchanged — the actual cost) | ✅ | ✅ (`knownItems` persists in the sidecar) |
| **Extra state** | session-scoped mutable cache (the edge case to avoid) | none | none |
| **Main cost** | duplicates CODESYS's own warm-keeping; saves ~nothing user-visible | redundant field + hash when `knownItems` already carries the data | the `.library` versions are known only AFTER the walk (see C1/C2) |

**C sub-choice (its only real cost):**
- **C1 — reorder FetchService** so extraction runs *after* the item walk+materialize (once the live `.library` versions are known). Safe: the precompile doesn't need the walked item handles, and materialize-first can't be staled by a later build (the same reason the `onlyItems` path already skips the build cleanly). Restructures a shared, correctness-critical method — but the 71-test live e2e is the safety net. Progress folding needs minor rework (sig count not known up front).
- **C2 — pre-walk re-version** the `.library` refs before the walk (same `SafeVersion`). Avoids the reorder but adds a second place that must reproduce the walk's `.library` naming + folder-path exactly — fragile duplication. **Rejected.**

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

**D1 — Recommend Method C1: reuse the `.library` versions from `knownItems`, with a FetchService reorder.** It has the smallest surface (no wire field, no sidecar field, no new hash), survives IDE restarts, and removes both Method A's session edge case and Method B's redundant field/hash. The `.library` items already carry the exact change signal; C just reads it. *Alternatives:* A (currently on `dev`) — replace it (cold every session start, marginal, session state); B — reject (a second fingerprint + wire field when `knownItems` already carries the versions); C2 — reject (fragile duplication of the walk's `.library` naming).

**D2 — The decision is `librariesUnchanged`, a pure function.** `LibrariesUnchanged(liveLibVersions, knownItems)` = the `.library`-suffixed subset of `knownItems` equals the live `.library` item versions (same keys, same values). Extract iff it's false (or `init`, or `onlyItems`). Factor it out so it is unit-testable with no IDE (`FakeIde.Item.Library` covers the integration).

**D3 — Reorder (C1), don't pre-version (C2).** Move `ExtractLibrarySignatures()` from before the walk to after the item materialize loop, where the live `.library` versions are already computed. Safe because the precompile reads `AllPrecompiledSignatures` (its own reflection), never the walked item handles, and materialize-first can't be staled by a later build — the same property that lets the `onlyItems` path skip the build today. Adjust progress (the sig count isn't known up front; render sigs as a tail).

**D4 — No caching, no new state.** Delete the in-proc `LibSignatureCache` and `ReferencedLibraryFingerprint`. Keep `HealthResponse.libExtractCount` (increment on each real extraction) purely as the deterministic e2e hook ("an unchanged-library fetch does not build"). Beckhoff stays a no-op (no `.library` items ⇒ `librariesUnchanged` is trivially true ⇒ never extracts, which is already correct).

**D5 — This subsumes the deferred "Phase 2".** Because `knownItems` lives in the sidecar, C already gives the cross-session win (skip the cold build on the first pull after reopening the IDE) with none of the disk-cache machinery Phase 2 imagined. Phase 2 is dropped.

## Risks / Trade-offs

- [Reordering a shared, correctness-critical method] → the 71-test live e2e parity suite is the safety net; land the reorder behind it. The safety argument (build reads its own model, not item handles; materialize-first is un-stale-able) is the same one that already makes `onlyItems` skip the build.
- [A `.library` item is materially different from a normal file in how it versions] → verified it is not: it's a normal tracked item hashed by `SafeVersion` over its manifest (which encodes name+version). The comparison reuses that exact hash, so no drift between "did the file change" and "did the library change".
- [User deletes a materialized library file locally] → with A/B/C it's no longer re-shipped every pull, so a hand-deleted read-only library file is restored only on a library change (or `pull --force`). Acceptable — those files are read-only and git-tracked; a force re-fetch restores them.
- [A same-version in-place library re-import] → out of scope by the immutability invariant (a library's code never changes without a version change).

## Migration Plan

1. Replace Method A: delete `LibSignatureCache` + `ReferencedLibraryFingerprint` + `LibraryRefManifests`; keep `libExtractCount`.
2. Add `LibrariesUnchanged(...)` (pure) + unit tests.
3. Reorder FetchService (extract after materialize) + gate on `LibrariesUnchanged`; collect live `.library` versions in the existing loop.
4. Verify offline (helper unit test; engine/connector/cli suites) + live (headless CODESYS: a `knownItems`-matching second fetch leaves `libExtractCount` flat and is byte-identical; the full e2e parity stays green).
5. Rollback is a straight revert.

## Open Questions

- Is `ReferencedLibraryResolutions()` genuinely build-free? (T1 — the load-bearing unknown.)
- Phase 2 disk cache location + invalidation (mtime? version-only?) — defer until Phase 1 is measured.
- Does an app edit ever invalidate the CODESYS library precompile within a session (forcing a re-precompile)? The spike didn't edit; worth a follow-up measurement, though libraries shouldn't depend on app code.
