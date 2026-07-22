## 1. Spike (gates the whole change) — headless CODESYS

- [ ] 1.1 Confirm a **build-free** `ReferencedLibraryResolutions()`: enumerate referenced-library resolutions (name+version) via Library-Manager metadata WITHOUT triggering a precompile. Prove it by reading resolutions on a freshly-loaded project (before any fetch/build) and asserting `AllPrecompiledSignatures` was not needed. If impossible, fall back to deriving the fingerprint from the walk's `.library` items (design D5).
- [ ] 1.2 Measure cold vs warm extraction on the fixture AND on a large corpus project (5000+ sigs) to quantify the real first-fetch saving; record the numbers in the change.
- [ ] 1.3 Confirm signatures are byte-stable per resolution across fetches (already seen: 0/590 mismatches on the fixture — re-confirm on the large project).

## 2. Cache seam (Volt.Engine)

- [ ] 2.1 `DriverBase`: make `ExtractLibrarySignatures()` a cache wrapper over abstract `ReferencedLibraryResolutions()` + `ExtractLibrarySignaturesUncached()`; store `fingerprint → signatures` in-proc; clear on `SelectProject` rebind
- [ ] 2.2 Beckhoff: override both as no-ops (empty) — TC has no library signatures yet
- [ ] 2.3 Unit test (FakeIde): a second `ExtractLibrarySignatures()` with the same fingerprint does not call the uncached extractor; a changed fingerprint does

## 3. CODESYS implementation

- [ ] 3.1 Implement `ReferencedLibraryResolutions()` (build-free) per the T1 finding
- [ ] 3.2 Move `Build(app)` + `AllPrecompiledSignatures` into `ExtractLibrarySignaturesUncached()`; the cached wrapper decides whether to call it
- [ ] 3.3 Ensure the extract-before-walk ordering holds on a miss (build still precedes `WalkItems`); a hit does no build

## 4. Verify (headless CODESYS)

- [ ] 4.1 Cache hit skips `Build(app)` — assert via timing (~cold vs ~hit) and a build-invocation probe/log
- [ ] 4.2 Fetch response on a hit is byte-identical to a cold fetch (library-sig items + `projectVersion`/`structureVersion`)
- [ ] 4.3 A live library version swap (or add/remove) produces a cache miss and correct new signatures
- [ ] 4.4 `dotnet test` (engine + CLI) green; live e2e parity suite green

## 5. Decide Phase 2 (cross-session disk cache)

- [ ] 5.1 From the 1.2/4.1 measurements, decide whether to persist `fingerprint → signatures` to disk so the FIRST pull after reopening the IDE skips the cold precompile; if yes, spec the location + invalidation and implement behind the same seam
