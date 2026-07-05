## 1. Bridge — deliver signatures as items, omit no-ground-truth objects

- [x] 1.1 In `Sync/FetchService.cs`, map each rendered library signature to a regular `FetchedItem` (folder = `…/Library Manager/<Lib>`, name = `<Element><ext>`, sourceText = rendered signature, version = content hash) added to `changed` instead of `response.LibrarySignatures`. Kept `LibSignatureRenderer` + the referenced-only filter.
- [x] 1.2 Removed the `LibrarySignatures`, `ExcludeFromBuild`, and `DeadCode` fields from `Wire/RefsFetch.cs` (`FetchResponse`) + `ExcludeFromBuild` from `RefsResponse`; deleted the dead `LibSymbolItem` model.
- [x] 1.3 Omit no-ground-truth objects at the source: `FetchService` + `RefsService` skip `ExcludeFromBuild` items; `FetchService` drops dead (uncompiled) POUs on a verbose fetch (from `changed` + `versions`). Signatures stay out of `versions`/`structureVersion`, so they never perturb the structure hash or become a push target.
- [x] 1.4 Built both bridges (net48 CODESYS + net8 Beckhoff); `dotnet test` green (204). Added `FetchExclusionTests` (excluded items omitted from /fetch + /refs); extended `FakeIde` with `ExcludeFromBuild`.

## 2. volt-git — drop the metadata fields

- [x] 2.1 Removed `excludeFromBuild` / `deadCode` from `FetchResponseSchema` + `RefsResponseSchema`; `pull.ts` no longer reads them or writes markers (nothing to mark — the files aren't delivered). Signatures materialize via the existing `changed` path.
- [x] 2.2 Trimmed `translate/exclude-marker.ts` to the strip-on-push helper (legacy files) + constants; removed the dead `add*`/`isSourceFile`. Dropped `excluded`/`deadCode` from the `IdeRefs` sidecar. Updated `tests/mock-bridge.ts` to mirror the bridge (omit excluded items) and rewrote the sync test (`1c`) to assert an excluded object is omitted, not marked.

## 3. Validate

- [x] 3.1 Live (fresh-built CODESYS 3.5.21 bridge on `:8556`): `volt init`/`pull` round-trips (28 files; `.library` namespace stubs materialize as files, no `LibrarySignatures` response field, no `excludeFromBuild`/`deadCode` keys on `/refs` or `/fetch`). Referenced-library **element signatures** render as `FetchedItem`s on a **verbose** fetch (the harvest path; the CLI `pull` is deliberately non-verbose) — proven by referencing `TON` in the fixture POU, building, and seeing `Library Manager/Standard/TON.fb` appear (and `CommFB/ID.fun`) where before there were none: the referenced-only gate working end-to-end. Excluded/dead omission is covered by the offline `FetchExclusionTests` (the minimal fixture has none). This unblocks `clean-lsp-test-architecture` §4 (the recorder).
- [x] 3.2 Offline: `bun typecheck` + `bun test` green in volt-git (the one failing `vocabulary` test is a pre-existing `ItemKind.Map`↔`item-kinds.json` drift, untouched here); oxlint 0 errors; both bridges build.

## Notes

- The corpus (`test-corpus/**`) is a frozen snapshot harvested BEFORE this change, so it still contains excluded/dead objects with in-file markers. The LSP keeps reading those markers (`hasNoBuildGroundTruth`) for the committed corpus; a future re-harvest will simply not contain them. No LSP change needed now.
