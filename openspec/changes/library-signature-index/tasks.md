## 1. Spike — DONE (2026-07-02, findings in design.md)

- [x] 1.1 Extract the resolved symbol table live. Confirmed: `LanguageModelMgr.AllPrecompiledSignatures(true,true)` returns 4225 library-owned signatures — **build-independent** (works even when the headless app build fails). `GetCompileContext(appGuid)` is the wrong entry (null on build failure).
- [x] 1.2 **Namespace mapping (the key risk):** the source-facing namespace (`PACK_ML`, `Stu`, `L_MC4P`) comes from the library REFERENCE (`.library` manifest `NAMESPACE`), NOT the signature (its `namespace` is null). The refs are ALREADY on the wire. The `LibraryId→ref` string join is fuzzy (case + `*`-placeholder form) — not needed for Phase 1.
- [x] 1.3 Per-library version identity: the ref manifest carries `RESOLUTION name, version (company)` — the version key.
- [x] 1.4 **Verified: a namespace-only catalog clears 468/563 unresolved (83%).** Remaining 95 = device/axis instances (~41), bare library elements (~19 → Phase 2), project-local (~27).

## 2. Bridge: expose the library namespaces (mostly already present)

- [ ] 2.1 The `.library` items already carry `NAMESPACE` (ToLibRef). Add `GET /lib-refs` — a cheap list of `{namespace, name, version}` for every referenced library (no build, no signatures) so the client has a single clean source. Beckhoff: derive from its library refs, or empty (documented gap).

## 3. CLI/manifest: materialize the namespace catalog

- [ ] 3.1 `volt-git` pull: from `/lib-refs` (or the fetched `.library` items) write a read-only `libs/` catalog of library namespaces — e.g. `libs/<Namespace>.namespace` stub files (or one `libs/namespaces.json`), diffable and committed.
- [ ] 3.2 `libs/` is committed but excluded from push (never a `set`/`delete` target). `volt-control`: expose the `libs/` root + an `isLibraryPath` helper.

## 4. LSP: ingest the library-namespace scope

- [ ] 4.1 Workspace scan (`walkForStFiles` + `scripts/coverage-report.ts`) reads the `libs/` namespace catalog; build a set of known library namespaces.
- [ ] 4.2 The unresolved-identifier check skips an identifier that is a known library namespace (the qualified-reference root). Namespace-level completion surfaces them.
- [ ] 4.3 `real-corpus.test.ts`: add the committed `libs/` catalog sample; ratchet built-only precision down (563 → ~95, the non-namespace residual).

## 5. VS Code

- [ ] 5.1 Mark `libs/` read-only (decorations); optional `LIB` badge. No push/edit affordances.

## 6. Verify + sync

- [ ] 6.1 `dotnet test` (bridge) + `bun test` (touched TS packages); `bun typecheck`, `bun lint`.
- [ ] 6.2 Live: pull Pro2193, confirm the `libs/` namespaces materialize and the LSP resolves `PACK_ML`/`L_MC1P`/`Stu`/`L_MC4P`/… (built-only precision 563 → ~95). `check-divergence` + `check-volt-integration` green.

## 7. Phase 2 (SEPARATE change — do NOT implement here)

- [ ] 7.1 Element NAMES per library: `AllPrecompiledSignatures` (build-independent) filtered by `LibraryId`, drop `__`-mangled/implicit; resolve each library's namespace (fuzzy `LibraryId→ref` join, hardened). Clears the ~19 bare-element residual (`CLOCK`, `TICKS`, `L_TSeverity`, `L_IMHP_Layer`).
- [ ] 7.2 Kind detection (methods/vars heuristic or a better model member) → per-element stub files with correct extensions; full member signatures (struct fields, FB `VAR_INPUT/OUTPUT`, methods/properties, EXTENDS/IMPLEMENTS) → hover, member-completion, go-to-definition.
- [ ] 7.3 Device-instance exposure (`MagazineAxes`, `*Drive`, `EtherCAT_Master`, `Axis_*`) — a SEPARATE concern from libraries (the device tree's implicit globals); clears the ~41 device residual.
