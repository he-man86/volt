## Why

The two bridges have drifted: the recent library-signature work (element signatures with alias/union/enum-value
fidelity, the `DEPENDENCIES` hierarchy, full-API extraction, the `(unresolved)` no-fallback surfacing, the
`omitDeadCode` flag) landed for **CODESYS only**. TwinCAT/Beckhoff still returns **zero library element
signatures**, and its `.library` manifest uses a **different, divergent format** (`Name=`/`namespace=`/
`default-resolution=` vs the canonical `LIBRARY`/`NAMESPACE`/`RESOLUTION`/`PLACEHOLDER`/`SYSTEM`/`DEPENDENCIES`).
The parity boundary is the wire — both vendors must serve the SAME shape for the same concept — so this is a
correctness gap, not just polish. Separately, a **GET-only / SET-only property** is mishandled on TwinCAT (a
phantom `__SETVALUE` on a get-only property — see the bridge-bug notes) and has no regression test.

The goal: bring both bridges to the same standard with **no duplicated code** — one shared Core does the
vendor-neutral work (the `LibSignature` model, the renderer, the manifest format, the foldering + `(unresolved)`
surfacing), each driver supplies only the irreducible vendor extraction — and lock it with tests on both.

## What Changes

- **Shared library manifest (Core).** Extract a single `LibraryManifest` builder in `Volt.Bridge.Core` producing
  the canonical `LIBRARY/NAMESPACE/RESOLUTION/PLACEHOLDER/SYSTEM/DEPENDENCIES` text. Both drivers extract their raw
  fields (from `ILibManItem` on CODESYS, from the item XML on TwinCAT) and call it — killing the two divergent
  manifest formats. TwinCAT's `.library` stubs become byte-shaped like CODESYS's.
- **Beckhoff `ExtractLibrarySignatures`.** Implement TwinCAT library element-signature extraction (its equivalent
  of the CODESYS precompiled-signature model), returning the SAME `LibSignature` records — so the shared
  `LibSignatureRenderer` + `FetchService` foldering give TwinCAT alias/union/enum-value fidelity, the full API,
  and the `(unresolved)` surfacing for free. (Research: the TwinCAT automation-interface surface for library
  symbols; if none exists, surface that as a known limitation per no-hidden-bugs.)
- **GET-only / SET-only property parity.** Fix the TwinCAT get-only property handling (no phantom `__SETVALUE`);
  round-trip get-only, set-only, and get+set properties identically on both bridges.
- **Structure review + tests.** Confirm the shared Core / vendor-driver split holds and stays optimal for both;
  add tests (FakeIde/live) covering the library manifest, element signatures, and the property accessors on BOTH
  bridges, so parity is enforced, not assumed.

## Impact

- `packages/volt-bridge/src/Volt.Bridge.Core` — new `LibraryManifest`; `FetchService`/`LibSignatureRenderer`
  already vendor-neutral (reused as-is).
- `Volt.Bridge.Codesys` (`CodesysObjectModel.ToLibRef` → shared manifest) and `Volt.Bridge.Beckhoff`
  (`ReadManifest` library case → shared manifest; new `ExtractLibrarySignatures`; property accessor fix).
- Parity is the acceptance criterion: same wire shape for the same concept, proven by tests on both bridges.
- Load-bearing CODESYS↔TwinCAT tree asymmetries (e.g. `Library Manager` vs `References` folder) are NOT unified —
  only the element/manifest CONTENT is (see `ARCHITECTURE.md`).
