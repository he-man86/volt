# Volt.Engine simplification review (read-only)

Scope: `packages/volt-cli/src/Volt.Engine`, with `Format/Network/` skipped. That is 57 files and 11,015 lines.
Read first: `ARCHITECTURE.md` and `Ide/DIALECT.md`. Nothing was edited, staged or committed.

## Headline facts

- **Hardly any code is dead.** I took every declared member (368 symbols) and counted its references across src and test.
  Each one is used at least once outside its own definition. The one dead public member is `PropertyLines.Is`.
  It has a generic name, so the word scan missed it; a qualified grep confirms it has no caller.
- **The bulk is comments: 4,522 of 11,015 lines (41%) are `//` or `///`.** `PushService.cs` alone is 1,027 comment lines out of 2,303.
  About 157 comment lines carry history markers ("used to", "it was", "no longer", "ARCH FOLLOW-UP", "deleted;").
  About 40 name components that are deleted: PLCopen, `ReadXml`, `PouDocument.Splice`, `StAssembler`, `AccessorDeclaration.Keep`,
  `SourceAssembler`, `HeaderLine`, `BodyElement`. Some of these comments are now **false** (convention #8: a false comment is a defect).
- The real code duplications are:
  - **three copies of the per-item version walk**: `ProjectSnapshot.Walk`, `FetchService.Handle` and the `PushService.Handle` pre-apply walk;
  - **two trivia scanners**: `CodeHelper.CodeOn` and `StTrivia`;
  - **one folder-descent loop** copied six times in `TreeNav`.

## Findings, sorted by lines removed × safety (low=3, med=2, high=1)

| # | file:line | what | simplification | est. lines removed | risk | how to prove it safe |
|---|---|---|---|---|---|---|
| 1 | `Sync/PushService.cs` (whole file, ~350), `Format/St/StReader.cs` (~100), `Item/ItemKind.cs`, `Ide/TreeNav.cs`, `Sync/FetchService.cs`, `Ide/DriverBase.cs`, `Format/Body/BodyFormatGuard.cs` (~150 together) | Bug-history narrative in comments ("it used to…", "measured on Lenze…", "found by sweeping…"). Typical spots: PushService 34-57, 140-173, 1097-1108, 1122-1136, 1149-1159, 1611-1626 (one paragraph stated twice), 1902-1924; FetchService 40-55, 202-221, 286-298 | Cut each "why" to the rule plus one citation (openspec id or DIALECT code); drop the war story. Keep anything that states a live invariant | ~600 | low (comments only) | `dotnet build Volt.sln` plus the full test suites are unchanged. `git diff --stat` shows only comment lines (`git diff -U0 \| grep '^[-+]' \| grep -vE '^\S\s*//'` is empty) |
| 2 | `Ide/ICodeStore.cs:12-34` | Class doc retells the deleted PLCopen `ReadXml`/`WriteXml` contract (23 lines) | Delete the history; keep the "what a driver owns" paragraph | 23 | low | Comment only |
| 3 | `Ide/ICodeStore.cs:80-82` | **False:** "CODESYS only … TwinCAT REFUSES" `WriteTask`. TwinCAT implements it (`BeckhoffDriver.Tree.cs:30` → `_om.WriteTask`; ItemKind's own doc says both vendors) | Fix the sentence | 2 | low | Comment only |
| 4 | `Ide/ICodeStore.cs:91-94`, `Ide/DriverBase.cs:25-27`, `Sync/PushService.cs:152-154, 242-248` | **Stale:** "TwinCAT's PLCopen writer refuses … from a pure function of the parsed body". There is no PLCopen writer now; TwinCAT edits the archive (DIALECT N4) | Reword to "the TwinCAT network writer's pure refusals" | ~10 | low | Comment only |
| 5 | `Sync/PushService.cs:1694-1707` | 14-line list of what "went with the PLCopen transport" (`ReadXml`, `PouDocument.Splice`, `RestoreChildFolders`…) | Delete | 14 | low | Comment only |
| 6 | `Sync/PushService.cs:1637-1654` | **Stale:** "TwinCAT's graphical CREATE resolves the body through a PLCopen import" | Keep one line: "a create refused mid-write is rolled back (see Rollback)" | 15 | low | Comment only |
| 7 | `Sync/PushService.cs:1985-1990`, `Sync/Materializer.cs:158-165`, `Item/ItemContent.cs:6-15, 87-89`, `Ide/IProjectTree.cs:80-81, 87-95`, `Sync/Versioning.cs:34-35`, `Format/Body/Languages.cs:7-11` | PLCopen-era history and **false** claims. ItemContent says "a read builds it from the IDE's PLCopen document … a push splices it into a document". IProjectTree.Move explains a PLCopen import flattening folders. Versioning says "PLCopen export has no FBD/LD body" | Delete or reword to the present design | ~35 | low | Comment only |
| 8 | `Item/ItemContent.cs:112-118` | A dangling `// <para>` block between `Member` and `Accessor` about the deleted `AccessorDeclaration.Keep` | Delete | 7 | low | Comment only |
| 9 | `Format/St/StWriter.cs:17-21, 162-164` | `StAssembler` deletion history. **False:** "`AccessorDeclaration.Keep` already dropped the trailing newlines" (that type is deleted and nothing trims) | Delete both | 8 | low | Comment only |
| 10 | `Item/ProjectItem.cs:7-8`, `Sync/ProjectSnapshot.cs:20-23`, `Sync/FetchService.cs:28-30` | **False:** "Exclude-from-build is NOT modeled — an excluded object syncs as an ordinary file". `%EXCLUDE_FROM_BUILD` is modeled (`ObjectProperties.ExcludeFromBuild`, ARCHITECTURE.md). ProjectSnapshot also cites a nonexistent `Ide.ProjectItem` | Delete or correct | 7 | low | Comment only |
| 11 | `Sync/BuildService.cs:28-45` | 18 lines on why the deleted `--full` flag was deleted | One line: "one build kind; Clean does not recompile (measured)" | 17 | low | Comment only |
| 12 | `Sync/FetchService.cs:339-355` | Orphan comments for `LibraryExt` / `ResolutionLine`, which moved to `LibraryFetch`, plus 6 blank lines | Delete | 12 | low | Comment only |
| 13 | `Ide/DriverBase.cs:19-22, 220-226` | Two "ARCH FOLLOW-UP RETIRED" history paragraphs | Keep one sentence each: CODESYS 1 s vs TwinCAT 5 s is the hosting asymmetry. **Keep the virtual knob:** it is load-bearing | 9 | low | Comment only |
| 14 | `Ide/DriverBase.cs:219, 247-249` | Dead branch `ProbeThrottleMs <= 0`. No driver or test returns ≤0 (TwinCAT 5000, test double 600_000) | `if (!published \|\| ageMs > ProbeThrottleMs)`, and drop its two comment lines | 3 | low | `grep -rn "ProbeThrottleMs =>"`: only 5000 and 600_000. Run `HonestHealthTests` |
| 15 | `Ide/IProjectTree.cs:36-40` | Stale "ARCH FOLLOW-UP: … reject a null native in the ItemRef constructor". That is done (`ItemRef.cs:40-42` throws on null) | Delete the done half | 4 | low | Comment only |
| 16 | `Ide/IProjectTree.cs:46-53` vs `:66-70` | CreateChild's `seed` `<summary>` sits above `HandlesSurviveStructureChange`, so that member has two summaries and CreateChild's doc is split | Move the seed text onto CreateChild (`:71`) | 0 (doc fix) | low | Doc-XML warning count drops |
| 17 | `Item/ItemKind.cs:291-298` | Stale orphan `<summary>` ("collected by SourceAssembler"). IsMember's doc sits on `MemberCode`, which then has three summaries | Delete line 291; move 292-298 onto `IsMember` (`:338`) | 1 | low | Comment only |
| 18 | `Sync/PushService.cs:2300-2302` | Trailing comment, **false**: "there is no interface_method/interface_property arm". `StReader.InterfaceMember` emits both, and `ItemKind.MemberCode` maps them | Delete | 3 | low | Comment only |
| 19 | `Sync/PushService.cs:1510-1517` | Two orphan comment blocks (the `WriteText` null rule, read-only enforcement) left above code they no longer describe | Delete | 8 | low | Comment only |
| 20 | `Format/St/StReader.cs:318-325` | `MemberHeaderKeyword`'s `<summary>` is stacked on `MemberKeywordFor` (two summaries), so `MemberHeaderKeyword` (`:337`) has none | Move it | 0 (doc fix) | low | Doc only |
| 21 | `Format/St/StReader.cs:924-925` | Stale "Re-scan to find last END_VAR". The boundary is stated now | Delete | 2 | low | Comment only |
| 22 | `Sync/ProjectSnapshot.cs:250-274`, `Sync/FetchService.cs:95-151`, `Sync/PushService.cs:67-96` | **Three copies of one per-item kernel:** Map → skip unmapped → skip container manager → `Versioning.SafeVersion` → record identity/version → record unreadable plus `Removal.AddUnreadable` → `CountUnclassifiable`. Both copies say "a third skip added to either walk must be added to the other" | Give `ProjectSnapshot.Walk` an `Action<ProjectItem, string kind, string folder, VersionedItem>? onItem` hook. FetchService layers onlyItems, library refs and changed on top; PushService takes `currentVersions` from `snap.Versions` (it also needs ungated addressable items for `itemCache`, so keep that loop's cache half) | ~50 | med | `EndpointParityTests`, `FetchServiceTests`, push suites green; the refs/fetch/receipt version maps are byte-identical on the corpus fixtures |
| 23 | `Format/St/CodeHelper.cs` (whole file, 84) | A **second trivia scanner** (no nesting, misses a comment opened after code). It has one production caller: `StDeclaration.BasesOf:195` (the EXTENDS scan). `StTrivia` is "THE trivia skipper" | Make `BasesOf` iterate `StTrivia.Code(lines)` and delete CodeHelper and `CodeHelperTests`. Swap `FakeIde.cs:95` to `StTrivia` (it is internal, but the tests have InternalsVisibleTo) | 84 src (+~80 test) | med | Behaviour differs only for a nested `(* (* *) EXTENDS X *)` or a comment opened after code, where the new answer is the correct one. Run `StDeclaration`/scope tests and the network scope tests. Update the `NoKindFromTextTests` / `NoCodeCheckLeftTests` gate entries naming CodeHelper.cs |
| 24 | `Ide/TreeNav.cs:33-44, 66-82, 94-125, 141-151, 203-214` | One "for each `FolderPath.Segments`, find a child by name and predicate, else null or create" loop, written 6 times (`ResolveTopLevelFolder`, `ResolveTaskParent`, `ResolveFolder`, `DescendExisting`, `RefusedMoveTarget`, `FindFolder`). `DescendOrCreateFolder`'s defaults `created = null, path = null` and `path ?? name` are dead (every caller passes both) | One private `Descend(ide, from, folder, Func<ItemRef,bool> isContainer, bool create, List<string>? created)`. `RefusedMoveTarget` becomes `IsNullOrEmpty(folder) \|\| DescendExisting(...) is not {} n ? null : …` | ~30 | low | `TreeNavTests`, `PruneEmptied*`, move/placement suites; FakeIde push suites |
| 25 | `Format/St/StReader.cs:128-132, 1072-1075, 1085-1087`; `Format/St/ImplementationMarker.cs:49-51, 108-110, 251-266` | **Compat code:** the `(* @volt-… *)` retired-comment HINT for files from "a Volt from before the keyword". The owner says no users and no backward compat (`no-users-no-backward-compat`) | Delete `FindRetiredComment`, `RetiredTag` and the hint; `Unmarked` keeps the generic "Run `volt pull`" message | ~30 | med | `ImplementationKeywordTests` rows at :47-49 and :537 assert the hint. Their premise (compat) is removed on owner grounds independent of the code, so the test change is legitimate under convention #10 |
| 26 | `Format/St/ImplementationMarker.cs:268-280` | `IndexIn` re-runs `StatedLinesIn` that its only caller (`StReader.SplitAtBoundaryAt:652-658`) has just computed | Use `stated.Count == 0 ? -1 : stated[0]` at the caller; delete `IndexIn` and its doc | 14 | low | `grep IndexIn`: one caller. Same value by construction |
| 27 | `Format/St/StReader.cs:160-162, 234-236, 274-276` | The "neutralize never-closed `(*`" pair (`UnterminatedOpenings` + stand-in check + `Neutralized`) is written 3 times | `private static List<string> StructureView(string text, List<string> original, out bool neutralized)` | 6 | low | StReader suites, `StFixedPointTests` |
| 28 | `Format/St/StReader.cs:281-283, 344-346, 304-309, 1350-1355` | Four hand-rolled "identifier word at i" scanners | One `WordAt(string, int)` (already a local in `HeaderNameAt`) | 8 | low | `ChildSplitterTableTests`, `StReader*` |
| 29 | `Sync/PushService.cs:995, 1117, 1234, 1272, 1675, 1689, 1808` | 7× `ItemLookup.Find(ide, n) ?? throw new BridgeException(IdeLostItem, …)` | `static ItemRef Refind(IIdeDriver ide, string name, string why)` | ~12 | low | Messages passed through unchanged; push suites |
| 30 | `Sync/Materializer.cs:158-170` | `BuildSource(ide, item, kind)` is a one-line forward with an **unused** `kind` parameter under 9 lines of PLCopen history | Inline `AbstractMemberFold.Apply(ide.ReadContent(item))` at `:19` | 12 | low | Compile |
| 31 | `Sync/PushService.cs:2016-2023` | `RefuseMemberRetypes(name, live, pushed)` runs again inside `ReconcileMembers` on the same `live`/`split` the update arm already checked at `:1609` (a create's `live` has no members) | Delete the second call and its comment | 8 | low | Push re-type/class tests (`AccessorReconcileTests`, one-to-one suites) |
| 32 | `Format/St/Descriptor.cs:27-45` | Three constructors (`()`, `(pad)`, `(pad, spaceAfterLongLabel)`) and a field declared after them | One `Descriptor(int pad = 0, bool spaceAfterLongLabel = false)` | 8 | low | `DescriptorTests`, the task/settings format tests; callers compile unchanged |
| 33 | `Ide/MemberSites.cs:280-291` | Hand-written readonly struct with ctor + 4 props | `public readonly record struct Site(string? Folder, ItemRef Ref, string Name, int Code)`. `KindShape` already uses record struct on this TFM | 8 | low | Compile. Callers use `new Site(...)` and named props |
| 34 | `Format/Task/TaskDescriptorFormat.cs:221-226` | `Gate(text) => Read(text)`, a pure alias with a 4-line doc | Call `Read` (2 src + 4 test sites) | 6 | low | Identical body |
| 35 | `Sync/PushService.cs:112-118` vs `124-132` | The PushRefusal path rebuilds `RejectAll`'s `currentProjectVersion ?? ProjectSnapshot.Walk(...)` fallback | Hoist `RejectAll` above the try and call it (keep the log line) | 4 | low | Push BAD_REQUEST tests |
| 36 | `Ide/ProjectDeclarations.cs:110-112` | `NoPush` is an alias of `PushedDeclarations.None` | Use `PushedDeclarations.None` | 3 | low | Compile |
| 37 | `Format/Body/BodyFormatGuard.cs:259-260` + `Format/St/AbstractMemberFold.cs:159-160` | The same private `IsAbstract(string?)` twice | One `StReader.IsAbstractMember(string?)` (null-safe) | 3 | low | Compile, abstract-member suites |
| 38 | `Format/Body/BodyFormatGuard.cs:310-320` | `PushedLanguage` calls `StatedOf` twice; its `<para>` sits after `</summary>` (malformed XML doc) | `StatedOf(...) is { IsNone: true } ? St : s` with one call; move the para inside | 1 | low | Compile |
| 39 | `Format/St/PropertyLines.cs:74-75` | `PropertyLines.Is` is **dead** (0 callers in src/test) | Delete; drop the `<see cref="Is"/>` in `Read`'s doc | 3 | low | `grep -rn "PropertyLines.Is\b"` is empty |
| 40 | `Ide/InterfaceAccessorGuard.cs:301-304` | Public `Unchanged` only forwards to private `Same` | Rename `Same` → `Unchanged` (public) | 2 | low | Compile |
| 41 | `Sync/Materializer.cs:146-150` | `IsVerbatimKind`: a bare name already ending in `.ext` is used as the wire name as is. It is an unmeasured, untested special case (since #42), a "guess" shape, and `Bare()` would then strip it to a different identity | Always `$"{bare}.{ext}"` | 3 | med | No test covers it (`grep IsVerbatimKind`). Add a test that an IDE item literally named `X.pou` gets `X.pou.pou` (or a refusal), then delete |
| 42 | `Volt.Engine.csproj:62, 66` | `System.Text.Json` PackageReference is unused in Engine (0 hits; transitive via Contracts). The comment says "Wire/BridgePipeHost serves Core's services", but BridgePipeHost lives in `Volt.Engine.Host` | Drop the reference and fix the comment | 2 | med | `dotnet build Volt.sln -c Release` plus the CODESYS `VoltBundle` ILRepack target still merges STJ (it comes through Contracts) |
| 43 | `packages/volt-cli/ARCHITECTURE.md:124, 128, 218, 226-237, 359` (outside Engine, describes it) | Stale references: `BodyMarker` (nonexistent), `Graph/NetworkCode`, the `Document/BodyElement` `<body>/<addData>` paragraph (PLCopen era), `ImplementationMarker.AppliesTo` (deleted → `ItemKind.ShapeOf`), "`Wire/BridgePipeHost`" (it is `Volt.Engine.Host`) | Correct | ~8 | low | Doc only |

### Totals

| bucket | lines |
|---|---|
| Code (and the docs that go with it) removable: rows 14, 22-24, 25-42 | ~310 |
| Stale or false comments (verifiable): rows 2-13, 15, 17-19, 21, 43 | ~200 |
| History narrative compressible (judgment): row 1 | ~600 |
| **Total** | **~1,100 of 11,015 (≈10%)** |

## Checked and deliberately NOT recommended

These look like candidates but are load-bearing, or the change would be neutral or harmful:

- **`IIdeDriver` (empty composite of three facets).** Each facet is consumed on its own: `ItemLookup`, `MemberSites` and `ProjectDeclarations` take `IProjectTree`; `DriverBase` implements `IIdeSession`. Keep.
- **`DriverBase.ProbeThrottleMs` virtual (TwinCAT 5000 vs 1000).** A documented hosting asymmetry. Keep.
- **`HandlesSurviveStructureChange`, `InterfacePropertyAccessors`, `TreeNav.ResolveTaskParent`.** DIALECT-measured vendor facts (D4d/D4j, D21, C22). Keep.
- **`BothVendorsRefusedNames.cs` (176 lines).** Generated and gated. Keep.
- **`ItemKind.PouKindToCode` / `MemberCode` twins.** Could live together in ItemKind, but that saves no lines.
- **The `AdmittedKind` / `SourceOf` re-checks in `WriteItemFromSource`, and `ApplySetTask` re-gating.** Invariant asserts that fail loud (owner style). Keep.
- **`ItemLookup` vs `TreeNav` child scans.** Their catch semantics differ (lookup refuses a fault; TreeNav passes over an untouchable). Merging them would blur the "fault is not absence" rule.
- **`LibraryManifest.Materialization` format list.** It drives the LSP's stale-workspace message (live mechanism, not compat).
