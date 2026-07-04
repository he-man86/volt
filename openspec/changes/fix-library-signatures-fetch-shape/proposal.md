## Why

The bridge's `/fetch` response carries referenced-library signatures as a **separate top-level field** `librarySignatures: List<LibSymbolItem>` (`Volt.Bridge.Core/Wire/RefsFetch.cs:83`, appended in `Sync/FetchService.cs:100` on a verbose fetch). This is the wrong shape: library signatures are just **read-only files** and should ride through the normal `changed`/`items` materialize path like every other file. Because they were bolted on as a bespoke field, `volt-git`'s strict `FetchResponseSchema` (which was updated for the sibling verbose field `deadCode` but **not** `librarySignatures`) rejects the payload:

```
bridge /fetch returned malformed payload: <root>: Unrecognized key: "librarySignatures"
```

This surfaced while reviving the `record:language` recorder (`clean-lsp-test-architecture` §4): `volt init` → first `pull` → `/fetch` → schema rejection, so the recorder can't run against a live bridge. It also means a verbose `pull` fails for any consumer, not just the recorder.

The correct fix is a **contract cleanup, not a schema patch** (adding `librarySignatures` to the Zod schema would just cement the wrong shape).

## What Changes

- **Bridge:** deliver each library signature as a regular `Changed` item — a `FetchedItem { name, folder, sourceText, version }` whose `sourceText` is the rendered signature and `version` is a content hash (read-only; never a push target) — instead of appending to `FetchResponse.LibrarySignatures`.
- **Bridge:** remove the `LibrarySignatures` field from `FetchResponse` (`RefsFetch.cs`) and the `AppendLibrarySignatures`-into-that-field wiring (`FetchService.cs`); keep the rendering (`LibSignatureRenderer`) — only its delivery channel changes.
- **volt-git:** no schema change needed — the signatures now arrive as ordinary `changed` items and materialize via the existing path. (Confirm `structureVersion`/push behavior: signatures must stay out of the push set and not perturb `structureVersion` unexpectedly — decide during design.)
- **Explicitly NOT changing:** the `excludeFromBuild` / `deadCode` wire fields — those are **load-bearing**, not legacy: `volt-git` `pull.ts:64,70` reads them to write the in-file `(* @volt-exclude-from-build *)` / uncompiled markers the LSP depends on for its zero-FP invariant. Folding those into self-describing files would require moving marker-embedding into the bridge — a separate, deliberate decision, out of scope here.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `bridge-protocol`: the `/fetch` contract — library signatures are delivered as regular items, not a separate `librarySignatures` field.

## Impact

- **Code:** `Volt.Bridge.Core/Sync/FetchService.cs`, `Wire/RefsFetch.cs` (C#, net48 + net8 — build both bridges); `volt-git` fetch/materialize (likely no change, verify); tests (`mock-bridge.ts`, sync tests) and a library-signature e2e.
- **Unblocks:** `clean-lsp-test-architecture` §4 (the `record:language` recorder) — currently blocked on this.
- **Risk:** the bridge is the data path; needs the round-trip parity tests (CODESYS + TwinCAT) + a live rebuild. Deferred deliberately (not a rushed edit).
