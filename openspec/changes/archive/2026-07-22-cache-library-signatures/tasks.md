## 1. Replace Method A with Method C (decide from the `.library` versions)

- [x] 1.1 Delete `LibSignatureCache` + `LibSignatureCacheTests`; drop `ReferencedLibraryFingerprint` (DriverBase + CODESYS) and `LibraryRefManifests`/`CollectLibManifests` (CodesysDriver.Tree)
- [x] 1.2 `DriverBase.ExtractLibrarySignatures()` = increment `LibExtractCount` + call `ExtractLibrarySignaturesCore()` (vendor). Keep `LibExtractCount` in health (the e2e hook). CODESYS `Core` = `_om.ExtractLibrarySignatures()`; Beckhoff inherits empty
- [x] 1.3 Add pure `LibrariesUnchanged(liveLibVersions, knownItems)`: every live `.library` version matches `knownItems`, and no `.library` entry in `knownItems` is missing live (add/change/remove all → false)

## 2. FetchService — decide after the single build-free walk

- [x] 2.1 Move `WalkItems()` before the extraction; in the existing materialize loop collect `liveLibVersions` (fullName→version) for `kind == "library"` items (their versions come from the SAME `SafeVersion`, so zero divergence)
- [x] 2.2 After the loop: `librariesUnchanged = !init && knownItems != null && LibrariesUnchanged(liveLibVersions, knownItems)`; extract iff `!(onlyItems || librariesUnchanged)` — so `Build(app)` runs only when a `.library` changed
- [x] 2.3 Verify the ordering is safe (build after materialize can't stale handles — the precompile reads its own model; same property that lets `onlyItems` skip the build); adjust progress (sig count not known up front → render sigs as a tail)

## 3. Tests

- [x] 3.1 Offline unit test for `LibrariesUnchanged` (unchanged / added / changed-version / removed)
- [x] 3.2 Offline FetchService test (FakeIde + `FakeIde.Item.Library`): a second fetch whose `knownItems` includes the `.library` version does NOT extract (`LibExtractCount` flat); a changed/absent `.library` version DOES; init always extracts
- [x] 3.3 Update the live `libcache.test.ts`: fetch once, feed the `.library` items' versions back as `knownItems`, assert the second fetch leaves `libExtractCount` flat and ships no new signature items; empty `knownItems` still extracts

## 4. Verify

- [x] 4.1 `dotnet test` (engine + connector + cli) green; root typecheck/lint clean
- [x] 4.2 Live headless CODESYS: `libcache.test.ts` + full e2e parity suite green
- [x] 4.3 Commit + push
