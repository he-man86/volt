## 1. Spike: confirm the catalog + stub resolution (live)

- [ ] 1.1 Re-add a temporary `/debug?lib=` probe; against Pro2193 (build first), extract from `GetAllSignaturesFlat()` the library-owned entries (non-empty `LibraryId`, drop `__`-mangled + implicit `VARIABLES`/`IEC_DATATYPE`/`__TL_*`). Confirm a clean list of `(name, kind, libraryId)` per library (e.g. `L_MC4P`, `PACK_ML`, `SER_*`).
- [ ] 1.2 **Namespace/name mapping (key correctness risk):** determine whether the flat name (`L_MC4P_PARAMETERINDEX`) is the qualified name (namespace `L_MC4P`, type `PARAMETERINDEX`) or a literal flat name, and confirm the namespace is separately readable — so the LSP resolves references exactly as source writes them (bare vs `Namespace.Name`). Record in design.md.
- [ ] 1.3 Confirm per-library version identity (name/version/resolutionId) for the version manifest + hash.
- [ ] 1.4 Materialize a few stub files by hand from the extracted names and confirm the LSP registers them and resolves a reference (`PACK_ML`, `L_MC4P`, `ser_operationmodetype`).

## 2. Bridge: catalog extraction

- [ ] 2.1 `CodesysObjectModel`: extract the catalog — build → `SystemInstances.LanguageModelMgr` → `GetCompileContext(appGuid)` → `GetAllSignaturesFlat()`; filter by `LibraryId`, drop mangled/implicit; map to `(qualifiedName, namespace, kind, libraryId)`. Skip gracefully on build failure.
- [ ] 2.2 Classify kind → extension (`ItemKind.ExtFor`); render each as a MINIMAL declaration stub (header/name, empty body) — Phase-2-ready. Group by namespace; dedup by qualified name.
- [ ] 2.3 Compute the per-library version manifest (`namespace → {version, resolutionId, catalogHash}`).
- [ ] 2.4 Beckhoff/TwinCAT: empty catalog + empty manifest (documented gap).

## 3. Bridge: wire endpoints (versioned, incremental)

- [ ] 3.1 `GET /lib-refs` — cheap library version manifest (no signatures, no build).
- [ ] 3.2 `POST /lib-symbols {knownLibs}` — build+extract+return stub files ONLY for changed/new libraries. Never triggered by `/fetch`.
- [ ] 3.3 Wire types: schema for the manifest + per-file stub payload (name, namespace, ext, text).

## 4. CLI/manifest: materialize libs/

- [ ] 4.1 `volt-git` pull: diff the bridge's library manifest vs the sidecar's; if changed, call `/lib-symbols` and materialize `libs/<Namespace>/<Element>.<ext>` (read-only). Persist the library manifest in the sidecar.
- [ ] 4.2 `libs/` committed but excluded from push (never a `set`/`delete` target).
- [ ] 4.3 `volt-control`: expose the `libs/` root + an `isLibraryPath` helper.

## 5. LSP: ingest the ambient library scope

- [ ] 5.1 Workspace scan (`walkForStFiles` + `scripts/coverage-report.ts`) includes `libs/` read-only; build a namespace-keyed ambient library scope.
- [ ] 5.2 Resolver/unresolved-identifier check consults the library scope (bare + qualified); name-level completion surfaces library symbols.
- [ ] 5.3 Reduce `standard-functions.ts` to a fallback for un-indexed names.
- [ ] 5.4 `real-corpus.test.ts`: add a committed `libs/` sample and ratchet built-only precision downward (target: the ~1066 library floor clears to near the non-library residual).

## 6. VS Code

- [ ] 6.1 Mark `libs/` read-only (decorations provider); optional `LIB` badge. No push/edit affordances.

## 7. Verify + sync

- [ ] 7.1 `dotnet test` (bridge) + `bun test` (each touched TS package); `bun typecheck`, `bun lint`.
- [ ] 7.2 Live: pull Pro2193, confirm `libs/L_MC4P/…` etc. materialize and the LSP resolves `PACK_ML`/`L_MC4P`/`SER_*`/`Str*A` (built-only precision drops to near the non-library residual). Re-pull with unchanged libraries confirms no re-extract.
- [ ] 7.3 `check-divergence` + `check-volt-integration` green.

## 8. Phase 2 (SEPARATE change — do NOT implement here)

- [ ] 8.1 Dedicated spike: find a clean source-signature extraction path (per-library precompile with the right id, or fidelity-acceptable reconstruction from the lowered model) — the blocker the Phase-1 spike hit.
- [ ] 8.2 Enrich the SAME `libs/` stub files with full member signatures (struct fields, FB `VAR_INPUT/OUTPUT`, method/property signatures, EXTENDS/IMPLEMENTS) → hover, member-completion, go-to-definition.
