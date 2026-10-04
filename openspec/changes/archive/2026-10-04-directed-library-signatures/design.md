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
signatures whose `LibraryPath` names the same library title AND company (pinned on recorded strings in 1.1, where
every path carries a company; gate step 3 ruled that a company-less path — no recording has one — is NOT
wildcard-claimed and stays `(unresolved)`, since a title-only match would be a guess; pinned by
`A_wildcard_ref_does_not_claim_a_path_without_a_company`). So the full fetch writes those elements beside their `.library` too, and directed ==
full holds.

**Two refs, one library (gate step 1).** Refs that repeat ONE RESOLUTION are real and common: 4 of the 5 CODESYS
corpora carry `CAA Callback` and `CAA Callback Extern`, both `RESOLUTION CAA Callback Extern, 3.5.17.0 (CAA
Technical Workgroup)`, both `NAMESPACE CB` (38 element files, all beside `CAA Callback Extern`); lenze-mid also
`SysTimeCore` (placeholder) and `SysTimeCore, 3.5.17.0 (System)` (direct, 4 files); pro2193 `SysTime` twice (no
elements). They name ONE compiled library: not ambiguous, never refused. Today `libByResolution` keeps the ref the walk
reached LAST (`FetchService.cs:158`), an order nobody chose. **Decided (default, the owner may overrule):** the matcher
gives such a RESOLUTION one owner, the ref with the ordinal-least FULL name (`CAA Callback Extern.library`,
`SysTimeCore, 3.5.17.0 (System).library` — the folders the corpora already show), so the signatures are written
ONCE (writing them beside both would declare every element twice in one namespace), and a directed read naming
EITHER ref returns them in the owner's folder (the same bytes as the full fetch; no zero-match Warn for the other). One
full name in TWO folders with one RESOLUTION (Pro2193's root and Application Library Managers; 0 occurrences — its 13
pairs differ in RESOLUTION) is tie-broken by the rule that picks the surviving stub, `DedupeByFullName`'s LAST walked,
so the signatures never land in a folder whose stub was deduped away (gate step 3, finding 1).
Refused by name, by contrast: one signature path claimed by refs with DIFFERENT RESOLUTIONs, which only the wildcard
rule can produce (`X, * (V)` beside an `X` ref of another version, or two compiled versions of X). None of the five
corpora has a wildcard ref sharing its title + company with any other ref; the signature side of that check is
recorded for the two projects measured live only (1.1). Scope of that refusal (gate step 2, default — the owner may overrule):
a DIRECTED read naming either claimant throws, naming both refs and the path; a FULL fetch does not throw (that
would make the whole project unpullable) — it keeps the path's signatures under `(unresolved)` and names both refs
and the path in a Warn.

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

## 3. Build (2026-10-03)

**Target.** §0's route, on both vendors: a directed read naming `X.library` returns X's manifest plus X's signatures,
the bytes and folder a full fetch writes; the 2.1 / 2.2 / 2.4 red tests go green; `librariesRefreshed` stays false.

**Choice 1 — the matcher sees every ref, the answer only the named ones.** The walk captures the RESOLUTION of EVERY
walked `.library` before the `onlyItems` skip (`FetchService.cs:148`), because the ordinal-least owner of a repeated
RESOLUTION and the different-RESOLUTION refusal both need the refs nobody named. One `LibraryFetch` matcher (exact,
then wildcard title + company) serves both fetches; the directed answer keeps only the named refs' folders, then Warns
per named zero-match library and logs `N extracted signatures … claimed by no named library`.

**Choice 2 — a per-RESOLUTION session cache for directed reads (R2 answered by the owner's recorded decision).**
1.2 sent 3.1 to the owner: on CODESYS every extraction runs `Build(app)` — 22.4-22.9 s after one edit on Pro2193 —
and REPLACES the engineer's compiler message view. The owner had already decided this in the proposal ("the
extraction is cached per library RESOLUTION in the session, so repeated reads cost one extraction"); §0 overrode it
only as a default pending 1.2, and 1.2 measured exactly the case the cache removes: the precompiled library set is
untouched by an edit and by Clean (7229 → 7229), so the API a read returns cannot have moved — only the build is paid.
- Shape: an engine-held `LibrarySignatureCache` on the pipe host's session (vendor-neutral, so `BeckhoffDriver`
  needs nothing beyond its existing `ExtractLibrarySignatures`): the last raw extraction plus the {folder/full name →
  version} of EVERY walked `.library` it was taken against. A directed read reuses it iff that whole map is unchanged
  (none added, removed or moved) and the bound project is the same; otherwise it extracts once and replaces it.
  Matching, Warns and counts run fresh each read.
