TwinCAT ↔ CODESYS bridge parity. Both bridges to the same standard, shared Core (no duplicate code), tests on
both. Live test targets: CODESYS AWA on `:8556`, TwinCAT `project11` on `:8555`.

## 1. Structure review (do first — freeze the shared/vendor split)
- [ ] Document the split: SHARED Core = `LibSignature`/`LibVar`, `LibSignatureRenderer`, `FetchService`
      foldering + `(unresolved)` + `omitDeadCode`, and the NEW `LibraryManifest`. VENDOR = only the extraction
      (`ExtractLibrarySignatures`, library-ref fields). Confirm no vendor-specific logic leaked into Core.

## 2. Unify the library manifest (kills the divergent formats)
- [ ] Add `Volt.Bridge.Core/Library/LibraryManifest.cs` — `Build(name, namespace, resolution, placeholder,
      system, deps)` → canonical `LIBRARY/NAMESPACE/RESOLUTION/PLACEHOLDER/SYSTEM/DEPENDENCIES`.
- [ ] CODESYS `ToLibRef` → call `LibraryManifest.Build` (drop the inline string).
- [ ] Beckhoff `ReadManifest` (library case) → extract raw fields from the item XML, call `LibraryManifest.Build`
      (drop `Name=`/`namespace=`/`default-resolution=`/`distributor=`).
- [ ] Test: both drivers produce the identical manifest shape for equivalent input (FakeIde + a TwinCAT fixture).

## 3. Beckhoff library element signatures
- [ ] Research the TwinCAT automation-interface surface for library element symbols (the equivalent of CODESYS
      `LanguageModelMgr.AllPrecompiledSignatures`). If none exists headless, record it as a known limitation
      (no-hidden-bugs: surface, don't fake).
- [ ] Implement `BeckhoffDriver.ExtractLibrarySignatures` → the SAME `LibSignature` records, so the shared
      renderer/foldering give TC alias/union/enum-value + full-API + `(unresolved)` automatically.
- [ ] Verify on `project11`: `.library` refs get their element signatures, foldered like CODESYS.

## 4. GET-only / SET-only property parity (the flagged TC bug)
- [ ] Reproduce: a GET-only property on TwinCAT emits a phantom `__SETVALUE` (wrongly reported TC-rejected).
- [ ] Fix in the Beckhoff driver (or Core if the round-trip is shared).
- [ ] Tests (both bridges): round-trip a GET-only, a SET-only, and a GET+SET property — byte-identical, no phantom
      accessor. Needs a fixture property (add to `project11` or a committed FakeIde/e2e case).

## 5. Land
- [ ] Full bridge suite green on both; `check-divergence` clean; parity asserted by the new tests.

## Notes
- `ARCHITECTURE.md`: the wire is the parity boundary; the tree structure (`Library Manager` vs `References`) is a
  load-bearing asymmetry — do NOT unify the tree, only the element/manifest content.
- Related: `bridge-diagnostics-observability` (the `(unresolved)` + skip-reporting surfacing this builds on).
