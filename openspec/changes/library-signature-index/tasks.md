## 1. Spike — DONE (2026-07-02, findings in design.md)

- [x] 1.1 Extract the resolved symbol table live. Confirmed: `LanguageModelMgr.AllPrecompiledSignatures(true,true)` returns 4225 library-owned signatures — **build-independent** (works even when the headless app build fails). `GetCompileContext(appGuid)` is the wrong entry (null on build failure).
- [x] 1.2 **Namespace mapping (the key risk):** the source-facing namespace (`PACK_ML`, `Stu`, `L_MC4P`) comes from the library REFERENCE (`.library` manifest `NAMESPACE`), NOT the signature (its `namespace` is null). The refs are ALREADY on the wire. The `LibraryId→ref` string join is fuzzy (case + `*`-placeholder form) — not needed for Phase 1.
- [x] 1.3 Per-library version identity: the ref manifest carries `RESOLUTION name, version (company)` — the version key.
- [x] 1.4 **Verified: a namespace-only catalog clears 468/563 unresolved (83%).** Remaining 95 = device/axis instances (~41), bare library elements (~19 → Phase 2), project-local (~27).

## 2. Bridge: expose the library namespaces — NO CHANGE NEEDED

- [x] 2.1 The `.library` reference items already carry `NAMESPACE` (ToLibRef) and are already on the `/fetch`
  wire. So no new `/lib-refs` endpoint — `volt pull` derives the catalog from the fetched items directly.
  (A dedicated endpoint stays a Phase-2 option if signature extraction wants a build-gated call.)

## 3. CLI: mirror the CODESYS structure — DONE (no generated catalog)

- [x] 3.1 The workspace mirrors CODESYS: each referenced library is a read-only `.library` file nested under
  its Library Manager (`src/…/Library Manager/PACK_ML.library`), materialized naturally by `materializeItem`
  — no invented `libs/` catalog. The bridge encodes the library-ref FILENAME so a `*`-version placeholder
  library (e.g. "SysTypes2 Interfaces, * (System)") materializes on Windows too (all 75 libs present).
- [ ] 3.2 `volt-control` `isLibraryPath` helper — deferred (only needed for the VS Code read-only affordance).

## 4. LSP: ingest the library-namespace scope — DONE

- [x] 4.1 `loadLibraryNamespaces(root)` scans the workspace for `.library` files and reads each NAMESPACE;
  the LSP loads it at `initialize` (`Workspace.libraryNamespaces`) and the coverage harness in `computeCoverage`.
- [x] 4.2 The unresolved-identifier check skips a qualified-reference root that is a known library namespace.
- [x] 4.3 `real-corpus.test.ts` ratchet with the committed `.library` files (nested): built-only 563→95.

## 5. VS Code — DEFERRED (minor polish)

- [ ] 5.1 Mark `libs/` read-only (decorations); optional `LIB` badge. No push/edit affordances.

## 6. Verify — DONE

- [x] 6.1 `bun test` (volt-lsp-codesys 5258 pass incl. new catalog unit test; volt-git sync incl. new
  pull-emits-catalog test); `bun typecheck` clean on both.
- [x] 6.2 Verified end-to-end against Pro2193: the catalog (62 namespaces) materializes and built-only
  precision drops 563→95. (Live `volt pull` on a real repo covered by the volt-git sync test.)

## 7. Phase 2 (SEPARATE change — do NOT implement here)

- [ ] 7.1 Element NAMES per library: `AllPrecompiledSignatures` (build-independent) filtered by `LibraryId`, drop `__`-mangled/implicit; resolve each library's namespace (fuzzy `LibraryId→ref` join, hardened). Clears the ~19 bare-element residual (`CLOCK`, `TICKS`, `L_TSeverity`, `L_IMHP_Layer`).
- [ ] 7.2 Kind detection (methods/vars heuristic or a better model member) → per-element stub files with correct extensions; full member signatures (struct fields, FB `VAR_INPUT/OUTPUT`, methods/properties, EXTENDS/IMPLEMENTS) → hover, member-completion, go-to-definition.
- [ ] 7.3 Device-instance exposure (`MagazineAxes`, `*Drive`, `EtherCAT_Master`, `Axis_*`) — a SEPARATE concern from libraries (the device tree's implicit globals); clears the ~41 device residual.
