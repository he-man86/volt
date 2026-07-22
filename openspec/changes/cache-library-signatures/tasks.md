## 1. Spike (gates the whole change) — headless CODESYS

- [x] 1.1 Build-free `ReferencedLibraryFingerprint()` — CONFIRMED. `GetLibraryRefs` (ILibManObject metadata) already reads resolutions without a precompile; the CODESYS fingerprint reuses it via `LibraryRefManifests()`. Verified live: `.library` resolutions carry versions with no build.
- [~] 1.2 Cold-vs-warm measured on the FIXTURE (cold 2469 ms vs warm 97 ms). A large-corpus (5000+ sig) measurement is still worth taking to size the cold first-fetch win — not blocking.
- [x] 1.3 Signatures byte-stable per resolution — CONFIRMED live (0 mismatches across fetches, fixture 590 sigs).

## 2. Cache seam (Volt.Engine)

- [x] 2.1 `LibSignatureCache` (standalone) + `DriverBase.ExtractLibrarySignatures()` wraps it over `ReferencedLibraryFingerprint()` + `ExtractLibrarySignaturesUncached()`; no explicit rebind-clear needed (fingerprint is content-derived)
- [x] 2.2 Beckhoff inherits the empty defaults (no library signatures yet) — cache is a harmless no-op
- [x] 2.3 Offline unit tests (`LibSignatureCacheTests`): same fingerprint → one extraction; changed fingerprint (version swap) → re-extract; first call extracts

## 3. CODESYS implementation

- [x] 3.1 `LibraryRefManifests()` — build-free descent collecting every Library Manager's refs
- [x] 3.2 `Build(app)` + `AllPrecompiledSignatures` moved into `ExtractLibrarySignaturesUncached()`; the cached wrapper decides whether to call it
- [x] 3.3 Extract-before-walk ordering preserved: the fingerprint read is build-free (runs first); a miss builds before the walk, a hit does no build

## 4. Verify (headless CODESYS)

- [x] 4.1 Cache hit skips the precompile — `HealthResponse.libExtractCount` is unchanged across a second unchanged-library fetch (live e2e)
- [x] 4.2 Hit is byte-identical to the prior extraction (folder+name → version; live e2e), and full e2e parity suite green (71/71)
- [~] 4.3 A live library version swap → miss: not automatable headlessly (can't rewrite the fixture's library refs); the invalidation logic is covered offline (`LibSignatureCacheTests` changed-fingerprint) + the fingerprint-encodes-version live assertion
- [x] 4.4 `dotnet test` green (engine 296, connector 30, cli 98) + live e2e 71/71

## 5. Decide Phase 2 (cross-session disk cache)

- [ ] 5.1 DEFERRED. Phase 1 (in-proc) is shipped + verified. The bigger win — the FIRST pull after reopening the IDE — needs a disk-persisted `fingerprint → signatures`. Decide after a large-corpus measurement (1.2); if pursued, spec location + invalidation as a follow-up change.
