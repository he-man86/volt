## 1. Spike: confirm render fidelity + filtering (live)

- [ ] 1.1 Re-add a temporary `/debug?lib=` probe; against Pro2193 (build first), for a sample of library signatures (an FB with methods, a struct, an enum, a GVL, an interface) render via `GetConverterToIEC` and confirm the output PARSES as valid ST declarations the LSP resolves.
- [ ] 1.2 Determine the filter: how to tell a library-owned signature from a project one and from implicit/compiler signatures (`VARIABLES`, `IEC_DATATYPE`, `__TL_*_GVL`). Confirm each signature exposes its owning library/namespace + kind. Record the exact API in design.md.
- [ ] 1.3 Confirm per-library version identity (name/version/resolutionId) is readable for the version manifest + hash.

## 2. Bridge: signature extraction

- [ ] 2.1 `CodesysObjectModel`: add signature extraction — `LanguageModelMgr` (`SystemInstances.LanguageModelMgr`) → `GetCompileContext(appGuid)` → `GetAllSignaturesFlat()`; render each via `GetConverterToIEC`. Build-first (reuse the build path); skip gracefully on build failure.
- [ ] 2.2 Filter to public library elements (per 1.2); classify kind → extension (reuse `ItemKind.ExtFor`); group by namespace; dedup by qualified name.
- [ ] 2.3 Compute the per-library version manifest (`namespace → {version, resolutionId, signatureHash}`).
- [ ] 2.4 Beckhoff/TwinCAT: return an empty set + empty manifest (documented gap).

## 3. Bridge: wire endpoints (versioned, incremental)

- [ ] 3.1 `GET /lib-refs` — the cheap library version manifest (no signatures, no build).
- [ ] 3.2 `POST /lib-symbols` with `knownLibs` (namespace→version) — build+extract+return signature files ONLY for changed/new libraries (like `/fetch`'s knownItems). Never triggered by `/fetch`.
- [ ] 3.3 Wire types: schema for the manifest + the per-file signature payload (name, namespace, ext, text).

## 4. CLI/manifest: materialize libs/

- [ ] 4.1 `volt-git`: on pull, compare the bridge's library manifest to the sidecar's; if changed, call `/lib-symbols` and materialize `libs/<Namespace>/<Element>.<ext>` (read-only). Persist the library manifest in the sidecar.
- [ ] 4.2 Ensure `libs/` is committed but excluded from push (never a `set`/`delete` target).
- [ ] 4.3 `volt-control`: expose the `libs/` root + a `readLibrarySymbols`/`isLibraryPath` helper.

## 5. LSP: ingest the ambient library scope

- [ ] 5.1 Workspace scan (`walkForStFiles` + `scripts/coverage-report.ts`) includes `libs/` read-only; build an ambient library scope keyed by namespace.
- [ ] 5.2 Resolver/unresolved-identifier check consults the library scope (bare + qualified). Hover/completion/signature-help/go-to-definition surface library signatures.
- [ ] 5.3 Reduce `standard-functions.ts` to a fallback for un-indexed names (the Standard/String libraries are now indexed).
- [ ] 5.4 `real-corpus.test.ts`: extend the corpus with a committed `libs/` sample (or a synthetic fixture) and ratchet built-only precision downward (target: the ~1066 library floor clears).

## 6. VS Code

- [ ] 6.1 Mark `libs/` read-only in the editor (and the decorations provider); optional `LIB` badge. No push/edit affordances.

## 7. Verify + sync

- [ ] 7.1 `dotnet test` (bridge) + `bun test` (each touched TS package); `bun typecheck`, `bun lint`.
- [ ] 7.2 Live: pull Pro2193, confirm `libs/L_MC4P/…` etc. materialize and the LSP resolves `PACK_ML`/`L_MC4P`/`SER_*`/`Str*A` (built-only precision drops to near the non-library residual). Re-pull with unchanged libraries confirms no re-extract.
- [ ] 7.3 `check-divergence` + `check-volt-integration` green (all additive within `packages/volt-*` + the new `libs/` tree).