- The key is every `.library` version — exactly the change signal D1 trusts for the full fetch. It was first keyed on
  the NAMED refs only, and gate step 3 (finding 2) showed that a new hole: the matcher runs over every ref plus the
  extraction's paths, so after an UNNAMED library was added or upgraded a reused extraction could answer signatures
  where a fresh read refuses (two RESOLUTIONs on one path; a wildcard over two compiled versions) and a full fetch keeps
  them `(unresolved)` (0 occurrences in the corpora; fixed because it was cheap). The hole D1 has stays, and is the only
  one: a wildcard re-resolving mid-session without any manifest change is missed exactly as the full fetch misses it.
- The full fetch is unchanged (D1: extracts iff `knownItems` says a library moved); its extraction refreshes the
  cache, it never reads it.
- Rejected: no cache (§0's default) — every per-item client read pays the build and rewrites the message view;
  precompiled read without `Build(app)` — "complete for the named library" has no fact to stand on (facade refs
  match zero by nature, so it would build on every facade read anyway); a cache per signature path — the vendor
  extracts all libraries in one call (DIALECT C2c), so a finer key saves nothing.
- First read per session still pays the build and writes build output, as `volt init` does today; stated in the
  `onlyItems` doc, not hidden.

**Choice 3 — `volt show BRIDGE` asks for the manifest only (R3).** `FetchRequest.LibraryManifestOnly` (bool, absent =
false, the same convention as `Init`): set, a directed `.library` read neither extracts nor touches the cache. Only
`volt show` sets it; PLCAssist and every other caller get the owner's "a `.library` read returns everything".

**Stays refused by name.** A library element addressed on its own (`onlyItems: ["TON.fb"]`); one signature path
claimed by refs with DIFFERENT RESOLUTIONs on a directed read (a full fetch Warns and keeps it `(unresolved)`).

**Migration.** Response shape unchanged; one optional request field. **The full fetch changes too, not only the
directed read** (gate step 3, finding 4): with the wildcard rule a full fetch writes each wildcard ref's signatures
beside its `.library` (688-713 files, 25-27 libraries per real CODESYS corpus) instead of under `(unresolved)/<title>`.
A workspace pulled before this change keeps the old `(unresolved)` tree on every later `volt pull` — signatures are
re-rendered only when a `.library` version moves (`librariesRefreshed`), and the manifest bytes did not move — while a
fresh `volt init` of the same project writes the new layout. Nothing is lost, and the two converge on the next library
change (its refresh drops the old tree), but until then two workspaces of one project disagree and nothing says so.
Not forced here: the volt-native repair is a `LibraryManifest.Materialization` bump (it moves every `.library`
version, so the next pull refreshes, and the LSP names a stale workspace) — but it also marks all six committed
corpora (695 format-4 manifests in `packages/volt-lsp-iec/test-corpus`) stale, which silences their network-text
diagnostics until each is re-pulled live; a bridge-side "a known `(unresolved)` folder a wildcard could claim" trigger
would rebuild on every pull wherever the folder stays unresolved (another company, two compiled versions). **Left for
the owner** (bump + corpus re-pull, or accept convergence on the next library change). `RefsFetch.cs` docs (`OnlyItems`,
`LibrariesRefreshed`, the new field) and `docs/volt-bridge.openrpc.json` regenerated. The 2.3 test
`Each_directed_library_read_extracts_once_and_nothing_is_cached` and the spec scenario "a second read is warm …
without a session cache" encoded §0's default, which the owner's recorded decision overrides (a premise wrong on
grounds independent of the code): they become "two directed reads with no library change extract ONCE; a moved
`.library` version extracts again". TwinCAT (3.2) runs the same engine path; its answers are compared in shape to
CODESYS's by the 2.4 table.
