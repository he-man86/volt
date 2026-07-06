TwinCAT ↔ CODESYS bridge parity. Both bridges to the same standard, shared Core (no duplicate code), tests on
both. Live test targets: CODESYS AWA on `:8556`, TwinCAT `project11` on `:8555`.

## 1. Structure review (do first — freeze the shared/vendor split)
- [ ] Document the split: SHARED Core = `LibSignature`/`LibVar`, `LibSignatureRenderer`, `FetchService`
      foldering + `(unresolved)` + `omitDeadCode`, and the NEW `LibraryManifest`. VENDOR = only the extraction
      (`ExtractLibrarySignatures`, library-ref fields). Confirm no vendor-specific logic leaked into Core.

## 2. Unify the library manifest (kills the divergent formats) — DONE
- [x] `Volt.Bridge.Core/Library/LibraryManifest.cs` — `Build(...)` → canonical
      `LIBRARY/NAMESPACE/RESOLUTION/PLACEHOLDER/SYSTEM/DEPENDENCIES`. Unit-tested (with-deps + no-deps shapes) —
      the parity contract both drivers meet.
- [x] CODESYS `ToLibRef` → calls `LibraryManifest.Build`.
- [x] Beckhoff `ReadManifest` (library case) → `LibraryManifestFromXml` parses the item `ProduceXml`
      (ItemName/Namespace/EffectiveResolution/ItemSubTypeName=placeholder/`<Dependencies>`) → `LibraryManifest.Build`.
      TwinCAT has no system-lib flag → SYSTEM false. Live-validated on project11:
      `Tc2_System` → canonical manifest incl. `DEPENDENCIES Tc2_Standard, Tc3_Module`.
- Note: driver-side field extraction (CODESYS reflection / TC XML) is COM-dependent → live-validated per vendor
  (test project is net8.0/Core-only); the shared shape is the unit-tested contract.

## 3. Beckhoff library element signatures
- FINDING (2026-07-06): the CODESYS bridge is IN-PROCESS (net48) → reflects `_3S.CoDeSys.*`
  (`LanguageModelMgr.AllPrecompiledSignatures`). The Beckhoff bridge is OUT-OF-PROCESS (VS `DTE` +
  `ITcSysManager`/`ITcSmTreeItem` automation) → sees only tree items + `ProduceXml` metadata, NOT the
  language model. Evidence: `.library` ref nodes report `childCount=0` — no elements via the automation tree.
  So the CODESYS structural-signature path is NOT reachable as-is.
- RESEARCH DONE (2026-07-06, docs + DLLs + file format):
  - Automation interface: `ITcPlcLibraryManager.References` → `ITcPlcLibrary`/`ITcPlcPlaceholderRef`, but
    `ITcPlcLibrary` is METADATA ONLY (DisplayName/Distributor/Name/Version — no namespace, no symbols, no
    element enumeration). So the automation surface does NOT expose library elements. Confirmed by the
    Beckhoff infosys docs (242900875, 242733963) + the live `childCount=0` on ref nodes.
  - Library files exist in the repo (`C:\TwinCAT\3.1\Components\Plc\Managed Libraries\<distributor>\<name>\
    <version>\<name>.{library|compiled-library}`), locatable by the ref's Name/Version/Distributor. BUT a
    `.library` is a ZIP of GUID-named entries in CODESYS's PROPRIETARY BINARY object serialization (no ST
    text); `.compiled-library` is compiled. Parsing = heavy reverse-engineering — impractical.
  - Only fully-working path = IN-PROCESS like the CODESYS bridge (the embedded CoDeSys engine in TwinCAT XAE
    has the loaded libraries → the same `LanguageModelMgr` reflection). That is a re-architecture of the
    Beckhoff bridge (out-of-process DTE automation → in-process TcXaeShell extension). Big.
- [ ] DECISION: element signatures are a KNOWN TwinCAT LIMITATION for now (surface it, per no-hidden-bugs —
      the bridge returns TC library refs/namespaces but not element signatures). Revisit via the in-process
      re-architecture only if the value justifies it.
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
