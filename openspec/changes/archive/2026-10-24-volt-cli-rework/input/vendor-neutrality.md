> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

# Vendor-neutrality audit (task 1.1a), read-only

Scope: the two contracts a new vendor meets: the WIRE (`src/Volt.Contracts/Wire`, `Vocabulary/`, `docs/wire.html`,
`docs/volt-bridge.openrpc.json`) and the `Volt.Engine/Ide` CONTRACT (`IIdeDriver` = `IIdeSession` + `IProjectTree` +
`ICodeStore`, plus `DriverBase`). Paths below are relative to `packages/volt-cli/src` unless they start with `scripts/`,
`docs/` or `packages/`. Tree: `dev` at 62451aa676. No code was changed.

The probe question is Siemens TIA (FB/FC/OB/DB/UDT/tag tables; SCL; LAD/FBD as SimaticML through Openness; STL
unsupported) and Rockwell (controller/tasks/programs/routines/tags, AOIs; RLL). This file does not design a host for
either. It only asks whether the SPLIT would let one say its own facts.

Severity:
- **blocks**: a new vendor cannot be added without changing Engine, wire or CLI code.
- **awkward**: it can be added, but it must speak a CODESYS-family fact it does not have (fake a code, answer for a
  concept it lacks, or have a family name show in its messages).
- **fine**: vendor-neutral as it stands.

The smallest change is named, not designed. 1.2 decides each item. Every wire change means protocol 2 (tasks.md, proposal).

---

## A. The wire

The file text is part of the wire. `fetch.changed[].sourceText` and `set.sourceText` ARE the workspace file, so the file
format (the `IMPLEMENTATION` line, `%`-lines, member headers, descriptor formats) is part of the contract a new
vendor meets, not only the JSON members.

