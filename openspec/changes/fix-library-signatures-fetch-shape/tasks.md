## 1. Bridge — deliver signatures as regular items

- [ ] 1.1 In `Sync/FetchService.cs`, map each rendered library signature to a regular `FetchedItem` (name = element name, folder = `…/Library Manager/<Lib>`, sourceText = rendered signature, version = content hash) and add it to `changed`/`items` instead of `response.LibrarySignatures`. Keep `LibSignatureRenderer` + the referenced-only filter.
- [ ] 1.2 Remove the `LibrarySignatures` field from `Wire/RefsFetch.cs` `FetchResponse` and the `AppendLibrarySignatures(... response.LibrarySignatures)` call.
- [ ] 1.3 Decide + implement `structureVersion` / push behavior: signatures must NOT be a push target and must not perturb `structureVersion` in a surprising way (mirror how read-only reference kinds are handled today).
- [ ] 1.4 Build both bridges (net48 CODESYS + net8 Beckhoff); `dotnet test`.

## 2. volt-git — verify no schema change needed

- [ ] 2.1 Confirm the signatures materialize via the existing `changed`-items path (no `librarySignatures` in `FetchResponseSchema`; do NOT add one). Verify `pull` writes them under the Library Manager tree, read-only.
- [ ] 2.2 Update `tests/mock-bridge.ts` + any library-signature test to the regular-item shape.

## 3. Validate

- [ ] 3.1 Live: `volt-scripts/codesys-bridge.ps1 up`, `volt pull` a library-referencing project succeeds; signatures appear as files. This unblocks `clean-lsp-test-architecture` §4 (the recorder).
- [ ] 3.2 Corpus/e2e green; both vendors (parity boundary is the wire).

## Notes

- Do NOT touch `excludeFromBuild` / `deadCode` here — they are load-bearing (volt-git writes the in-file markers from them; the LSP's zero-FP invariant depends on it). Making files fully self-describing (bridge embeds all markers) is a separate deliberate change.
