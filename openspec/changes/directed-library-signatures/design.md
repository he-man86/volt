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
| CLI read-only library folders | No workspace write: both CLI `onlyItems` callers filter the answer by name (`Commands.cs:934` pushed items, `:1031` `volt show`). But `volt show BRIDGE <…>.library` (the incoming diff pane on a drifted library, `volt-control` `view/diff.ts:35`) DOES send the `.library` in `onlyItems`, so after the change each open would pay a full extraction and throw it away. `volt show` asks for the manifest only (decided with the wire type in 3.1). |
| Precompile cost | OPEN until 1.2. CODESYS's extraction runs `Build(app)` of the whole application (`CodesysObjectModel.Libraries.cs:183`) in the engineer's live IDE. The archived warm figure (97 ms) was measured with no edit in between, and the edit case is an open question there (`cache-library-signatures` design.md:75). 1.2 measures edit-then-read: the time, and whether the message view gains build output. If the read is cold after an edit, or writes build messages, the route goes to the owner before 3.1. |

**Choice: how.** When `onlyItems` names at least one `.library`, extract (the same call; neither vendor has a
per-library call, DIALECT C2c) and render only the signatures whose `LibraryPath` matches a RESOLUTION captured in
`libByResolution` for a NAMED library, by the ONE matcher the full fetch uses too (below). Rejected:
- render all of them. `AppendLibrarySignatures` would put every other library's elements under `(unresolved)`.
- set `librariesRefreshed` true. Its contract is "the complete set for EVERY library folder" (`RefsFetch.cs:100`),
  and `IdeTree.DroppedLibraryFile` would wipe the folders of libraries nobody named.
`librariesRefreshed` stays false on a directed read. The signatures' folders are their library's, so a client can
see whose they are.

**The matcher learns the wildcard (gate step 0, R1).** An exact RESOLUTION join misses every ref whose RESOLUTION
is a wildcard (`CmpEventMgr Interfaces, * (System)`): its signatures carry the resolved library's identity, so
today a full fetch folders them under `(unresolved)` and a directed read would return the manifest alone. That is
about 10% of each CODESYS corpus's library API (688-713 of 6238-7408 files; 25-27 libraries per real corpus, counts
in tasks.md 0.1 R1). The join gets a second rule, in one place, for both fetches: a wildcard ref matches the
signatures whose `LibraryPath` names the same library title (and company, when `LibraryPath` carries it; pinned
on recorded strings in 1.1). Two refs claiming one signature is refused by name. So the full fetch writes those
elements beside their `.library` too, and directed == full holds.

**Left for the owner: the facade split.** 4-5 `(unresolved)` libraries per corpus (115-132 files: `cmpusermgr
implementation`, `data server interfaces`, …) match no ref at all, while their facade refs (`CmpUserMgr, 3.5.17.0
(System)`, `CmpEventMgr`, …) hold no element. A full fetch has the same gap today, and joining a facade to its
implementation needs a rule volt does not have. Until then the directed answer is loud, not silent: it names (Warn)
every named library that matched zero signatures and counts the extracted signatures no named library claimed.

**Stays refused by name.** A library element addressed on its own (`onlyItems: ["TON.fb"]`) is not routed: signatures
are identified by path, not name (two libraries export the same short name, `RefsFetch.cs:102`). The client reads
the library. TwinCAT is in scope because its signatures exist.

**Migration.** Wire shape unchanged (same `FetchedItem`s, same flag). Only a directed `.library` read gets more items.
`docs/volt-bridge.openrpc.json` updates the `onlyItems` description. PLCAssist can drop its "manifest only" note.