| # | Fact | Severity | Evidence | How Siemens / Rockwell would say its own | Smallest change |
|---|---|---|---|---|---|
| W1 | **The kind set is closed and CODESYS-family.** 4 source extensions (`pou itf gvl dut`) and 18 reference extensions, 4 of them TwinCAT-only (`tmc`, `external_types`, ...) and 7 CODESYS-only (`device`, `projectinfo`, `trace`, `recipe`, `symbols`, `projectsettings`, `parameter_list`, ...) | **blocks** | `Volt.Engine/Item/ItemKind.cs:353` `SourceKindExtensions`, `:361` `ReferenceKindExtensions`, `:386` `WritableReferenceKinds`. `KindForWireName` `:404` answers null for any other extension, so `wire.html:181,198` refuses it `BAD_REQUEST` | Siemens: FB/FC/OB fit `.pou` if the text states the block kind (wire.html:165: "the text is ... never read for a kind"). A DB (global or instance) and a tag table have no CODESYS kind: they need `.db` / `.tags` (or a `.gvl` that is no `VAR_GLOBAL`). UDT fits `.dut`. Rockwell: a routine, a program's tag scope, an AOI and a controller tag list each need an extension. | One kind registry (extension → kind, role source/reference/writable, owning vendor). Each host adds its rows. It refuses two vendors that spell one kind differently, and one extension two vendors use for different kinds. `KindForWireName` reads that registry (see S1). |
| W2 | **Path shape `<folder>/<name>.<ext>`** | fine | `wire.html:65-71`; `Versioning.VersionedItem.Identity` | `PLC_1/Program blocks/Motor.pou`; `Controller/Tasks/MainTask/MainProgram/MainRoutine.<ext>`. The kind comes from the LAST dot, so a dotted Siemens name still parses. Unmeasured: whether a TIA or Logix name can contain `/`, which the path does not escape. | none (record the `/` question for a later vendor) |
| W3 | **`applications`** (+ `knownApplications`) | fine | `Volt.Contracts/Wire/Shared.cs:51-54`, `RefsFetch.cs:17-20`. The concept is "a root path that owns items"; only the doc's examples name CODESYS/TwinCAT | Siemens: each PLC device in the TIA project. Rockwell: the controller (one). | none. The doc examples could add "or the vendor's own program root". |
| W4 | **`IMPLEMENTATION <LANG>` line: the language list is closed** (ST shown; LD/FBD as network text; CFC/SFC/IL only `UNSUPPORTED`; any other word only `UNSUPPORTED`) | **blocks** | `Volt.Engine/Format/St/ImplementationMarker.cs:150` `IsNeverShown`, `:154` `IsKnown` (the six), `:170` (a bare unknown language is no line). `:301-308` `Split`: any first line that is not LD/FBD makes the body ST | Siemens: `IMPLEMENTATION SCL` (shown), `IMPLEMENTATION LAD`/`FBD` (its own graphical form), `IMPLEMENTATION STL UNSUPPORTED` (that last one works today). Rockwell: `IMPLEMENTATION RLL`. A bare `IMPLEMENTATION SCL` is refused today as an unmarked body (`INVALID_ST`). | Languages registry (S2): the line's grammar stays one, and the SET of shown languages comes from the registered readers. |
| W5 | **`health.networkText: bool`**: one switch for THE network form | awkward | `Volt.Contracts/Wire/HealthResponse.cs:33-40`; `Format/Network/NetworkTextSwitch` | A vendor with its own graphical form (SimaticML LAD) would need a second bool, or would have to lie with this one. | `languages: [...]`, the body languages this bridge reads in this process (ST, LD, FBD, ...). That is a wire change (protocol 2). |
| W6 | **Error code `INVALID_ST`** names one language for a Volt FILE-LAYOUT refusal (no `IMPLEMENTATION` line, a member header that cannot be read, a `%`-line out of place) | awkward | `Volt.Contracts/Vocabulary/BridgeErrorCodes.cs:31`; `wire.html:202` | An SCL or RLL file that breaks the layout would answer `INVALID_ST`. | Rename it to what it is (`INVALID_SOURCE` or similar) in protocol 2, or keep the code and document it as the layout error. Owner's call: it is a pure rename. |
| W7 | **`NETWORK_*` conflict codes** (`NETWORK_PARSE`, `NOT_CLOSED`, `DUPLICATE_NAME`, `BAD_EXPRESSION`, `UNKNOWN_OPERATOR`, `UNSUPPORTED`) | fine | `Vocabulary/ConflictCodes.cs:35,61` | A vendor's own graphical reader can reuse `NETWORK_PARSE` / `NETWORK_UNSUPPORTED` with a line number. | none. If S3 lets a vendor bring its own form, those readers map onto the same codes. |
| W8 | **`%`-lines (object properties) are a closed CODESYS set**: `%CLASS` (CHECK/PERSISTENT/TEXTLIST_ENUM/NVL/ABSTRACT), `%EXCLUDE_FROM_BUILD`, link-always, external, enable-system-call, online-change reserve, compiler defines, NetVar settings, parameter list, file link | **blocks** (for any vendor fact that needs a line) | `Volt.Engine/Item/ObjectProperties.cs:24` (a fixed record); `Format/St/PropertyLines.cs` (fixed keys); `ICodeStore.ValidateProperties` (`Ide/ICodeStore.cs:140`) is the vendor's refusal gate | Siemens: block number, optimized access, know-how protection, "Set ENO automatically". Rockwell: routine type, AOI revision. None has a line today; a host could only refuse or drop them. | Make the key set registered (each key with its owning vendor and value grammar). Keep ONE line grammar, so a key is still refused by name where its vendor is not the host (the current `ValidateProperties` behaviour). |
| W9 | **Descriptor formats** (`.task`, `.library`, `.device`, `.projectinfo`, `.projectsettings`, ...) are CODESYS-family layouts | fine as registry rows / awkward for `.library` | `Format/Task/TaskDescriptorFormat.cs:37` `TaskSettings` (type, interval, priority, event, watchdog, calls); `Library/LibraryManifest.cs` | Rockwell tasks fit `TaskSettings` surprisingly well (continuous/periodic/event, period, priority, watchdog, scheduled programs). Siemens has no task object (a cyclic-interrupt OB carries its cycle) and emits no `.task`. A Siemens global-library reference would need its own manifest, because the CODESYS library-manager concepts (placeholder, resolution, namespace) do not apply. | Tie each descriptor format to its registry row (S1), so a vendor that has none emits none and a vendor with its own brings its own format. |
| W10 | **The vendor id is closed in three places**: `openrpc` server enum `codesys\|twincat`; `Vendors.Display` throws on any other id; `PipeNames` has one const per vendor | **blocks** | `docs/volt-bridge.openrpc.json:16-18`; `Volt.Contracts/Vocabulary/Vendors.cs:18-22` (throws), `:27` `TwincatShellProcesses`; `Volt.Wire/PipeNames.cs:11-22` | `siemens` / `rockwell` would throw in `Vendors.Display`, and they have no pipe prefix. | One vendor table (id, display name, pipe prefix) that each host registers into. Generate the openrpc enum from it. `ProjectEntry.Vendor` is already a free string (fine). |
| W11 | **Health identity fields** (`productName`, `productVersion`, `productVendor`, `ideVersion`, `bridgeVersion`, `protocol`, `unsupported`, `projects[]{vendor,version,project,status,dirty}`) | fine | `Wire/HealthResponse.cs`, `Wire/ProjectEntry.cs` | TIA Portal V19 / Openness; Studio 5000 V36. | none |
| W12 | **Build diagnostics** `{name, member, code, severity, message, line, column}` | fine | `Wire/BuildModels.cs` | Siemens reports a LAD error per NETWORK, not per line. `line` can carry it (it is already derived on CODESYS, see memory `codesys-imessage-position-api`). | none |
| W13 | **Library fields** (`libraryManifestOnly`, `librariesRefreshed`, `.library` signatures under `libraries/`) | fine (optional) | `Wire/RefsFetch.cs:59-61` | A vendor with no library manager returns none. | none |
| W14 | **Member vocabulary on the wire**: `unsupported[].member`, `diagnostics[].member`, and the member headers in the file (METHOD / PROPERTY GET/SET / ACTION / interface members) | awkward (Rockwell) | `Item/ItemKind.cs:288` `MemberCode` and `:312` `MemberKind` are closed (an unknown member kind is `UNSUPPORTED`); `KindShape` at `:175` | Siemens: no members (fine, zero children). Rockwell: AOI parts (Logic, Prescan, EnableInFalse) and a program's routines look like members, but they are neither METHOD nor ACTION. | Member kinds go in the same registry as item kinds (S1), with their `KindShape`. |

