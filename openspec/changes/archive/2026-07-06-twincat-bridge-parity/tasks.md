TwinCAT ↔ CODESYS bridge parity. Both bridges to the same standard, shared Core (no duplicate code), tests on
both. Live test targets: CODESYS AWA on `:8556`, TwinCAT `project11` on `:8555`.

## 1. Structure review (do first — freeze the shared/vendor split)
- [x] Split as-built: SHARED Core = `LibSignature`/`LibVar`, `LibSignatureRenderer`, `FetchService`
      foldering + `(unresolved)` + `omitDeadCode`, `LibraryManifest`, and (new here) `PlcOpenDocument`
      accessor read + `IProjectTree.InterfacePropertyAccessors`. VENDOR = only extraction / the safe
      accessor read (CODESYS enumerate vs TC PLCopen-parse). No vendor-specific logic in Core.

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
- [x] DECISION: element signatures are a KNOWN TwinCAT LIMITATION (surfaced, per no-hidden-bugs — the bridge
      returns TC library refs/namespaces but not element signatures). Not reachable via the out-of-process
      automation surface (see research above).
- [~] DEFERRED (blocked by the limitation): `BeckhoffDriver.ExtractLibrarySignatures` → shared `LibSignature`
      records + `project11` verification. Only feasible via the in-process re-architecture (out-of-process DTE
      automation → in-process TcXaeShell extension) — tracked as a separate future change, NOT this one.

## 4. GET-only / SET-only property parity (the flagged TC bug)
- [x] Root cause: NOT a push-side phantom. The READ side dropped ALL interface-property accessors — `Materializer`
      set `getterCode`/`setterCode` both `null` because interface-accessor COM enumeration crashes TC, so a
      round-trip deleted whatever accessors existed. The push side was already correct (`RemoveChildIfPresent`
      deletes any auto-created extra accessor when the pushed source is get-only).
- [x] Fix (Core, shared): read accessor PRESENCE from the interface's PLCopen export instead of COM enumeration —
      `PlcOpenDocument.InterfacePropertyAccessors` parses `<Property><GetAccessor>/<SetAccessor>`; `Materializer`
      emits `getterCode=""`/`setterCode=""` only for the accessors that exist. Throws (no fallback) if the property
      isn't in its own export.
- [x] Design refined for vendor parity: added `IProjectTree.InterfacePropertyAccessors` — CODESYS enumerates the
      accessor children (safe in-process), TwinCAT parses the interface's PLCopen export (COM enumeration crashes).
      CODESYS's export structures accessors differently, so routing it through the XML parse THREW ("property not
      found") and dropped the interface from the fetch — caught by running the e2e on `:8556`.
- [x] Tests (live, BOTH bridges `:8555` + `:8556`): `top-level` interface GET-only asserts `END_GET` + no `END_SET`;
      `children-cycle` adds interface GET+SET → GET-only (drop setter) AND GET+SET → SET-only (drop getter, the
      mirror). All green on both vendors; 216 C# unit green.
- Added reusable read-only `GET /debug?xmlof=NAME` (any item's PLCopen export — fills the gap where `?xml=1` only
  dumps program/function/FB bodies, skipping interfaces/DUTs).

## 5. Land
- [x] Full bridge suite green on both (`:8555` + `:8556`): 67 e2e + 216 C# unit per vendor, 57 volt-git per
      vendor; `check-divergence` clean; parity asserted by the new interface-accessor tests.

## Notes
- `ARCHITECTURE.md`: the wire is the parity boundary; the tree structure (`Library Manager` vs `References`) is a
  load-bearing asymmetry — do NOT unify the tree, only the element/manifest content.
- Related: `bridge-diagnostics-observability` (the `(unresolved)` + skip-reporting surfacing this builds on).
