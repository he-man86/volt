## 0. Design gate (2026-10-03)

**Observation: confirmed, by code.** `FetchService.cs:210` sets `librariesRefreshed = onlyItems == null && …`, and only
then does `:234` call `ExtractLibrarySignatures()`. So `fetch { onlyItems: ["X.library"] }` answers the manifest alone.
PLCAssist's reading is right except "TwinCAT returns no signatures": `TcObjectModel.ExtractLibrarySignatures` (one
`ProduceAllLibrarySignatures()` COM call) is real; the `DriverBase.cs:149-151` comment is stale (fixed in 2.2).
This is a real gap: nothing else lets a client read one library's API without a full fetch.

**Target.** A directed read naming `X.library` returns X's manifest plus X's rendered signatures, folder and bytes
the same as a full fetch writes them, on both vendors. No new op, no `names` filter (0.2, owner).

| Proposal item | Verdict |
|---|---|
| (A) signatures ride a directed `.library` read | FITS. `onlyItems` contract kept: the signatures belong to the named item, and `removed` stays empty (`:258`). |
| Session cache per RESOLUTION | CONFLICTS: archived `cache-library-signatures` D1 rejected a session-scoped cache (its Method A) and measured that CODESYS already keeps the precompile warm (2469 ms cold, 97 ms warm). Default: no bridge cache; 1.2 measures a warm directed read on both vendors. 2.3 is answered by that measurement, not by a new cache. If TwinCAT's warm call is costly, that goes to the owner. |
| `MATERIALIZATION` out of a directed manifest | CONFLICTS (0.3): the manifest is the `.library` version-hash basis, and 2.4 requires a directed read to return the same bytes as a full fetch. The LSP reads a missing line as format 1 (`manifest.ts:57`) and flags the file stale. **It stays.** |
| 2.4 every kind readable on its own, data-driven over `ItemKind` | FITS. |
| CLI read-only library folders | Unaffected. No CLI caller sends a `.library` in `onlyItems` (`Commands.cs:934` pushed items, `:1031` `volt show`). |

**Choice: how.** When `onlyItems` names at least one `.library`, extract (the same call; neither vendor has a
per-library call, DIALECT C2c) and render only the signatures whose `LibraryPath` matches a RESOLUTION captured in
`libByResolution` for a NAMED library. Rejected:
- render all of them. `AppendLibrarySignatures` would put every other library's elements under `(unresolved)`.
- set `librariesRefreshed` true. Its contract is "the complete set for EVERY library folder" (`RefsFetch.cs:100`),
  and `IdeTree.DroppedLibraryFile` would wipe the folders of libraries nobody named.
`librariesRefreshed` stays false on a directed read. The signatures' folders are their library's, so a client can
see whose they are. A signature whose library matches no `.library` ref (CODESYS facade split) belongs to no named
item and is not returned. A full fetch still folders it under `(unresolved)`.

**Stays refused by name.** A library element addressed on its own (`onlyItems: ["TON.fb"]`) is not routed: signatures
are identified by path, not name (two libraries export the same short name, `RefsFetch.cs:102`). The client reads
the library. TwinCAT is in scope because its signatures exist.

**Migration.** Wire shape unchanged (same `FetchedItem`s, same flag). Only a directed `.library` read gets more items.
`docs/volt-bridge.openrpc.json` updates the `onlyItems` description. PLCAssist can drop its "manifest only" note.