## B. The `Ide/` contract: could a non-CODESYS host implement this?

| # | Member | Severity | Evidence | Judgement | Smallest change |
|---|---|---|---|---|---|
| C1 | **`int KindCode(ItemRef)`**, and the numeric kind table it answers in. The codes are TwinCAT `TREEITEMTYPE` numbers (601–700) plus CODESYS synthetic container codes (690 Application, 691 PlcLogic, 692 Device, 693 TaskConfig, 694 GenericContainer) | **blocks** | `Ide/IProjectTree.cs:41`; `Item/ItemKind.cs:28-125`. Engine branches on the codes ABOVE the seam: `Ide/TreeNav.cs:50` (TaskConfig), `:72`, `:86`, `:125` (`MoveHolders` = PlcFolder + Application), `:130-133` (names "device node", "PLC logic node", "task configuration node"), `:205`; `Sync/PushService.cs:995` (PlcTask), `:1443`, `:1918`, `:1931`, `:2026-2031` (interface accessor codes), `:2068-2069` (kind → create code); `Ide/MemberSites.cs:53,63`; `Ide/ProjectDeclarations.cs:115` (PlcGvl) | A Siemens or Rockwell host would have to map its object types onto Beckhoff's numbering, and its containers onto CODESYS's synthetic ones. The engine then reasons about "Plc Logic" and "Task Configuration" for a vendor that has neither. | The driver answers a vendor-neutral classification instead of a code: the kind string (a registry row, S1) plus a ROLE (folder / container / item / member / skip). The numbers move below the seam into each host. TreeNav's task-container lookup becomes a driver question ("where does a new task go under this folder?"). |
| C2 | **`CreateChild(parent, name, int kindCode, seed, ObjectClass? cls)`** | **blocks** (same cause) | `Ide/IProjectTree.cs:63`; the engine computes codes at `Sync/PushService.cs:2068-2069` and creates folders as `PlcFolder` at `Ide/TreeNav.cs:72` | Implementable once the kind is a string. `seed` (body language, or an interface member's type) and `cls` are fine: a host that has no class refuses one by name. | Take the kind string. The host maps it to its own create call. |
| C3 | **`WalkItems()` → `WalkResult{Items(Name, ItemRef, KindCode, Folder), UnwalkedFolders, UnreadableObjects, Applications}`**, plus the index walk (`ChildCount`/`ChildAt`/`Parent`/`Name`) that `ItemLookup`, `TreeNav` and `MemberSites` drive | awkward | `Item/WalkResult.cs`; `Item/ProjectItem.cs` (carries `int KindCode`); `Ide/ItemLookup.cs`, `Ide/TreeNav.cs` | The SHAPE fits any tree (TIA groups, the Logix controller organizer). The coupling is the `KindCode` in each row (C1), and the members being tree CHILDREN found by code (`MemberSites`). A vendor whose members are not tree children (a Siemens block has none; a Rockwell AOI's parts are fixed slots) can still answer zero children. | Same fix as C1 (kind + role per row). Nothing else. |
| C4 | **POU children: methods / properties / actions / interface members, `Member` record, `KindShape`** | fine (Siemens) / awkward (Rockwell) | `Item/ItemContent.cs` `Member` (`ReturnType`, `DataType`, `Getter`, `Setter`); `ItemKind.ShapeOf` `:175`; `MemberCode` / `MemberKind` `:288` / `:312` closed | Siemens: zero members. Rockwell: AOI parts and program routines would need member kinds the closed switch refuses. | Member kinds registered with their shape (S1). |
| C5 | **Get/set accessors: `InterfacePropertyAccessors(ItemRef)`** (required, no default) and **`ValidateInterfaceAccessor`** (default: no-op) | awkward | `Ide/IProjectTree.cs:74`; `Ide/DriverBase.cs:37` | Neither probe vendor has interfaces or properties. It can be implemented as unreachable (no interface property is ever walked), but every host must write it. It exists because enumerating TwinCAT's COM accessors crashes. | Give it a `DriverBase` default that throws "no interface properties". It stays required only where a host has the concept. |
| C6 | **Network bodies in the code store**: `WriteContent(item, content, IReadOnlyList<PushedNetworkBody>)`, `ValidateSource(existing, bodies)`, `NetworkScopeFor(...) → NetworkScope`; `PushedNetworkBody(BodySite, NetworkBody Model, NetworkScope Scope)` | **blocks** (for a vendor with its own graphical form) | `Ide/ICodeStore.cs:40`, `:90`, `:157`; `Ide/SourceScopes.cs:64` (the engine parses EVERY body that `NetworkText.Is` as the one network text) and `:109` | A vendor with no graphical body implements these as no-ops (fine). A vendor with its OWN form (SimaticML LAD, RLL) receives the CODESYS-family `NetworkBody` model, or nothing. It has nowhere to receive its own validated model and scope. | Key pushed bodies by language: `PushedBody(Site, string Language, object Model)`, where each registered language reader produces its own model (S2/S3). `NetworkScopeFor` becomes the network-text reader's own scope hook, not an `ICodeStore` member. |
| C7 | **`RefusedLanguageChange(site, from, to)`** | fine | `Ide/ICodeStore.cs:~150`; `DriverBase.cs:49` (abstract) | The site words (`pou`, `method`, `action`, `property_get`/`_set`) are member kinds, so they follow S1. | none beyond S1 |
| C8 | **`ObjectProperties` in content + `ValidateProperties`** | **blocks** (see W8) | `Item/ObjectProperties.cs:24` | The record is closed. A host can refuse a key, but it cannot add one. | W8 |
| C9 | **`WriteTask(ItemRef, TaskSettings)` / `ValidateTask`** | fine | `Ide/ICodeStore.cs:63`; `DriverBase.cs:40` | Rockwell fits. Siemens emits no `.task` and is never asked. | none (W9) |
| C10 | **`ReadManifest(item, kind)`**: a canonical text for every reference kind, parity-critical between the two vendors | fine | `Ide/ICodeStore.cs:~50` | The kind string is generic. The "byte-identical on both vendors" rule is about two hosts of one family. | none |
| C11 | **Build**: `Build()`, `GetBuildDiagnostics(Func<WalkResult>)` | fine | `Ide/IIdeSession.cs` | TIA compile and Logix verify both map. | none |
| C12 | **Libraries**: `ExtractLibrarySignatures()`, `LibrarySignatureCache` on the SESSION | awkward | `Ide/IIdeSession.cs:115-119`; `DriverBase.cs:160-163`; `Library/*` (the CODESYS library-manager model: placeholder, resolution, Materialization 4) | A host can return an empty list (fine). The model behind it (`LibraryManifest`, `LibraryLayout`) is CODESYS-family and lives in Engine. | Leave the members as they are. List `Library/` as a candidate to move below the contract (or into one shared CODESYS-family package), owner's call in 1.2. |
| C13 | **Threading**: `RunOnStaThread<T>`, `MarshalToIdeThread<T>` | fine (the name is awkward) | `Ide/IIdeSession.cs:84`; `DriverBase.cs:132,147` | "Run on the IDE's thread" is generic. STA is a COM detail. | Optional rename to `RunOnIdeThread`. |
| C14 | **Session**: `Vendor`, `ServedProjectName`, `IdeVersion`, `Product*`, `Unsupported`, `NotServedBecause`, degraded state, `SelectProject`, `Disconnect`, health probe | fine | `Ide/IIdeSession.cs`; `DriverBase.cs` | Generic. Connect is already per host. | none |
| C15 | **Refused names**: `RefusedName(kind, name)` / `RefusedMemberCreate` are fine. `BothVendorsRefusedNames` is a CODESYS-family keyword list in `Ide/`, and Engine itself refuses POU names with it | awkward | `Ide/BothVendorsRefusedNames.cs`; used by Engine at `Sync/PushedText.cs:84` | A third vendor would inherit the CODESYS reserved words in its push pre-flight (`LIMIT`, `MUX`, ...), whatever its own list is. | Engine asks the driver (`RefusedName`) and does not read the list itself. The list moves to the hosts (or to a shared family package). |
| C16 | **`HandlesSurviveStructureChange`, `Move`, `Rename`, `Delete(parent, name)`, `GetTreeRoot`** | fine | `Ide/IProjectTree.cs` | Generic. A Logix host refuses a move of a fixed node by name. | none |

## C. The three splits

### S1. Kinds by extension, through one registry

**Already holds:**
- ONE table maps extension ↔ kind: `Item/ItemKind.cs:353` `SourceKindExtensions` and `:361` `ReferenceKindExtensions`.
  `KindForWireName` (`:404`), `ExtFor` (`:442`) and `FileExtensions` all derive from it.
- The wire names an item by its extension, and a push resolves the handler from it.
- The text never decides a kind (`wire.html:165`).

**Hard-codes the CODESYS case:**
- The table is a static literal in Engine, so a host cannot add a row. It mixes both families' rows with no owning vendor.
- Kind behaviour is switched on numeric codes, not on the registry row: `Map` `:195`, `IsTopLevelCrud` `:235`,
  `InlinesItsChildren` `:258`, `IsContainerManager` `:282`, `MemberCode`/`MemberKind` `:288`/`:312`, `HoldsMembers`
  `:334`, `IsInlinedInPou` `:336`. Those are called above the seam from `Ide/ExcludedFolder`, `ItemLookup`, `MemberSites`,
  `ProjectDeclarations`, `TreeNav`, `Item/ProjectItem`, `Sync/BuildService`, `ProjectSnapshot` and `PushService` (22 call
  sites in Engine), and from both hosts (18 call sites).
- `IsTaskWireName` `:414` and `IsLibraryWireName` `:419` are kind-specific helpers in the shared layer.

**The extension set `bun run check` keeps identical.** It is the source set **`pou, itf, gvl, dut`**, canonical in
`ItemKind.SourceKindExtensions`, and is compared against:
1. `packages/volt-lsp-iec/src/workspace/source-extensions.ts:15` `SOURCE_EXTENSIONS`
2. `packages/volt-control/src/state/files.ts:10` `SOURCE_EXTENSIONS`
3. `packages/volt-vscode/package.json` `contributes.languages[structured-text].extensions` (`:72-77`)
4. `packages/volt-vscode/languages/structured-text/syntax.tmLanguage.json` `fileTypes`
5. `packages/volt-vscode/icons/volt-icons.json` `fileExtensions`
6. `plugins/volt-lsp/.claude-plugin/plugin.json` `lspServers.volt-lsp-iec.extensionToLanguage` (`:11-16`)

That is 7 copies with the canonical one, each a literal (`scripts/check-wiring.ts:136-143`). Two findings:
- **Every copy maps every source extension to ONE editor language, `structured-text`.** That holds only while every
  body is ST or network text. A Siemens `.pou` in SCL, or a Rockwell routine in RLL, chooses its language by the
  `IMPLEMENTATION` line, not by the extension, so the editor-side registration is per-language, not per-kind. awkward.
- **The reference-extension half of the check is vacuous.** `scripts/check-wiring.ts:163` expects
  `SCANNED_EXTENSIONS = [...SOURCE_EXTENSIONS, "…"]`. The file now reads
  `[...SOURCE_EXTENSIONS, ...REFERENCE_EXTENSIONS]` (`workspace-refs.ts:73`, with the set at `:69`), so the capture
  holds no quoted strings and "⊆ canonical" passes whatever `REFERENCE_EXTENSIONS` holds. This is a gate defect,
  separate from vendor neutrality. Fix: point the check at `REFERENCE_EXTENSIONS` at `:69`.

**Smallest change for S1 to hold:**
- One C# registry of rows (extension, kind, role, shape, writable, owning vendor). Each host registers its own rows.
  Registration refuses two vendors that spell one kind differently, and one extension two vendors use for different kinds.
- The numeric predicates move into the hosts (C1).
- `check-wiring` keeps reading the C# registry as canonical. For the TS/JSON copies, which cannot share a module, it
  stays a parity check, or the copies are generated from a dump of the registry.

### S2. Languages by the `IMPLEMENTATION <LANG>` line

**Already holds:**
- Every body states its language on one line, and the stated language alone picks the reader (`ImplementationMarker`,
  openspec `implementation-keyword`).
- The unsupported form already admits any vendor word (`VendorLanguage`, `ImplementationMarker.cs:~121`), so
  `IMPLEMENTATION STL UNSUPPORTED` works today.
- `StatedLanguage(Language, Hidden)` (`Item/ItemContent.cs`) carries a free string.
- `UnsupportedBody.language` on the wire is a free string.

**Hard-codes the CODESYS case:**
- `Format/Body/Languages.cs` is a closed set of six constants, and `IsNetwork` = LD|FBD.
- `ImplementationMarker.cs:150` and `:154` make the shown set exactly ST, LD and FBD. `:170` makes a bare unknown
  language no line at all.
- `:301-308` `Split` and `:318` `Join` treat every non-network body as ST.
- `BodyFormatGuard.cs:198` and `:259-281` give ST special rules (abstract bodies, statements); `:240` treats LD↔FBD as
  no language change (one network form).
- `NetworkText.ViewLanguage` (`Format/Network/NetworkText.cs:82-89`) maps the vendor's view mode (`DefaultViewMode`,
  DIALECT N1) into the language set inside Engine.
- `StReader.cs:1064` lists the three lines a body can state.
- Both hosts switch on `Languages.*` (`Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs:278,408-413`), which is fine:
  that is below the seam.

**Smallest change for S2 to hold:**
- A language registry: a name, plus a reader/writer pair (or "hidden only"). `ImplementationMarker` keeps the one line
  grammar and asks the registry whether a language is shown. `Split`/`Join` ask the reader instead of assuming ST.
- ST and network text register themselves, and `IMPLEMENTATION SCL` slots in as a row.
- The ST-only guard rules stay, attached to the ST row.

### S3. Networks as one form

**Already holds:**
- FBD and LD share one model, text and pipeline (`Format/Network/NetworkModel`).
- The drivers convert between their vendor object and the model below the seam (`NetworkText.Pulled` is called from
  the hosts).
- A vendor with no graphical bodies implements the network members as no-ops.

**Hard-codes the one form above the contract:**
- `ICodeStore.WriteContent`/`ValidateSource` take `PushedNetworkBody` (the model), and `NetworkScopeFor` returns
  `NetworkScope` (`Ide/ICodeStore.cs:40,90,157`).
- The engine pre-flight parses every network body as THE network text (`Ide/SourceScopes.cs:64`).
- `Sync/PushedText.cs:81` compares bodies as network text.
- `StatedLanguage.IsNetwork` (`Item/ItemContent.cs:72`) equals LD|FBD.
- `health.networkText` is one bool (W5).
- The model itself carries NWL vocabulary: `NwlMembers` (`Format/Network/NetworkMembers.cs:66`, a field of a model
  node at `NetworkModel.cs:146`), `RebuildLoss` candidates `nwl-*` (`RebuildLoss.cs:61-85`), and the language word
  `UnviewedNetwork = "NWL"` (`NetworkText.cs:73`).
- So `NetworkModel` is not vendor-neutral; it is the NWL tree (memory `network-text-readable-one-to-one`). Fitting
  SimaticML is unknown, as the task says: SimaticML is a flat parts-and-wires GRAPH (FlgNet: Parts + Wires), and
  `NetworkModel` is a tree that names only Demux split points. RLL is rung text with branch markers.

**Smallest change for S3 to hold:**
- Network text becomes ONE registered language family (LD, FBD) whose reader produces `NetworkBody`. The `ICodeStore`
  members carry a language-keyed body model (C6).
- `NetworkScopeFor` moves onto that language's plug-in.
- `NwlMembers` is renamed to a neutral name or moved with the model's NWL bag. Owner's call in 1.2: whether
  `Format/Network` itself is CODESYS-family and moves below the contract, which the tasks.md goal paragraph suggests
  ("NWL ... stays BELOW the contract").

## D. Engine names, the baseline for the 1.3 gate

Counted on `dev` at 62451aa676. Source `*.cs`, `bin/` and `obj/` excluded. "Symbols" means identifiers matching
`*(Codesys|Twincat|TwinCat|Beckhoff|Nwl|NWL)*` after `//` comments are stripped. "Lines" means every line mentioning
`codesys|twincat|beckhoff|nwl`, case-insensitive, prose and comments included.

| Project / area | Symbols in code | Lines (all) | Code lines (not a comment line) |
|---|---|---|---|
| Volt.Engine/Ide (the contract itself) | 0 | 93 | 0 |
| Volt.Engine/Item | 0 | 51 | 8 (trailing comments on the `ItemKind` code constants) |
| Volt.Engine/Format/Network | **17** (`NwlMembers` ×15, `NWL` ×2) | 83 | 28 |
| Volt.Engine/Format/St | 0 | 34 | 3 (strings in `StReader.cs:200-205`: "the CODESYS build ...") |
| Volt.Engine/Format/Body, Task, Settings | 0 | 19 | 0 |
| Volt.Engine/Library | 0 | 34 | 0 |
| Volt.Engine/Sync | 0 | 58 | 0 |
| **Volt.Engine total** | **17** | **372** | **39** |
| **Volt.Contracts** | **11** (`Codesys` ×3, `Twincat` ×3, `CodesysDisplay` ×2, `TwincatDisplay` ×2, `TwincatShellProcesses` ×1), all in `Vocabulary/Vendors.cs` | 59 | 8 |
| **Volt.Cli** | **5** (`Vendors.Twincat` ×2, `TwincatShellProcesses`, `TwincatDisplay`, `Codesys`) | 38 | 12 |
| Volt.Wire (not in the gate's list; reported) | 10 (`PipeNames.Codesys/Twincat/*Prefix/*Instance`) | 30 | 6 |
| Volt.Engine.Host | 0 | 12 | 0 |

**Vendor BRANCHES above the wire (the spec forbids a branch, a name is allowed):**
- `Volt.Cli/Sync/BridgeResolver.cs:35-36` (TwinCAT: elevated-XAE diagnosis), `:59-63`, `:107-115` (TwinCAT/CODESYS
  advice strings).
- `Volt.Cli/Interface/ConsoleServer.cs:235` (enumerates the two vendors).
- `Volt.Cli/Program.cs:73,596` (`codesys|twincat` in help).
- `Volt.Contracts/Vocabulary/Vendors.cs:18-27` (closed `Display`, TwinCAT process names).

Severity **awkward**: a third vendor works without them, but its errors are not diagnosed and `Vendors.Display`
throws. Fix: a vendor table (W10). Each host contributes its "why can't I reach it" probe through the connector or
the bridge, not through the CLI.

**What a name-based gate would MISS (proposal for 1.3).** The CODESYS family enters Engine mostly WITHOUT a vendor name:
- the 48 numeric kind constants and their predicates in `ItemKind`;
- 26 references to `ItemKind.Plc*` / container codes outside `Item/` (`TreeNav` 10, `PushService` 13, `MemberSites` 2,
  `ProjectDeclarations` 1);
- the six-language set, `NetworkBody` in `ICodeStore`, the `%`-key record, `BothVendorsRefusedNames`, and the
  CODESYS library model.

The 1.3 gate as written (no `Codesys`/`Twincat`/`Beckhoff`/`Nwl` symbol) would go green after renaming `NwlMembers`
and the Contracts/Cli constants, with all of the above still in place. Suggested addition: a second gate assertion
that no `ItemKind.Plc*` / numeric kind code and no `NetworkBody`/`NetworkScope` type appears in `Ide/I*.cs` or
`Sync/`. That makes C1 and C6 red until they are fixed, and the third test vendor (1.3) proves it.

## Summary for 1.2

**Blocks a new vendor:**
- W1/S1 the closed kind registry
- W4/S2 the closed language set
- W8/C8 the closed `%`-key record
- W10 the closed vendor id
- C1/C2 numeric TwinCAT/CODESYS kind codes in the contract, with the engine branching on them (TreeNav, PushService)
- C6/S3 the NWL `NetworkBody` model in `ICodeStore`

**Awkward:**
- W5 `networkText` bool
- W6 `INVALID_ST` name
- W14/C4 closed member kinds (Rockwell)
- C3 kind code per walk row
- C5 interface accessors with no default
- C12 `Library/` model in Engine
- C13 STA naming
- C15 `BothVendorsRefusedNames` used by Engine
- CLI vendor branches
- the single editor language per extension

**Fine:**
- W2 path shape
- W3 applications
- W7 network codes
- W9 task format
- W11 health identity
- W12 diagnostics
- W13 library wire fields
- C7, C9–C11, C14, C16

**Gate defect found along the way:** `check-wiring.ts:163`'s reference-extension check is vacuous.

**Wire changes implied (protocol 2):**
- W5: `networkText` becomes `languages`
- W6: optional `INVALID_ST` rename
- W10: openrpc vendor enum generated from the vendor table

Everything else is behind the wire (registries in Engine, contract signatures, moving codes into the hosts).
