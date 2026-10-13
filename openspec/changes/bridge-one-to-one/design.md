# Design — bridge-one-to-one

> **State.** This file was started by step 0 (the census, tasks 0.1 / 0.2) and holds MEASUREMENTS only: §0.1 the
> schema census per item kind per vendor, §0.2 the read/write inventory. The disposition table (every member →
> spelled / measured editor cache / refused by name), the contract and the `%`-line forms are tasks 1.1-1.3 and are
> not decided here. Nothing below is a decision; where a row says "candidate" it names what 1.1 must decide.

## 0.1 Schema census (measured 2026-10-13)

### Method

**CODESYS** (SP21 Patch 4, profile `CODESYS V3.5 SP21 Patch 4`): one scratch IronPython runscript (`--noUI`, its own
`CODESYS.exe`, a COPY of each project via `voltprobe.open_copy`; not kept — probes are single-use) opened the five
CODESYS corpora from the project files `refresh-corpus.ts` names (`test/fixtures/CodesysTestProject.project`,
`Bakon Nano new VISU v00_90.project`, `AWA_Palletizer 09_1.project`, `Pro2193-94-95-96_COdesys.project`,
`Lenze_MID-S100_V5_00_602_T51_Codesys.project`) and, for every object `ObjectMgr.GetAllObjects(project)` lists, read
the vendor's OWN archive: `IMetaObject.SerializableValueNames` / `GetSerializableValue` (meta level: `Guid`,
`ParentGuid`, `Name`, `TypeGuid`, `EmbeddedTypeGuids`, `Timestamp`, `Properties`), every `IObjectProperty` in
`Properties`, and the object's own `SerializableValueNames` — recursively into archived sub-objects (depth 4; every
list element walked; device / visual / trace / recipe / image-pool / symbol / workspace / project-info classes and the
GLOBAL text list at depth 1 — the text-list ENUM (`TextListEnumerationObject`) at depth 4 like every source class; a graphical (NWL / CFC) `Implementation` at depth 1 — NWL members are
`ld-fbd-coverage`'s). These are exactly the members CODESYS writes into the `.project`, so "every serialized member"
is the vendor's own list, not Volt's guess. A second scratch runscript (pro2193 open) listed every concrete `IObject`
and `IObjectProperty` class in the loaded assemblies with its `[DefaultSerialization]` members, so classes and
properties with NO corpus occurrence are listed too. Runs: 95 s and 107 s, 26 s for the class list, and — after
review — a third run, 105 s, that walks EVERY list element (the first two sampled each list at its first 12, so only
105 of the 264 library-manager items and 12 of an SFC property's 15 flags were seen) and the text-list enum at full
depth; **every value distribution below is the third run's**, and no row is a sample. `GetAllObjects`: CodesysTestProject 16, bakon-nano
214, awa-palletizer 118, pro2193 3363, lenze-mid 371 — **4082 objects; 37 object classes seen of 104 loaded; 13
property classes seen of 37 loaded.** (An `Interface` / `Implementation` aspect's TEXT travels outside
`SerializableValueNames` — its `TextDocument` archives only `LineInfoPersistence` and a null
`TextBlobForSerialisation`; the text is what Volt already spells.)

**TwinCAT** (TcXaeShell 15.0 files, read offline — the files are the vendor's archive): a scratch XML walk over every
`.TcPOU/.TcDUT/.TcGVL/.TcIO/.TcTTO`, `.plcproj` and `.tsproj` of the corpus solution `test/fixtures/TwinCAT Project14`
(two PLC projects: `Untitled2` is the `twincat-project14` corpus; `Untitled1`'s `.plcproj` compiles only
`PlcTask.TcTTO`), every element and attribute path with its value distribution. Only what TwinCAT LOADS is walked:
the 13 files a `.plcproj` `<Compile Include>` names (8 `.TcPOU`, 2 `.TcDUT`, 1 `.TcGVL`, 2 `.TcTTO`), the two
`.plcproj` and the `.tsproj`; three git-tracked `.TcPOU` no `.plcproj` names are not (listed under the table; the
first walk counted them — corrected after review). The corpus snapshot `test-corpus/twincat-project14` is a pull of
`Untitled2` WITHOUT `VltFixtureMembers` — the only action and method rows come from that file, so they are a
fixture's, not the snapshot's. The committed fixtures `TwinCAT Project13` and
`Volt.Ide.Twincat.Tests/fixtures/tc-pou` were walked as a supplement (paths only they hold are listed separately —
fixtures, not a corpus). NWL archive internals inside an `Implementation` (`Implementation/LD|FBD|NWL|CFC|SFC/…`) are
excluded (owned by `ld-fbd-coverage`). An `XmlArchive` under `<ObjectProperties>` is NOT an NWL internal — it is the
object-property carrier — and is listed in its own table below the element table (the first walk excluded every
`XmlArchive` and so reported the carrier empty — corrected after review).

**Abbreviations**: CTP = CodesysTestProject, bak = bakon-nano, awa = awa-palletizer, pro = pro2193, len = lenze-mid.
`n` counts objects (for a `[]` row: list elements, every element counted). `guid` = a GUID value; `text(n lines)` = a
string with a newline or over 48 characters.

### Findings

CODESYS:

1. **Object properties are a second archive beside the object** (`IMetaObject.Properties`), and Volt reads none of
   them except through the folder walk. Seen: `SVFoldersProperty` 2240 (the folder an object sits in — Volt spells
   it as the folder), `DeviceProperty` 186 (device identity — the `.device` descriptor reads it through the
   scripting facet), **`BuildProperty` 56** (by class: POU 28, method 8, folder 5, image
   pool 5, GVL 3, DUT 2, Application 2, check function 1, property 1, device 1 — the pro `Device`, `ExcludeFromBuild
   false`; the one the per-class rows below do not show, since a device is not a source class), `CFCProperty` 10, `ImagePoolPropertiesObject` 9, `ModuleType` 8,
   **`POUImageProperty` 2** (two pro POUs carry a 448,974-byte image each), `SFCProperty` 2, **`FileLink` 1** (a bak
   GVL linked to an external file, `LinkType = ExportBeforeCompile`), `ApplicationInfoObjectProperty` 1,
   `BaseLibrariesProperty` 1, `MathLibrariesProperty` 1, `VisualProperty` 1. Loaded with 0 occurrences:
   `ObjectCommands.DocumentationProperty` (`Documentation` — the object comment, the proposal's `%COMMENT`
   candidate), `Engine.ObjectAccessProperty` (`VerbToPermissionId`, `Acl` — per-object access rights),
   `TextList.TextListPropertiesObject`, `TransitionObject.TransitionMonitoringProperty`,
   `ActionObject.ActionObjectDuplicationModeProperty`, `TransitionObject.TransitionObjectDuplicationModeProperty`,
   `SFCObject.SFCLibraryProperty`, `StringLibraries.StringLibrariesProperty`, and the CNC / CAM / Composer / C-source /
   Profibus / Profinet / DataSources / Trend properties (table below).
2. **`BuildProperty` non-default values on Volt source items — proposal finding 3, counted.** `ExcludeFromBuild =
   true` on **11 source objects** (pro: 3 POUs, 7 methods, 1 check function; len: 1 POU) and **4 folders** (pro),
   plus the hidden image pool of every corpus (5; not a Volt item). `LinkAlways = true` on **3 GVLs** (pro, len,
   awa). `MemoryReserveForOnlineChange = 200` on **15 POUs** (pro). `CompilerDefines = 'VISU_USEPROPERTYINFO'` on 2
   Application objects (awa, pro — not a Volt item). `External = true`, `EnableSystemCall = true`, non-empty
   `Undefines`: **0**. A `BuildProperty` that exists holds all seven members; 56 of 4082 objects carry one.
3. **Classes Volt folds (proposal finding 1, counted).** `POUObjectCheckFunction` **15** (bak 5, pro 10) — its
   `SpecialFunc` names the check (`CheckBounds` ×2, `CheckDivInt32/Int64/Real32/Real64` ×2 each, `CheckRangeSigned`,
   `CheckRangeUnsigned`, `CheckLRangeSigned`, `CheckLRangeUnsigned`, `CheckPointer` ×1 each); every plain
   `POUObject` has `SpecialFunc = None` (436/436). `TextListEnumerationObject` **3** (pro) — **what the fold loses,
   measured** (after review: the first walk read this class at depth 1 and its table dropped the `Interface` row): its
   declaration is an `Interface` (`VarDeclObject`; text outside the archive, `LineInfoPersistence` ×3 — the
   declaration Volt reads and spells), beside it a `TextListObject` (`TextListEnumerationTextListObject`) with one
   `TextListRow` per enumerator — **109 rows** (70 / 32 / 7): `TextID` the enumerator name (106 named, `""` on 3),
   `TextDefault` the initializer as written (`16#105`, `Recipe_Management.ReturnValues.ERR_OK`, …; `""` on 71) —
   every initializer `enumRecipeCommandResult` declares (`16#101`…`16#10B`, `Recipe_Management.ReturnValues.ERR_*`)
   appears as a row default (the census aggregates values, so the row-to-enumerator pairing is not checked), `LanguageTexts` empty on 109/109,
   `Languages` empty on 3/3 (no translated text in the corpus), its own `GuidInit` / `GuidReInit` / `GuidExitX`, and
   `RemovedTextListEntries` empty ×3. A plain-DUT create discards the class, that row list and its three GUIDs. `NVLObject` **1** (bak, a
   receiver: `ImportFromFile = true`, `ImportNetVarProperties` UDP list 2, `TaskName LogicTask`). A `GVLObject` with
   **`NetVarProperties`: 1** (bak — the SENDER network variable list: UDP, list id 1, `T#50ms`, cyclic) — a plain
   GVL class carrying NVL facts. `VarPersistentObject` **4** (one per real CODESYS corpus). `AbstractPOUMethodObject`
   **10** (pro — proposal finding 2's re-type case). Parameter list (`GVLObject.ParameterList = true`): **0** (60/60
   false). `TasklocalGVLObject`, `TransitionObject`, `AbstractFunctionblockPropertyAccessorObject`, plain
   `TextListObject`: **0**.
4. **An accessor's GET/SET is an archived member, `IsGet`** (`PropertyAccessorObject` 340: true 270 / false 70;
   `InterfacePropertyAccessorObject` 112: true 96 / false 16). Volt decides it from the object's NAME
   (`CodesysTypeMap.cs:161-162`, proposal finding 8).
5. **Tasks (13; proposal finding 4).** `Kindoftask` Cyclic 12, Freewheeling 1; **0 event and 0 external-event
   tasks** (`Event` / `ExternalEvent` "" on 13/13; every `*Parameters` list empty). **Disabled watchdogs: 3** (bak 1,
   awa 1, CTP 1), and the values behind the flag are real: `Time '3200'` µs (bak, awa), `''` ms (CTP). Watchdog units:
   ms 8, µs 4, "" 1. `Interval.Time` spellings vary (`t#4ms`, `T#4ms`, bare `20` / `3` / `1000` with `Unit 'ms'` — 9
   distinct over 13). Call list: 19 entries, `PouObject.Comment` "" on 19/19 (and `TaskPOUCallObject.Commet` [sic]
   "" on 19/19, `Id` 32769-32773). Constant over 13/13: `TaskGroup 'IEC-Tasks'`, `Core -1`, `Core2 -2`, `AllowEmpty
   false`, `Implicit false`, `WithinSPSTimeSlicing true`, `SynchTask ""`. **The Task Configuration's own archive is
   not a Volt item**: len holds **1 system event** (`alSysEventList`: `PrepareStart` → `POE_systemStart`, active)
   that no text spells; `StackSize 0` / `UseConfigurableStackSize false` on 5/5.
6. **Constant members (one value over every occurrence)** — 1.1 decides each (spell, or refuse the other value):
   `POULevel Standard` (436 + 15), `AddAttributeSubsequent false` (POU 436, GVL 60), `ChildObjectGuids` empty (436),
   library item `Optional false`, `HideWhenReferencedAsDependency false`, `PublishSymbolsInContainer false`,
   `Params null` (264 of 264 items — every item walked).
7. **Editor-cache candidates** (to MEASURE in 1.3, never assumed): `LineInfoPersistence` on every text aspect,
   `meta.Timestamp`, `UniqueIdGenerator` (a per-object id counter), NWL `BranchCounter` / `ValidIds`, the object
   GUID (`meta.Guid` — Volt's identity is the name), `meta.ParentGuid` (structure — the tree spells it).
8. **Library manager** (9 managers; **264 items, every one walked** — 255 placeholder + 9 managed; per manager 41, 13
   ×3, 62, 52, 14, 47, 9): `SystemLibrary` true 142 / false 122 (CODESYS reads it, TwinCAT hard-codes false — proposal
   finding 7), `LinkAllContent true` **5**, `QualifiedOnly true` **1** — neither is in `LibraryManifest` today.
   `ParameterTable` non-empty on 3 managers; `PlaceholderRedirectionTable` 193 entries;
   `Base/MathLibrariesProperty.PlaceholderResolution` 1 each. (The first two runs sampled 105 of the 264 items and
   reported 76 / 29, 2 and 64 — corrected after review.)
9. **Not Volt items, with content**: `Engine.EmbeddedFileObject` 2 (pro — frozen embedded files of 55 KB / 31 KB under
   the project root; a specific interface Volt does not map → warned `GenericContainer`, `CodesysTypeMap.cs:110-124`),
   `TaskConfigObject` 5 (finding 5), `ApplicationObject` 5 (compile defines, boot-app settings, target sizes),
   `PlcLogicObject` 5 (no members).
10. **SFC transitions**: 0 `TransitionObject`; the corpora's only SFC bodies (1 POU + 1 action, the CTP fixture's
    `VltFixtureSfc`) hold their transition EMBEDDED in the SFC element list (`SFCTransition`, `VariableName
    'Init__to__Init'`). The four real corpora hold **no SFC body**: proposal finding 5 has no corpus witness, its
    oracle needs a fixture.
11. **Device** (`DeviceObject` 159; `DeviceProperty` 186 = these 159 + 27 `SlotDeviceObject`; 8 `ExplicitConnector`
    besides): `Disable true` 2 of 159 (bak), `Exclude true` 0 of 159, `RightsManagement '<DeviceRightsManagement />'`
    4 of 159 (null 155).

TwinCAT (Project14 — 13 PLC files in two PLC projects):

12. **Every loaded `.TcPOU` states `SpecialFunc="None"`** (8/8; the attribute the CODESYS `SpecialFunc` member maps to) —
    no TwinCAT special class in the corpus; `tc-special-classes` has no corpus witness.
13. **`<ObjectProperties>` — the TwinCAT carrier of object properties — on 3 objects: an `XmlArchive` holding one
    `SFCProperty` on 1 POU and 1 action (`VltFixtureSfc`, `VltFixtureMembers.SfcRun`, about 100 lines each), EMPTY
    only on 1 task** (`Untitled1/PlcTask.TcTTO`). `SFCProperty` is the class CODESYS archives under
    `meta.Properties[SFCProperty]` on its SFC POU and action (finding 1): **both vendors archive the same property
    class, in their own carrier, with different values for the same-named fixture** (table below the element table).
    So the TwinCAT half of the `%`-line carrier HAS a corpus witness (the SFC property); `.plcproj` `<Compile>`
    entries carry only `<SubType>Code</SubType>` (13/13): `ExcludeFromBuild`, `LinkAlways` and every other per-item
    build property — **0 occurrences**, and no `BuildProperty`-like class in an `<ObjectProperties>` archive. That
    half of findings 1-3 (exclude / link-always / external) is measured by fixtures and probe rows, not by the
    corpus. (The first walk excluded every `XmlArchive` and reported the carrier "empty on 3 objects" — corrected
    after review.)
14. **`<LineIds>`** in 4 loaded POU files (5 `LineIds` elements, 8 `LineId` entries, `Count` up to 210) — the TwinCAT line-info cache candidate
    (finding 7).
15. **Task**: `.TcTTO` holds `CycleTime` (`10000`), `Priority` (`20`), `PouCall/Name`, `TaskFBGuid`, `CycleUpdate`,
    `PostCycleUpdate`, `Fb_init`, `Fb_exit` (GUIDs); the `.tsproj` system task holds `@CycleTime @Priority @Id
    @AmsPort @AdtTasks` and `Name`. Volt reads `CycleTime` + `Priority` of the system task's `TaskDef` and hard-codes
    the rest (`TcTaskSchedule.cs:53-63`, proposal finding 4).
16. The corpus holds **no `.TcIO`** (interface) file: interface / property-accessor rows exist only in the tc-pou
    fixtures (`Itf/Property/Get|Set` with an empty `Declaration` and no `Implementation`).

### CODESYS — source classes, every archived member with its value distribution


**`POUObject.POUObject`** — 436 (CTP 4 / bak 71 / awa 25 / pro 262 / len 74); archive members: POULevel, ChildObjectGuids, AddAttributeSubsequent, SpecialFunc, Implementation, Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `AddAttributeSubsequent` | 436 | false ×436 |
| `ChildObjectGuids` | 436 | Collections.ArrayList ×436 |
| `ChildObjectGuids#count` | 436 | 0 ×436 |
| `Implementation` | 436 | STObject.STImplementationObject ×395, NWLObject.NWLImplementationObject ×38, CFCObject.CFCImplementationObject ×2, SFCObject.SFCImplementationObject ×1 |
| `Implementation.BranchCounter` | 38 | 0 ×16, 2 ×3, 22 ×2, 1 ×2, 4 ×1, … (19 distinct) |
| `Implementation.DefaultViewMode` | 38 | 'Ld' ×34, 'Fbd' ×4 |
| `Implementation.ImplId` | 1 | 9 ×1 |
| `Implementation.ParameterInitializationMethodGenerator` | 2 | null ×2 |
| `Implementation.TextDocument.LineInfoPersistence` | 395 | text(1 lines) ×359, null ×36 |
| `Implementation.ValidIds` | 38 | true ×38 |
| `Interface.TextDocument.LineInfoPersistence` | 436 | text(1 lines) ×365, null ×71 |
| `meta.ParentGuid` | 436 | 6 distinct guids |
| `meta.Properties[]` | 467 | ObjectManager.SVFoldersProperty ×427, LanguageModelManager.BuildProperty ×28, CFCObject.CFCProperty ×9, POUImage.POUImageProperty ×2, SFCObject.SFCProperty ×1 |
| `meta.Properties[BuildProperty].CompilerDefines` | 28 | "" ×28 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 28 | false ×28 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 28 | false ×24, true ×4 |
| `meta.Properties[BuildProperty].External` | 28 | false ×28 |
| `meta.Properties[BuildProperty].LinkAlways` | 28 | false ×28 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 28 | 200 ×15, 0 ×13 |
| `meta.Properties[BuildProperty].Undefines` | 28 | String[] ×28 |
| `meta.Properties[BuildProperty].Undefines#count` | 28 | 0 ×28 |
| `meta.Properties[CFCProperty].UseExplicitExecutionOrder` | 9 | false ×9 |
| `meta.Properties[POUImageProperty].ImageData` | 2 | bytes(448974) ×2 |
| `meta.Properties[POUImageProperty].MakeTransparent` | 2 | false ×2 |
| `meta.Properties[POUImageProperty].TransparencyColor` | 2 | 'White' ×2 |
| `meta.Properties[SFCProperty].CalcActiveTransOnly` | 1 | false ×1 |
| `meta.Properties[SFCProperty].Company` | 1 | 'System' ×1 |
| `meta.Properties[SFCProperty].Flags` | 1 | Utilities.LDictionary<…> ×1 |
| `meta.Properties[SFCProperty].Flags[]` | 15 | SFCObject.SFCPropertyFlagData ×15 |
| `meta.Properties[SFCProperty].Flags[].Declare` | 15 | true ×15 |
| `meta.Properties[SFCProperty].Flags[].Use` | 15 | false ×15 |
| `meta.Properties[SFCProperty].Flags#count` | 1 | 15 ×1 |
| `meta.Properties[SFCProperty].Namespace` | 1 | 'IecSfc' ×1 |
| `meta.Properties[SFCProperty].SFCCurrentSteps` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCErrorAnalyzation` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCErrorAnalyzationTable` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCMetaSteps` | 1 | null ×1 |
| `meta.Properties[SFCProperty].Title` | 1 | 'IecSfc' ×1 |
| `meta.Properties[SFCProperty].UseDefaults` | 1 | true ×1 |
| `meta.Properties[SFCProperty].Version` | 1 | '4.4.0.0' ×1 |
| `meta.Properties#count` | 436 | 1 ×391, 2 ×38, 0 ×7 |
| `meta.Timestamp` | 436 | 409 distinct |
| `meta.TypeGuid` | 436 | guid ×436 |
| `POULevel` | 436 | Standard ×436 |
| `SpecialFunc` | 436 | None ×436 |
| `UniqueIdGenerator` | 436 | 304 distinct |

**`POUObject.POUObjectCheckFunction`** — 15 (CTP 0 / bak 5 / awa 0 / pro 10 / len 0); archive members: SpecialFunc, POULevel, ChildObjectGuids, AddAttributeSubsequent, Implementation, Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Implementation` | 15 | STObject.STImplementationObject ×15 |
| `Implementation.TextDocument.LineInfoPersistence` | 15 | text(1 lines) ×15 |
| `Interface.TextDocument.LineInfoPersistence` | 15 | text(1 lines) ×15 |
| `meta.ParentGuid` | 15 | guid ×10, guid ×5 |
| `meta.Properties[]` | 16 | ObjectManager.SVFoldersProperty ×15, LanguageModelManager.BuildProperty ×1 |
| `meta.Properties[BuildProperty].CompilerDefines` | 1 | "" ×1 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 1 | false ×1 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 1 | true ×1 |
| `meta.Properties[BuildProperty].External` | 1 | false ×1 |
| `meta.Properties[BuildProperty].LinkAlways` | 1 | false ×1 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 1 | 0 ×1 |
| `meta.Properties[BuildProperty].Undefines` | 1 | String[] ×1 |
| `meta.Properties[BuildProperty].Undefines#count` | 1 | 0 ×1 |
| `meta.Properties#count` | 15 | 1 ×14, 2 ×1 |
| `meta.Timestamp` | 15 | 15 distinct |
| `meta.TypeGuid` | 15 | guid ×15 |
| `SpecialFunc` | 15 | CheckDivInt64 ×2, CheckDivReal32 ×2, CheckDivReal64 ×2, CheckDivInt32 ×2, CheckBounds ×2, … (10 distinct) |

**`MethodObject.POUMethodObject`** — 1288 (CTP 2 / bak 0 / awa 3 / pro 1264 / len 19); archive members: Implementation, Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Implementation` | 1288 | STObject.STImplementationObject ×1285, NWLObject.NWLImplementationObject ×2, CFCObject.CFCImplementationObject ×1 |
| `Implementation.BranchCounter` | 2 | 0 ×2 |
| `Implementation.DefaultViewMode` | 2 | 'Fbd' ×2 |
| `Implementation.ParameterInitializationMethodGenerator` | 1 | null ×1 |
| `Implementation.TextDocument.LineInfoPersistence` | 1285 | text(1 lines) ×1269, null ×16 |
| `Implementation.ValidIds` | 2 | true ×2 |
| `Interface.TextDocument.LineInfoPersistence` | 1288 | text(1 lines) ×1272, null ×16 |
| `meta.ParentGuid` | 1288 | 185 distinct |
| `meta.Properties[]` | 645 | ObjectManager.SVFoldersProperty ×636, LanguageModelManager.BuildProperty ×8, CFCObject.CFCProperty ×1 |
| `meta.Properties[BuildProperty].CompilerDefines` | 8 | "" ×8 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 8 | false ×8 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 8 | true ×7, false ×1 |
| `meta.Properties[BuildProperty].External` | 8 | false ×8 |
| `meta.Properties[BuildProperty].LinkAlways` | 8 | false ×8 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 8 | 0 ×8 |
| `meta.Properties[BuildProperty].Undefines` | 8 | String[] ×8 |
| `meta.Properties[BuildProperty].Undefines#count` | 8 | 0 ×8 |
| `meta.Properties[CFCProperty].UseExplicitExecutionOrder` | 1 | false ×1 |
| `meta.Properties#count` | 1288 | 0 ×645, 1 ×641, 2 ×2 |
| `meta.Timestamp` | 1288 | 1277 distinct |
| `meta.TypeGuid` | 1288 | guid ×1288 |

**`MethodObject.AbstractPOUMethodObject`** — 10 (CTP 0 / bak 0 / awa 0 / pro 10 / len 0); archive members: Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 10 | text(1 lines) ×10 |
| `meta.ParentGuid` | 10 | 7 distinct |
| `meta.Properties[]` | 2 | ObjectManager.SVFoldersProperty ×2 |
| `meta.Properties#count` | 10 | 0 ×8, 1 ×2 |
| `meta.Timestamp` | 10 | 10 distinct |
| `meta.TypeGuid` | 10 | guid ×10 |

**`MethodObject.InterfaceMethodObject`** — 182 (CTP 0 / bak 0 / awa 0 / pro 182 / len 0); archive members: Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 182 | text(1 lines) ×182 |
| `meta.ParentGuid` | 182 | 66 distinct |
| `meta.Properties[]` | 5 | ObjectManager.SVFoldersProperty ×5 |
| `meta.Properties#count` | 182 | 0 ×177, 1 ×5 |
| `meta.Timestamp` | 182 | 179 distinct |
| `meta.TypeGuid` | 182 | guid ×182 |

**`PropertyObject.PropertyObject`** — 373 (CTP 0 / bak 0 / awa 0 / pro 368 / len 5); archive members: Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 373 | text(1 lines) ×368, null ×5 |
| `meta.ParentGuid` | 373 | 143 distinct |
| `meta.Properties[]` | 173 | ObjectManager.SVFoldersProperty ×172, LanguageModelManager.BuildProperty ×1 |
| `meta.Properties[BuildProperty].CompilerDefines` | 1 | "" ×1 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 1 | false ×1 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 1 | false ×1 |
| `meta.Properties[BuildProperty].External` | 1 | false ×1 |
| `meta.Properties[BuildProperty].LinkAlways` | 1 | false ×1 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 1 | 0 ×1 |
| `meta.Properties[BuildProperty].Undefines` | 1 | String[] ×1 |
| `meta.Properties[BuildProperty].Undefines#count` | 1 | 0 ×1 |
| `meta.Properties#count` | 373 | 0 ×201, 1 ×171, 2 ×1 |
| `meta.Timestamp` | 373 | 373 distinct |
| `meta.TypeGuid` | 373 | guid ×373 |
| `UniqueIdGenerator` | 373 | 14 distinct |

**`PropertyObject.PropertyAccessorObject`** — 340 (CTP 0 / bak 0 / awa 0 / pro 330 / len 10); archive members: Implementation, Interface, IsGet, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Implementation` | 340 | STObject.STImplementationObject ×340 |
| `Implementation.TextDocument.LineInfoPersistence` | 340 | text(1 lines) ×330, null ×10 |
| `Interface.TextDocument.LineInfoPersistence` | 340 | text(1 lines) ×330, null ×10 |
| `IsGet` | 340 | true ×270, false ×70 |
| `meta.ParentGuid` | 340 | 276 distinct |
| `meta.Properties#count` | 340 | 0 ×340 |
| `meta.Timestamp` | 340 | 332 distinct |
| `meta.TypeGuid` | 340 | guid ×340 |

**`PropertyObject.InterfacePropertyAccessorObject`** — 112 (CTP 0 / bak 0 / awa 0 / pro 112 / len 0); archive members: Interface, IsGet, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 112 | text(1 lines) ×112 |
| `IsGet` | 112 | true ×96, false ×16 |
| `meta.ParentGuid` | 112 | 97 distinct |
| `meta.Properties#count` | 112 | 0 ×112 |
| `meta.Timestamp` | 112 | 112 distinct |
| `meta.TypeGuid` | 112 | guid ×112 |

**`ActionObject.ActionObject`** — 47 (CTP 1 / bak 0 / awa 19 / pro 7 / len 20); archive members: Implementation, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Implementation` | 47 | STObject.STImplementationObject ×42, NWLObject.NWLImplementationObject ×4, SFCObject.SFCImplementationObject ×1 |
| `Implementation.BranchCounter` | 4 | 0 ×4 |
| `Implementation.DefaultViewMode` | 4 | 'Fbd' ×4 |
| `Implementation.ImplId` | 1 | 1 ×1 |
| `Implementation.TextDocument.LineInfoPersistence` | 42 | text(1 lines) ×26, null ×16 |
| `Implementation.ValidIds` | 4 | true ×4 |
| `meta.ParentGuid` | 47 | 10 distinct |
| `meta.Properties[]` | 1 | SFCObject.SFCProperty ×1 |
| `meta.Properties[SFCProperty].CalcActiveTransOnly` | 1 | false ×1 |
| `meta.Properties[SFCProperty].Company` | 1 | 'System' ×1 |
| `meta.Properties[SFCProperty].Flags` | 1 | Utilities.LDictionary<…> ×1 |
| `meta.Properties[SFCProperty].Flags[]` | 15 | SFCObject.SFCPropertyFlagData ×15 |
| `meta.Properties[SFCProperty].Flags[].Declare` | 15 | true ×15 |
| `meta.Properties[SFCProperty].Flags[].Use` | 15 | false ×15 |
| `meta.Properties[SFCProperty].Flags#count` | 1 | 15 ×1 |
| `meta.Properties[SFCProperty].Namespace` | 1 | 'IecSfc' ×1 |
| `meta.Properties[SFCProperty].SFCCurrentSteps` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCErrorAnalyzation` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCErrorAnalyzationTable` | 1 | null ×1 |
| `meta.Properties[SFCProperty].SFCMetaSteps` | 1 | null ×1 |
| `meta.Properties[SFCProperty].Title` | 1 | 'IecSfc' ×1 |
| `meta.Properties[SFCProperty].UseDefaults` | 1 | true ×1 |
| `meta.Properties[SFCProperty].Version` | 1 | '4.4.0.0' ×1 |
| `meta.Properties#count` | 47 | 0 ×46, 1 ×1 |
| `meta.Timestamp` | 47 | 46 distinct |
| `meta.TypeGuid` | 47 | guid ×47 |
| `UniqueIdGenerator` | 47 | 32 distinct |

**`DUTObject.DUTObject`** — 287 (CTP 0 / bak 44 / awa 18 / pro 151 / len 74); archive members: Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 287 | text(1 lines) ×213, null ×74 |
| `meta.ParentGuid` | 287 | 4 distinct guids |
| `meta.Properties[]` | 289 | ObjectManager.SVFoldersProperty ×287, LanguageModelManager.BuildProperty ×2 |
| `meta.Properties[BuildProperty].CompilerDefines` | 2 | "" ×2 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 2 | false ×2 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 2 | false ×2 |
| `meta.Properties[BuildProperty].External` | 2 | false ×2 |
| `meta.Properties[BuildProperty].LinkAlways` | 2 | false ×2 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 2 | 0 ×2 |
| `meta.Properties[BuildProperty].Undefines` | 2 | String[] ×2 |
| `meta.Properties[BuildProperty].Undefines#count` | 2 | 0 ×2 |
| `meta.Properties#count` | 287 | 1 ×285, 2 ×2 |
| `meta.Timestamp` | 287 | 286 distinct |
| `meta.TypeGuid` | 287 | guid ×287 |
| `UniqueIdGenerator` | 287 | 119 distinct |

**`TextList.TextListEnumerationObject`** — 3 (CTP 0 / bak 0 / awa 0 / pro 3 / len 0); archive members: RemovedTextListEntries, TextListObject, Interface

| member | n | values |
|---|---|---|
| `Interface` | 3 | VarDeclObject.VarDeclObject ×3 |
| `Interface.TextDocument.LineInfoPersistence` | 3 | text(1 lines) ×3 |
| `Interface.TextDocument.TextBlobForSerialisation` | 3 | null ×3 |
| `meta.ParentGuid` | 3 | guid ×3 |
| `meta.Properties[]` | 3 | ObjectManager.SVFoldersProperty ×3 |
| `meta.Properties#count` | 3 | 1 ×3 |
| `meta.Timestamp` | 3 | 638977615368256697 ×1, 639005237732987399 ×1, 638977615369164435 ×1 |
| `meta.TypeGuid` | 3 | guid ×3 |
| `RemovedTextListEntries` | 3 | Collections.ArrayList ×3 |
| `RemovedTextListEntries#count` | 3 | 0 ×3 |
| `TextListObject` | 3 | TextList.TextListEnumerationTextListObject ×3 |
| `TextListObject.GuidExitX` | 3 | guid ×1, guid ×1, guid ×1 |
| `TextListObject.GuidInit` | 3 | guid ×1, guid ×1, guid ×1 |
| `TextListObject.GuidReInit` | 3 | guid ×1, guid ×1, guid ×1 |
| `TextListObject.Languages` | 3 | Collections.ArrayList ×3 |
| `TextListObject.Languages#count` | 3 | 0 ×3 |
| `TextListObject.TextList` | 3 | Collections.ArrayList ×3 |
| `TextListObject.TextList[]` | 109 | TextList.TextListRow ×109 |
| `TextListObject.TextList[].LanguageTexts` | 109 | Collections.ArrayList ×109 |
| `TextListObject.TextList[].LanguageTexts#count` | 109 | 0 ×109 |
| `TextListObject.TextList[].TextDefault` | 109 | "" ×71, text(1 lines) ×15, '0' ×2, 'Recipe_Management.ReturnValues.ERR_PARAMETER' ×1, '3' ×1, … (24 distinct) |
| `TextListObject.TextList[].TextID` | 109 | "" ×3, 'SelectADefinition' ×1, 'RecipeSaved' ×1, 'DQ_44' ×1, 'NoObject' ×1, … (107 distinct) |
| `TextListObject.TextList#count` | 3 | 70 ×1, 32 ×1, 7 ×1 |

**`InterfaceObject.InterfaceObject`** — 97 (CTP 0 / bak 0 / awa 0 / pro 97 / len 0); archive members: Interface, UniqueIdGenerator

| member | n | values |
|---|---|---|
| `Interface.TextDocument.LineInfoPersistence` | 97 | text(1 lines) ×97 |
| `meta.ParentGuid` | 97 | guid ×97 |
| `meta.Properties[]` | 97 | ObjectManager.SVFoldersProperty ×97 |
| `meta.Properties#count` | 97 | 1 ×97 |
| `meta.Timestamp` | 97 | 64 distinct |
| `meta.TypeGuid` | 97 | guid ×97 |
| `UniqueIdGenerator` | 97 | 9 distinct |

**`GVLObject.GVLObject`** — 60 (CTP 0 / bak 8 / awa 10 / pro 11 / len 31); archive members: ParameterList, AddAttributeSubsequent, Interface, NetVarProperties

| member | n | values |
|---|---|---|
| `AddAttributeSubsequent` | 60 | false ×60 |
| `Interface.TextDocument.LineInfoPersistence` | 60 | text(1 lines) ×35, null ×25 |
| `meta.ParentGuid` | 60 | 5 distinct guids |
| `meta.Properties[]` | 59 | ObjectManager.SVFoldersProperty ×55, LanguageModelManager.BuildProperty ×3, GVLObject.FileLink ×1 |
| `meta.Properties[BuildProperty].CompilerDefines` | 3 | "" ×3 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 3 | false ×3 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 3 | false ×3 |
| `meta.Properties[BuildProperty].External` | 3 | false ×3 |
| `meta.Properties[BuildProperty].LinkAlways` | 3 | true ×3 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 3 | 0 ×3 |
| `meta.Properties[BuildProperty].Undefines` | 3 | String[] ×3 |
| `meta.Properties[BuildProperty].Undefines#count` | 3 | 0 ×3 |
| `meta.Properties[FileLink].FileName` | 1 | text(1 lines) ×1 |
| `meta.Properties[FileLink].LinkType` | 1 | ExportBeforeCompile ×1 |
| `meta.Properties[FileLink].lTimeStamp` | 1 | 638330460383179684 ×1 |
| `meta.Properties#count` | 60 | 1 ×57, 0 ×2, 2 ×1 |
| `meta.Timestamp` | 60 | 60 distinct |
| `meta.TypeGuid` | 60 | guid ×60 |
| `NetVarProperties` | 60 | null ×59, GVLObject.NetVarProperties ×1 |
| `NetVarProperties.Acknowledge` | 1 | false ×1 |
| `NetVarProperties.Checksum` | 1 | false ×1 |
| `NetVarProperties.EventVariable` | 1 | "" ×1 |
| `NetVarProperties.GuidTaskEndSlot` | 1 | guid ×1 |
| `NetVarProperties.GuidTaskStartSlot` | 1 | guid ×1 |
| `NetVarProperties.ImportFileName` | 1 | "" ×1 |
| `NetVarProperties.Interval` | 1 | 'T#50ms' ×1 |
| `NetVarProperties.ListIdentifier` | 1 | '1' ×1 |
| `NetVarProperties.MinimumGap` | 1 | 'T#20ms' ×1 |
| `NetVarProperties.PackVariables` | 1 | true ×1 |
| `NetVarProperties.ProtocolName` | 1 | 'UDP' ×1 |
| `NetVarProperties.ProtocolParameterValues` | 1 | Collections.Hashtable ×1 |
| `NetVarProperties.ProtocolParameterValues[]` | 1 | Collections.Hashtable ×1 |
| `NetVarProperties.ProtocolParameterValues#count` | 1 | 1 ×1 |
| `NetVarProperties.TaskName` | 1 | 'LogicTask' ×1 |
| `NetVarProperties.TransmitCyclic` | 1 | true ×1 |
| `NetVarProperties.TransmitOnChange` | 1 | false ×1 |
| `NetVarProperties.TransmitOnEvent` | 1 | false ×1 |
| `ParameterList` | 60 | false ×60 |

**`GVLObject.VarPersistentObject`** — 4 (CTP 0 / bak 1 / awa 1 / pro 1 / len 1); archive members: guidinit, guidcyclic, dymmattributecount, persvarlist, Interface, NetVarProperties

| member | n | values |
|---|---|---|
| `dymmattributecount` | 4 | 33 ×1, 6 ×1, 100 ×1, 14 ×1 |
| `guidcyclic` | 4 | 4 distinct guids |
| `guidinit` | 4 | 4 distinct guids |
| `Interface.TextDocument.LineInfoPersistence` | 4 | text(1 lines) ×4 |
| `meta.ParentGuid` | 4 | 4 distinct guids |
| `meta.Properties[]` | 4 | ObjectManager.SVFoldersProperty ×4 |
| `meta.Properties#count` | 4 | 1 ×4 |
| `meta.Timestamp` | 4 | 639186831374017505 ×1, 638326408032632759 ×1, 639034856362203117 ×1, 639083249925428692 ×1 |
| `meta.TypeGuid` | 4 | guid ×4 |
| `NetVarProperties` | 4 | null ×4 |
| `persvarlist` | 4 | null ×4 |

**`NVLObject.NVLObject`** — 1 (CTP 0 / bak 1 / awa 0 / pro 0 / len 0); archive members: ReferenceGuidGVL, SenderGVLName, TaskName, GuidTaskSlot, ImportFileName, ImportFileTimestamp, ImportNetVarProperties, ImportFromFile, Interface

| member | n | values |
|---|---|---|
| `GuidTaskSlot` | 1 | guid ×1 |
| `ImportFileName` | 1 | text(1 lines) ×1 |
| `ImportFileTimestamp` | 1 | 638331574133873745 ×1 |
| `ImportFromFile` | 1 | true ×1 |
| `ImportNetVarProperties` | 1 | GVLObject.NetVarProperties ×1 |
| `ImportNetVarProperties.Acknowledge` | 1 | false ×1 |
| `ImportNetVarProperties.Checksum` | 1 | false ×1 |
| `ImportNetVarProperties.EventVariable` | 1 | "" ×1 |
| `ImportNetVarProperties.GuidTaskEndSlot` | 1 | guid ×1 |
| `ImportNetVarProperties.GuidTaskStartSlot` | 1 | guid ×1 |
| `ImportNetVarProperties.ImportFileName` | 1 | "" ×1 |
| `ImportNetVarProperties.Interval` | 1 | 'T#50ms' ×1 |
| `ImportNetVarProperties.ListIdentifier` | 1 | '2' ×1 |
| `ImportNetVarProperties.MinimumGap` | 1 | 'T#20ms' ×1 |
| `ImportNetVarProperties.PackVariables` | 1 | true ×1 |
| `ImportNetVarProperties.ProtocolName` | 1 | 'UDP' ×1 |
| `ImportNetVarProperties.ProtocolParameterValues` | 1 | Collections.Hashtable ×1 |
| `ImportNetVarProperties.ProtocolParameterValues[]` | 1 | Collections.Hashtable ×1 |
| `ImportNetVarProperties.ProtocolParameterValues#count` | 1 | 1 ×1 |
| `ImportNetVarProperties.TaskName` | 1 | 'LogicTask' ×1 |
| `ImportNetVarProperties.TransmitCyclic` | 1 | true ×1 |
| `ImportNetVarProperties.TransmitOnChange` | 1 | false ×1 |
| `ImportNetVarProperties.TransmitOnEvent` | 1 | false ×1 |
| `Interface.TextDocument.LineInfoPersistence` | 1 | text(1 lines) ×1 |
| `meta.ParentGuid` | 1 | guid ×1 |
| `meta.Properties[]` | 1 | ObjectManager.SVFoldersProperty ×1 |
| `meta.Properties#count` | 1 | 1 ×1 |
| `meta.Timestamp` | 1 | 638332104691799656 ×1 |
| `meta.TypeGuid` | 1 | guid ×1 |
| `ReferenceGuidGVL` | 1 | empty ×1 |
| `SenderGVLName` | 1 | "" ×1 |
| `TaskName` | 1 | 'LogicTask' ×1 |

**`TaskObject.TaskObject`** — 13 (CTP 1 / bak 3 / awa 1 / pro 6 / len 2); archive members: Kindoftask, CustomParameters, IntervalParameters, EventParameters, ExternalEventParameters, FreewheelingParameters, Priority, Watchdog, Interval, Event, ExternalEvent, TaskGuid, EventPOUGuid, PouList, Implicit, WithinSPSTimeSlicing, Core, Core2, TaskGroup, SynchTask, AllowEmpty

| member | n | values |
|---|---|---|
| `AllowEmpty` | 13 | false ×13 |
| `Core` | 13 | -1 ×13 |
| `Core2` | 13 | -2 ×13 |
| `CustomParameters` | 13 | TaskObject.ParamInstanceList ×13 |
| `CustomParameters#count` | 13 | 0 ×13 |
| `Event` | 13 | "" ×13 |
| `EventParameters` | 13 | TaskObject.ParamInstanceList ×13 |
| `EventParameters#count` | 13 | 0 ×13 |
| `EventPOUGuid` | 13 | 13 distinct |
| `ExternalEvent` | 13 | "" ×13 |
| `ExternalEventParameters` | 13 | TaskObject.ParamInstanceList ×13 |
| `ExternalEventParameters#count` | 13 | 0 ×13 |
| `FreewheelingParameters` | 13 | TaskObject.ParamInstanceList ×13 |
| `FreewheelingParameters#count` | 13 | 0 ×13 |
| `Implicit` | 13 | false ×13 |
| `Interval` | 13 | TaskObject.IECTime ×13 |
| `Interval.Time` | 13 | 't#4ms' ×3, '20' ×2, '3' ×2, 'T#4ms' ×1, 'T#15ms' ×1, … (9 distinct) |
| `Interval.Unit` | 13 | 'ms' ×13 |
| `IntervalParameters` | 13 | TaskObject.ParamInstanceList ×13 |
| `IntervalParameters#count` | 13 | 0 ×13 |
| `Kindoftask` | 13 | Cyclic ×12, Freewheeling ×1 |
| `meta.ParentGuid` | 13 | 5 distinct guids |
| `meta.Properties#count` | 13 | 0 ×13 |
| `meta.Timestamp` | 13 | 13 distinct |
| `meta.TypeGuid` | 13 | guid ×13 |
| `PouList` | 13 | TaskObject.PouObjectList ×13 |
| `PouList[]` | 19 | TaskObject.PouObject ×19 |
| `PouList[].Comment` | 19 | "" ×19 |
| `PouList[].Name` | 19 | 19 distinct |
| `PouList#count` | 13 | 1 ×11, 3 ×1, 5 ×1 |
| `Priority` | 13 | '1' ×5, '13' ×1, '14' ×1, '6' ×1, '4' ×1, … (9 distinct) |
| `SynchTask` | 13 | "" ×13 |
| `TaskGroup` | 13 | 'IEC-Tasks' ×13 |
| `TaskGuid` | 13 | 12 distinct |
| `Watchdog` | 13 | TaskObject.Watchdog ×13 |
| `Watchdog.Enabled` | 13 | true ×10, false ×3 |
| `Watchdog.Sensitivity` | 13 | '1' ×11, '2' ×2 |
| `Watchdog.Time` | 13 | TaskObject.IECTime ×13 |
| `Watchdog.Time.Time` | 13 | '3200' ×3, 'T#4ms' ×1, 'T#15ms' ×1, '10' ×1, '6' ×1, … (11 distinct) |
| `Watchdog.Time.Unit` | 13 | 'ms' ×8, u'\xb5s' ×4, "" ×1 |
| `WithinSPSTimeSlicing` | 13 | true ×13 |

**`TaskObject.TaskPOUCallObject`** — 19 (CTP 1 / bak 3 / awa 3 / pro 6 / len 6); archive members: Commet, Id

| member | n | values |
|---|---|---|
| `Commet` | 19 | "" ×19 |
| `Id` | 19 | 32769 ×13, 32770 ×2, 32771 ×2, 32772 ×1, 32773 ×1 |
| `meta.ParentGuid` | 19 | 12 distinct |
| `meta.Properties#count` | 19 | 0 ×19 |
| `meta.Timestamp` | 19 | 16 distinct |
| `meta.TypeGuid` | 19 | guid ×19 |

**`DefaultNavigators.FolderObject`** — 464 (CTP 0 / bak 29 / awa 11 / pro 363 / len 61); archive members: StructuredViewGuid

| member | n | values |
|---|---|---|
| `meta.ParentGuid` | 464 | empty ×464 |
| `meta.Properties[]` | 469 | ObjectManager.SVFoldersProperty ×464, LanguageModelManager.BuildProperty ×5 |
| `meta.Properties[BuildProperty].CompilerDefines` | 5 | "" ×5 |
| `meta.Properties[BuildProperty].EnableSystemCall` | 5 | false ×5 |
| `meta.Properties[BuildProperty].ExcludeFromBuild` | 5 | true ×4, false ×1 |
| `meta.Properties[BuildProperty].External` | 5 | false ×5 |
| `meta.Properties[BuildProperty].LinkAlways` | 5 | false ×5 |
| `meta.Properties[BuildProperty].MemoryReserveForOnlineChange` | 5 | 0 ×5 |
| `meta.Properties[BuildProperty].Undefines` | 5 | String[] ×5 |
| `meta.Properties[BuildProperty].Undefines#count` | 5 | 0 ×5 |
| `meta.Properties#count` | 464 | 1 ×459, 2 ×5 |
| `meta.Timestamp` | 464 | 464 distinct |
| `meta.TypeGuid` | 464 | guid ×464 |
| `StructuredViewGuid` | 464 | guid ×464 |

**`LibManObject.LibManObject`** — 9 (CTP 1 / bak 2 / awa 2 / pro 2 / len 2); archive members: Items, PlaceholderRedirectionTable, ParameterTable

| member | n | values |
|---|---|---|
| `Items` | 9 | Utilities.LList<…> ×9 |
| `Items[]` | 264 | LibManObject.PlaceholderLibManItem ×255, LibManObject.ManagedLibManItem ×9 |
| `Items[].DefaultResolution` | 255 | text(1 lines) ×29, 'VisuElemCamDisplayer, 4.7.0.0 (System)' ×8, 'VisuElemTextEditor, 4.8.0.0 (System)' ×8, 'VisuElem3DPath, 4.7.0.0 (System)' ×8, 'VisuElemTrace, 4.8.0.0 (System)' ×8, … (83 distinct) |
| `Items[].HideWhenReferencedAsDependency` | 264 | false ×264 |
| `Items[].Id` | 264 | 264 distinct |
| `Items[].LinkAllContent` | 264 | false ×259, true ×5 |
| `Items[].Name` | 9 | 8 distinct |
| `Items[].Namespace` | 264 | 'VisuInputs' ×8, 'VisuElemsWinControls' ×8, 'VisuElemXYChart' ×8, 'VisuElemCamDisplayer' ×8, 'VisuElemsSpecialControls' ×8, … (76 distinct) |
| `Items[].Optional` | 264 | false ×264 |
| `Items[].Params` | 264 | null ×264 |
| `Items[].PlaceholderName` | 255 | 67 distinct |
| `Items[].PublishSymbolsInContainer` | 264 | false ×264 |
| `Items[].QualifiedOnly` | 264 | false ×263, true ×1 |
| `Items[].ResolverGuid` | 255 | guid ×146, guid ×104, guid ×5 |
| `Items[].SystemLibrary` | 264 | true ×142, false ×122 |
| `Items#count` | 9 | 13 ×3, 41 ×1, 62 ×1, 52 ×1, 14 ×1, … (7 distinct) |
| `meta.ParentGuid` | 9 | 6 distinct guids |
| `meta.Properties[]` | 3 | BaseLibraries.BaseLibrariesProperty ×1, ObjectManager.SVFoldersProperty ×1, MathLibraries.MathLibrariesProperty ×1 |
| `meta.Properties[BaseLibrariesProperty].PlaceholderResolution` | 1 | Collections.Generic.Dictionary<…> ×1 |
| `meta.Properties[BaseLibrariesProperty].PlaceholderResolution[]` | 2 | 'Common Behaviour Model, 4.0.0.0 (CODESYS)' ×1, 'Element Collections, 4.0.0.0 (CODESYS)' ×1 |
| `meta.Properties[BaseLibrariesProperty].PlaceholderResolution#count` | 1 | 2 ×1 |
| `meta.Properties[MathLibrariesProperty].PlaceholderResolution` | 1 | Collections.Generic.Dictionary<…> ×1 |
| `meta.Properties[MathLibrariesProperty].PlaceholderResolution[]` | 1 | 'FloatingPointUtils, 4.0.0.0 (System)' ×1 |
| `meta.Properties[MathLibrariesProperty].PlaceholderResolution#count` | 1 | 1 ×1 |
| `meta.Properties#count` | 9 | 0 ×6, 1 ×3 |
| `meta.Timestamp` | 9 | 9 distinct |
| `meta.TypeGuid` | 9 | guid ×9 |
| `ParameterTable` | 9 | Collections.Generic.List<…> ×9 |
| `ParameterTable[]` | 8 | LibManObject.ParameterTable ×8 |
| `ParameterTable[].Name` | 8 | '#Util' ×3, '#CAA NetBaseSrv' ×1, '#Analyzation' ×1, '#BrinkEdgePcLogging' ×1, 'L_OEEA_Library, 3.26.4.21 (Lenze)' ×1, … (6 distinct) |
| `ParameterTable[].Values` | 8 | Collections.Generic.List<…> ×8 |
| `ParameterTable[].Values[]` | 24 | LibManObject.ParameterValue ×24 |
| `ParameterTable[].Values#count` | 8 | 1 ×4, 3 ×1, 9 ×1, 6 ×1, 2 ×1 |
| `ParameterTable#count` | 9 | 0 ×6, 2 ×2, 4 ×1 |
| `PlaceholderRedirectionTable` | 9 | Utilities.LDictionary<…> ×9 |
| `PlaceholderRedirectionTable[]` | 193 | text(1 lines) ×25, 'VisuElems, 4.8.1.0 (System)' ×5, 'Standard, 3.5.18.0 (System)' ×5, 'VisuElemCamDisplayer, 4.7.0.0 (System)' ×4, 'VisuElemTextEditor, 4.8.0.0 (System)' ×4, … (75 distinct) |
| `PlaceholderRedirectionTable#count` | 9 | 0 ×2, 40 ×1, 3 ×1, 44 ×1, 43 ×1, … (8 distinct) |

**Other classes seen (opaque to Volt's text today — stub manifest or descriptor)**, archive members (top level):

| class | n (CTP/bak/awa/pro/len) | archive members (SerializableValueNames) |
|---|---|---|
| `ApplicationObject.ApplicationObject` | 5 (1/1/1/1/1) | FirmCode, AllowUserDefinedStaticSize, TargetInputSize, TargetOutputSize, X509EncryptionThumbprints, OverrideTargetMemorySizes, DynamicMemory, KeepOnParentOnlineChange, X509EncryptionThumbprint, DownloadContent, BootAppSettings, SignDownloadWithX509Certificate, X509CommonName, ProductCode, GuidNetVarGVL, TargetMemoryize, GuidMemSettings, StopParentAppsOnException, StaticSize |
| `DeviceObject.DeviceObject` | 159 (1/24/9/93/32) | fixedOutputAddress, TypeList, IoConfigVarConfigGuid, UniqueIdGenerator, Id, HostObjectGuid, InteractiveLoginMode, fixedInputAddress, UserManagement, OnlineHelpUrl, Attributes, IoConfigGlobalsMappingGuid, Connectors, IoConfigGlobalsGuid, SupportedLogicalBusSystems, LogicalDeviceList, CustomItems, CommunicationSettings, CreateBitChannels, DownloadParamsDevDescOrder, IoProviderBase, ModuleId, UseDeviceApplicationStructure, RedirectedPlaceholderResolution, GuidBusCycleTask, DefaultDeviceInfo, showParamsInDevDescOrder, RightsManagement, Disable, Exclude, DeviceParameterSet, PlaceholderResolution, DriverInfo, LogicalLanguageModelPositionId, NeedsBusCycle, MappingPossible, IoConfigErrorPouGuid, AllowSymbolicVarAccessInSyncWithIecCycle, ConnectorList, AdditionalStringTable, FunctionalChildren, HidePropertiesDialog, IoUpdateTask |
| `DeviceObject.ExplicitConnector` | 8 (0/2/2/2/2) | ModuleType, Hostpath, AdditionalInterfaces, Client, fixedInputAddress, BusCycleTaskGuid, ModuleId, InitialStatusFlag, MaxOutputSize, AllowedPages, VisibleInterfaceName, AlwaysMappingMode, Constraints, DownloadParamsDevDescOrder, HostParameterSet, MaxInOutputSize, Role, fixedOutputAddress, AlwaysMapping, CustomItems, ClientTypeGuid, ConnectorGroup, Interface, ClientConnectorId, DriverInfo, IoUpdateTask, updateAllowed, AllowOnlyDevices, ClientConnectorInterface, AlwaysMappingDisabled, UseBlobInitConst, hideInStatusPage, ConnectorId, Adapters, MaxInputSize |
| `DeviceObject.SlotDeviceObject` | 27 (0/4/0/13/10) | AllowEmpty, showParamsInDevDescOrder, Device, ConnectorList, IsPlaceholderObject |
| `Engine.EmbeddedFileObject` | 2 (0/0/0/2/0) | Frozen, Data, LastModification, AutoUpdateMode |
| `Engine.WorkspaceObject` | 5 (1/1/1/1/1) | OptionData |
| `ImagePool.HiddenTransientImagePoolObject` | 9 (1/2/2/2/2) | BitmapPool, GuidInit, UniqueIdGenerator, ValidIds, GuidReInit, GuidExitX |
| `ImagePool.ImagePoolObject` | 1 (0/0/0/1/0) | BitmapPool, UniqueIdGenerator, GuidReInit, GuidInit, GuidExitX, ValidIds |
| `PlcLogicObject.PlcLogicObject` | 5 (1/1/1/1/1) |  |
| `ProjectInfoObject.ProjectInfoObject` | 1 (0/0/0/1/0) | GetTextProperty2GUID, Properties, IsLibReleasedGUID, GetNumberPropertyGUID, GetCompanyGUID, GetVersionGUID, GetVersionPropertyGUID, GetBooleanPropertyGUID, GetLibVersionNumberGUID, GetLibVersionGUID, GetTextPropertyGUID, GetTitleGUID |
| `RecipeManObject.RecipeDefinitionObject` | 11 (0/3/2/3/3) | UniqueIdGenerator, LMGuids, Recipes, RecipeVariables |
| `RecipeManObject.RecipeManObject` | 4 (0/1/1/1/1) | RecipesInPlcAssigned, LMGuids, StorageSettings, RecipesInPlc |
| `SymbolConfigObject.SymbolConfigObject` | 4 (0/1/1/1/1) | PreoareOnlineChangePouGuid, SymbolAttributeFilterData, ClientSideLayoutCalculator, LibraryIds, ContentFeatureFlagsPartial, SelectionTypeSigns, SelectionTypeSignaturesConfig, SymbolAttributeFilterType, ChangePouGuid, GVLGuid, SelectionSignaturesConfig, SupportOPCUA, SymbolCommentFilterType, EnableDirectIoAccess, SymbolSetNames, POUGuid, UseEmptyNamespaceByDefault, SelectionSigns, ExportSymbolComments |
| `TaskConfigObject.TaskConfigObject` | 5 (1/1/1/1/1) | device_app, alTaskGroups, sysevents_functionsblock_guid, parent_tasks, task_struct_guid, profiler_iectaskgetprofiling_guid, enum_guid, StackSize, alSysEventList, profiler_cycle_code_guid, profiler_init_code_guid, ExternalEventList, profiler_fb_guid, sysevents_resetget_property_guid, sysevents_fbexit_method_guid, sys_setup_pou_guid, profiler_method_reset_guid, jitter_distribution_guid, SystemEventList, profiler_method_starttiming_guid, sysevents_global_vars_guid, task_global_vars_guid, profiler_global_vars_guid, task_config_info_guid, sysevents_eventcallback_method_guid, UseConfigurableStackSize, sysevents_fbinit_method_guid, setup_call_pou_guid, TaskConfigurationList, profiler_method_stoptiming_guid |
| `TextList.GlobalTextListObject` | 4 (0/1/1/1/1) | Languages, TextList, GuidExitX, GuidInit, GuidReInit |
| `TraceObject.TraceObject` | 22 (0/2/0/17/3) | TraceSettings, AppGuid, VisuCodeGuids, Record, TraceOutputConfig, TraceDataConfig, RecordList, DownloadGuid, ExitGuid |
| `VisualObject.VisualManagerObject` | 4 (0/1/1/1/1) | GuidVisuGVL0, ViewSettings, UseOverlay, FontDownloadConfig, GuidReservedPouInit, GuidVisuSettingsPou, RemoteUserMgmtPath, GuidVisuUserMgmtInitPouInit, TargetProperties, GuidReservedPouMethod0, GuidVisuGVL2, GuidVisuSettingsPouReInit, FontSettings, GuidVisuSettingsPouInit, GuidVisuGVL5, GuidVisuSettingsPouDIntMethod, UseUserMgmtInPlc, GuidStartVisuInitPouInit, GuidGlobalClientManagerGVL, GuidVisuGVL1, FontsConfig, GuidStartVisuInitPou, GuidMemManInitPouReInit, GuidVisuGVL6, GuidMemManInitPou, GuidVisuGVL3, GuidReservedPouMethod2, InstantiationStorage, UseLocalUserMgmt, GuidMemManInitPouInit, DefInpHandlerGuids, GuidReservedPouMethod1, GuidVisuSettingsPouReservedMethod, VisuUserManagement, GuidReservedPouReInit, RegisterDesc, VisuInitializationCode, GuidVisuGVL_3, GuidBeforeCompileCommonGVL, GuidVisuGVL4, GuidLicenseGVL, UseUnicodeStrings, GuidVisuUserMgmtInitPou, GuidStartVisuInitPouReInit, GuidVisuSettingsPouBoolMethod, ConfiguredHotkeys, GuidReservedPou, GuidVisuSettingsPouStringMethod |
| `VisualObject.VisualObject` | 46 (0/2/2/36/6) | TextDocument, VisualElemList, LastVisuLanguageModelEntry, Hotkeys, GeneratedLMMDescriptions, LastUsedIdForIdentifier, UniqueIdGenerator, ProfileCompatibilityId, LMEntry, LMVerMinor, GvlCreated, VisuSizeManager, FrameInterfaceDataModel, LMVerMajor |


### CODESYS — loaded classes and properties with 0 corpus occurrences (1.1 decides these too)

| role | class | archived members |
|---|---|---|
| object | `AlarmConfigurationObjects.AlarmClassObject` | LanguageModelData, InternalID, Priority, Archiving, AcknowledgeMethod, AcknowledgeSeparately, NotificationActions, DisplayOptions, ReAlarmTime, AutoResetDigitalAlarms, AckInsteadOfConfirm |
| object | `AlarmConfigurationObjects.AlarmClassTemplateObject` | InternalID, Priority, Archiving, AcknowledgeMethod, AcknowledgeSeparately, NotificationActions, DisplayOptions, ReAlarmTime, AutoResetDigitalAlarms, AckInsteadOfConfirm |
| object | `AlarmConfigurationObjects.AlarmConfigurationObject` | LanguageModelData, AlarmInstance, GlobalUniqueAlarmIds, IdGenOverflow, StorageTaskActive, StorageTaskInterval, StorageTaskPriority, ChangeStateToNormal, AssignInactiveTimestamps, UniqueIdGenerator |
| object | `AlarmConfigurationObjects.AlarmGroupObject` | InternalID, Deactivation, Alarms, TextListReference, AlarmStorage, LanguageModelData, PrevLatchVarCount, UniqueIdGenerator |
| object | `AlarmConfigurationObjects.AlarmGroupTemplateObject` | InstanceForAlarmDefinition, TypeForAlarmDefinition, InternalID, Deactivation, Alarms, TextListReference, AlarmStorage, LanguageModelData, PrevLatchVarCount, UniqueIdGenerator |
| object | `AlarmConfigurationObjects.DatabaseFileAlarmStorageObject` | LanguageModelData, SubDirectory, Limit, CircularBuffer |
| object | `AlarmConfigurationObjects.DatabaseFileAlarmStorageTemplateObject` | SubDirectory, Limit, CircularBuffer |
| object | `AlarmConfigurationObjects.RemoteAlarms.RemoteAlarmsObject` | RemoteDevices, LanguageModelData |
| object | `ApplicationObject.HiddenAndTransientApplicationObject` | GuidNetVarGVL, GuidMemSettings, BootAppSettings, OverrideTargetMemorySizes, TargetInputSize, TargetOutputSize, TargetMemoryize, StaticSize, AllowUserDefinedStaticSize, X509CommonName, X509EncryptionThumbprint, X509EncryptionThumbprints, SignDownloadWithX509Certificate, FirmCode, ProductCode, KeepOnParentOnlineChange, DynamicMemory, DownloadContent, StopParentAppsOnException |
| object | `ApplicationObject.HiddenApplicationObject` | GuidNetVarGVL, GuidMemSettings, BootAppSettings, OverrideTargetMemorySizes, TargetInputSize, TargetOutputSize, TargetMemoryize, StaticSize, AllowUserDefinedStaticSize, X509CommonName, X509EncryptionThumbprint, X509EncryptionThumbprints, SignDownloadWithX509Certificate, FirmCode, ProductCode, KeepOnParentOnlineChange, DynamicMemory, DownloadContent, StopParentAppsOnException |
| object | `AxisGroupObject.AxisGroupObject` | Id, MainKinematics, ToolKinematics, Tasks, AdditionalAxes |
| object | `CAMObject.CAMObject` | Name, Dimension, Periodic, Period, Points, Segments, ContinuityRequirements, TappetTracks, Properties |
| object | `CFCObject.CFCParameterInitializationMethodObject` | GuidPOU, GuidParentObject, MethodName, ReturnType |
| object | `CNCEditor.CNCASettings` | PathPreprocessors, IPOTimeMikros, IPOVelMode, IPOJerkMax, TableColumns |
| object | `CNCEditor.CNCDin66025Object` | DIN66025 |
| object | `CNCEditor.CNCObject` | SourceObject |
| object | `Composer.ExtMDeclObject` | Text |
| object | `Composer.GenDataLogConfigObject` | Text, DownloadDataDataLog, RecreateConfigDirDataLog, DataLogChannels, PropertyLoggingActive, DataLogHighTask |
| object | `Composer.GeneratorData` | AutomaticScanOff, GeneratorPipeline, WildcardSettings, GeneratorHashes, StoredDevTree, StoredGenerationSelection, AutomaticScanType, PythonScriptBefore, PythonScriptAfter |
| object | `Composer.GenPersistenceConfigObject` | Text, DownloadData, RecreateConfigDir, PersistenceChannels |
| object | `Composer.MDeclObject` | Text, Signature |
| object | `Composer.ModuleDecoupledObject` | DataElems |
| object | `Composer.ModuleInstanceObject` | DataElems |
| object | `Composer.ModuleReferenceObject` | TargetPath |
| object | `Composer.ModuleSlotObject` | SlotName, Flags |
| object | `Composer.SubMacroModuleDecoupledObject` | ParentMacroGuid, MacroGuid, DataElems |
| object | `Composer.SubMacroModuleInstanceObject` | ParentMacroGuid, MacroGuid, DataElems |
| object | `Composer.SubMacroModuleReferenceObject` | ParentMacroGuid, MacroGuid, TargetPath |
| object | `Composer.SubMacroModuleSlotObject` | ParentMacroGuid, MacroGuid, SlotName, Flags |
| object | `CSourceCodeObject.CLibraryComponentObject` | ObjectToDeviceMapping |
| object | `CSourceCodeObject.CSourceCodeObject` | TextDocument, IgnoreForExport |
| object | `CSourceCodeObject.CSourceComponentObject` | DynamicObject, DynamicObjectFilename, DynamicObjectComponentName, Checksum, IncludePaths, LibraryPaths, LibraryNames, Defines, ConfiguredRTSCmps, ChecksumSourceFiles, ChecksumHeaders, Compiled, SourceFolder, InterfaceFolder, ExtensionsFolder, ProjectSourceFolder, EnableAutoUpdate |
| object | `DataSourcesObject.DataSourceObject` | Mapping, ProviderSettings, LastBrowseResult, LastAdditionalBrowseInfoResult, UpdateByDefault, InsertBrowseResultStructured, Tasks, UpdateRate, UseQualifiedGVL, RelatedTextlistNames, RelatedImpagePoolNames, UniqueIdGenerator, KindOfDataSource |
| object | `DataSourcesObject.DataSourcesObject` | LMGuids, UniqueIdGenerator |
| object | `DeviceObject.HiddenAndTransientDeviceObject` | Id, DefaultDeviceInfo, DeviceParameterSet, Disable, Exclude, Connectors, ConnectorList, Attributes, CommunicationSettings, IoProviderBase, GuidBusCycleTask, DriverInfo, CustomItems, IoConfigGlobalsGuid, IoConfigGlobalsMappingGuid, IoConfigVarConfigGuid, IoConfigErrorPouGuid, ModuleId, IoUpdateTask, FunctionalChildren, UserManagement, RightsManagement, showParamsInDevDescOrder, fixedInputAddress, fixedOutputAddress, HostObjectGuid, DownloadParamsDevDescOrder, CreateBitChannels, AdditionalStringTable, OnlineHelpUrl, InteractiveLoginMode, UseDeviceApplicationStructure, AllowSymbolicVarAccessInSyncWithIecCycle, LogicalDeviceList, LogicalLanguageModelPositionId, SupportedLogicalBusSystems, MappingPossible, HidePropertiesDialog, PlaceholderResolution, RedirectedPlaceholderResolution, UniqueIdGenerator, TypeList, NeedsBusCycle |
| object | `DeviceObject.HiddenDeviceObject` | Id, DefaultDeviceInfo, DeviceParameterSet, Disable, Exclude, Connectors, ConnectorList, Attributes, CommunicationSettings, IoProviderBase, GuidBusCycleTask, DriverInfo, CustomItems, IoConfigGlobalsGuid, IoConfigGlobalsMappingGuid, IoConfigVarConfigGuid, IoConfigErrorPouGuid, ModuleId, IoUpdateTask, FunctionalChildren, UserManagement, RightsManagement, showParamsInDevDescOrder, fixedInputAddress, fixedOutputAddress, HostObjectGuid, DownloadParamsDevDescOrder, CreateBitChannels, AdditionalStringTable, OnlineHelpUrl, InteractiveLoginMode, UseDeviceApplicationStructure, AllowSymbolicVarAccessInSyncWithIecCycle, LogicalDeviceList, LogicalLanguageModelPositionId, SupportedLogicalBusSystems, MappingPossible, HidePropertiesDialog, PlaceholderResolution, RedirectedPlaceholderResolution, UniqueIdGenerator, TypeList, NeedsBusCycle |
| object | `DeviceObject.HiddenSlotDeviceObject` | Device, ConnectorList, AllowEmpty, showParamsInDevDescOrder, IsPlaceholderObject |
| object | `DeviceObject.LogicalExchangeGVLObject` | DeviceObject, LogicalDeviceList, LogicalLanguageModelPositionId, UseCombinedType, QualifiedOnly, Interface |
| object | `DeviceObject.LogicalIODevice` | Id, DefaultDeviceInfo, DeviceParameterSet, Disable, Exclude, Connectors, ConnectorList, Attributes, CommunicationSettings, IoProviderBase, GuidBusCycleTask, DriverInfo, CustomItems, IoConfigGlobalsGuid, IoConfigGlobalsMappingGuid, IoConfigVarConfigGuid, IoConfigErrorPouGuid, ModuleId, IoUpdateTask, FunctionalChildren, UserManagement, RightsManagement, showParamsInDevDescOrder, fixedInputAddress, fixedOutputAddress, HostObjectGuid, DownloadParamsDevDescOrder, CreateBitChannels, AdditionalStringTable, OnlineHelpUrl, InteractiveLoginMode, UseDeviceApplicationStructure, AllowSymbolicVarAccessInSyncWithIecCycle, LogicalDeviceList, LogicalLanguageModelPositionId, SupportedLogicalBusSystems, MappingPossible, HidePropertiesDialog, PlaceholderResolution, RedirectedPlaceholderResolution, UniqueIdGenerator, TypeList, NeedsBusCycle |
| object | `DeviceObject.LogicalIOObject` | DisableSynchronization |
| object | `DeviceObject.TransientDeviceObject` | Id, DefaultDeviceInfo, DeviceParameterSet, Disable, Exclude, Connectors, ConnectorList, Attributes, CommunicationSettings, IoProviderBase, GuidBusCycleTask, DriverInfo, CustomItems, IoConfigGlobalsGuid, IoConfigGlobalsMappingGuid, IoConfigVarConfigGuid, IoConfigErrorPouGuid, ModuleId, IoUpdateTask, FunctionalChildren, UserManagement, RightsManagement, showParamsInDevDescOrder, fixedInputAddress, fixedOutputAddress, HostObjectGuid, DownloadParamsDevDescOrder, CreateBitChannels, AdditionalStringTable, OnlineHelpUrl, InteractiveLoginMode, UseDeviceApplicationStructure, AllowSymbolicVarAccessInSyncWithIecCycle, LogicalDeviceList, LogicalLanguageModelPositionId, SupportedLogicalBusSystems, MappingPossible, HidePropertiesDialog, PlaceholderResolution, RedirectedPlaceholderResolution, UniqueIdGenerator, TypeList, NeedsBusCycle |
| object | `EmbeddedRuntimeExtension.POULocObject` | _liCodeLocationChangedNodes |
| object | `ExternalFileObject.ExternalFileObject` | FileId, Configuration |
| object | `GVLObject.TasklocalGVLObject` | ParameterList, AddAttributeSubsequent, GuidImplicitDUT, GuidImplicitGVL, Interface, NetVarProperties, TaskForWrite |
| object | `ImagePool.BitmapPoolObjectObsolete` | BitmapPool |
| object | `ImagePool.GlobalImagePoolObject` | BitmapPool, GuidInit, GuidReInit, GuidExitX, ValidIds, UniqueIdGenerator |
| object | `ImagePool.HiddenImagePoolObject` | BitmapPool, GuidInit, GuidReInit, GuidExitX, ValidIds, UniqueIdGenerator |
| object | `ImagePool.TransientImagePoolObject` | BitmapPool, GuidInit, GuidReInit, GuidExitX, ValidIds, UniqueIdGenerator |
| object | `LibManObject.EmptyObject` | OriginalObjectTypeGuid, OriginalEmbeddedObjectTypeGuid |
| object | `ObjectManager.UnknownObject` | — |
| object | `PropertyObject.AbstractFunctionblockPropertyAccessorObject` | Interface, IsGet, UniqueIdGenerator |
| object | `Redundancy.RedundancyObject` | AllowedPages, AllowedSettingsTabs, LocatedReadonly, LocatedHidden, LibraryName, RedundancySettings, DeviceObjectGuid, RegisteredAreas, MaximumIdRedundantAreas, MaximumIdNonRedundantAreas, DefaultRedundantAreas, DefaultNonRedundantAreas, RedundantAreas, NonRedundantAreas, OrderedRegisteredAreas, ConfigGuid, WriteSubsequentFlagOnlyBeforeCompile, CustomObjects, DisablePointerChecks, GuidVfInit2, GuidRegisterVfInit2, CreateUnregisterFunction, CyclicUpdate |
| object | `SFCObject.MetaStepsType` | GuidPOU, GuidParentObject, MetaStepsType_MaxCountSteps, MetaStepsType_MaxCountPrevTrans, MetaStepsType_MaxCountFollowingTrans, MetaStepsType_StepType, MetaStepsType_TransType, MetaStepsType_IsValid |
| object | `TaskConfigObject.HiddenTaskConfigObject` | TaskConfigurationList, SystemEventList, ExternalEventList, enum_guid, jitter_distribution_guid, task_struct_guid, task_config_info_guid, task_global_vars_guid, setup_call_pou_guid, sys_setup_pou_guid, profiler_global_vars_guid, profiler_init_code_guid, profiler_cycle_code_guid, profiler_fb_guid, profiler_method_reset_guid, profiler_method_starttiming_guid, profiler_method_stoptiming_guid, profiler_iectaskgetprofiling_guid, alSysEventList, alTaskGroups, sysevents_global_vars_guid, sysevents_functionsblock_guid, sysevents_fbinit_method_guid, sysevents_fbexit_method_guid, sysevents_eventcallback_method_guid, sysevents_resetget_property_guid, parent_tasks, device_app, StackSize, UseConfigurableStackSize |
| object | `TextList.TextListEnumerationTextListObject` | TextList, Languages, GuidInit, GuidReInit, GuidExitX, UniqueIdGenerator |
| object | `TextList.TextListObject` | TextList, Languages, GuidInit, GuidReInit, GuidExitX, UniqueIdGenerator |
| object | `TraceObject.HiddenAndTransientDeviceTraceObject` | TraceSettings, RecordList, Record, AppGuid, DownloadGuid, ExitGuid, VisuCodeGuids, TraceDataConfig, TraceOutputConfig |
| object | `TraceObject.HiddenDeviceTraceObject` | TraceSettings, RecordList, Record, AppGuid, DownloadGuid, ExitGuid, VisuCodeGuids, TraceDataConfig, TraceOutputConfig |
| object | `TraceObject.TransientDeviceTraceObject` | TraceSettings, RecordList, Record, AppGuid, DownloadGuid, ExitGuid, VisuCodeGuids, TraceDataConfig, TraceOutputConfig |
| object | `TransitionObject.TransitionObject` | Implementation, UniqueIdGenerator |
| object | `TrendRecordingObjects.TrendRecordingManagerObject` | — |
| object | `TrendRecordingObjects.TrendRecordingObject` | Packet, MaxNumberOfVariables, Limit, StoreEveryNMilliseconds, LanguageModelData, IntervalTaskPriority, IntervalTimeUnit, IntervalTimeValue, RecordingMode, MeasureSlowdownFactor |
| object | `UnitConversionObject.UnitConversionObject` | ConversionList, Id, InitPrgGuid |
| object | `VisualObject.Instantiation.VisualInstanceObject` | Id, LanModData, QualVisuName, VisuName |
| object | `VisualObject.RemoteTargetVisualizationClientObject` | ViewSettings |
| object | `VisualObject.TargetVisualizationObject` | ViewSettings |
| object | `VisualObject.WebVisualizationObject` | ViewSettings |
| property | `ActionObject.ActionObjectDuplicationModeProperty` | Embedded |
| property | `ApplicationComposerTrendGenerator.TrendRecordingProperty` | MIGuid, TrendRecordTarget |
| property | `CAMObject.CAMProperty` | CompileType, NumberElements |
| property | `CNCEditor.CNCProperty` | CompileMode, FileName, QueueSize, DefaultVelocity, DefaultAcceleration, DefaultDeceleration, DefaultVelocityFF, DefaultAccelerationFF, DefaultDecelerationFF, Use3DMode, StartPosition, StepSuppression, OfflineValues, dPrecision |
| property | `CNCEditor.DynamicsProperty` | StartTime, EndTime, VelocityMode, IpoTimeMikros, Axis, JerkMax |
| property | `Composer.AutoGenProperty` | ChildOrder |
| property | `Composer.AutoGenPropertyWithModuleInstance` | ModuleInstancesGuid |
| property | `Composer.AutoInsertedProperty` | — |
| property | `Composer.ChildIndexProperty` | ChildIndex |
| property | `Composer.DefaultAndNotDeletable` | bDefaultAndNotDeletable |
| property | `Composer.SourceTemplateGenProperty` | MIGuid, SourceFBTarget |
| property | `CSourceCodeObject.ExternalCObjectProperty` | ExternalName |
| property | `CSourceCodeObject.StructuringFolderProperty` | IsSourceFolder, IsInterfaceFolder, IsExtensionFolder |
| property | `DataSourcesObject.AutoGenProperty` | Editable |
| property | `DeviceEditorProfibus.ProfibusMarkInitializedProperty` | ID |
| property | `DeviceObject.LogicalApplicationProperty` | DeviceIdentification |
| property | `Engine.ObjectAccessProperty` | VerbToPermissionId, Acl |
| property | `ObjectCommands.DocumentationProperty` | Documentation |
| property | `ProfinetIO.ProfiNetMarkInitializedProperty` | ID |
| property | `SFCObject.SFCLibraryProperty` | Title, Company, Version, Namespace, Flags, CalcActiveTransOnly, UseDefaults, SFCErrorAnalyzation, SFCErrorAnalyzationTable, SFCCurrentSteps, SFCMetaSteps |
| property | `StringLibraries.StringLibrariesProperty` | PlaceholderResolution |
| property | `TextList.TextListPropertiesObject` | DownloadForVisu, Internal, DownloadForApplication |
| property | `TransitionObject.TransitionMonitoringProperty` | EnableMonitoring, MonitoringByCall |
| property | `TransitionObject.TransitionObjectDuplicationModeProperty` | Embedded |

### TwinCAT — every element and attribute (Project14: the 13 files its two `.plcproj` compile, the `.plcproj`s and the `.tsproj`; NWL internals inside an `Implementation` excluded)

| file | element / attribute | n | files | values |
|---|---|---|---|---|
| .plcproj | `Project` | 2 | 2 | (element) |
| .plcproj | `Project/@DefaultTargets` | 2 | 2 | "Build" ×2 |
| .plcproj | `Project/@xmlns` | 2 | 2 | text(1 lines) ×2 |
| .plcproj | `Project/ItemGroup` | 7 | 2 | (element) |
| .plcproj | `Project/ItemGroup/Compile` | 13 | 2 | (element) |
| .plcproj | `Project/ItemGroup/Compile/@Include` | 13 | 2 | "PlcTask.TcTTO" ×2, "DUTs\\E_PackML_Mode.TcDUT" ×1, "DUTs\\E_PackML_State.TcDUT" ×1, "FBs\\FB_PackML_ModeManager.TcPOU" ×1, … (12 distinct) |
| .plcproj | `Project/ItemGroup/Compile/SubType` | 13 | 2 | (element) |
| .plcproj | `Project/ItemGroup/Compile/SubType#text` | 13 | 2 | "Code" ×13 |
| .plcproj | `Project/ItemGroup/Folder` | 12 | 2 | (element) |
| .plcproj | `Project/ItemGroup/Folder/@Include` | 12 | 2 | "DUTs" ×2, "GVLs" ×2, "VISUs" ×2, "POUs" ×2, … (8 distinct) |
| .plcproj | `Project/ItemGroup/None` | 1 | 1 | (element) |
| .plcproj | `Project/ItemGroup/None/@Include` | 1 | 1 | "Untitled2.tmc" ×1 |
| .plcproj | `Project/ItemGroup/None/SubType` | 1 | 1 | (element) |
| .plcproj | `Project/ItemGroup/None/SubType#text` | 1 | 1 | "Content" ×1 |
| .plcproj | `Project/ItemGroup/PlaceholderReference` | 6 | 2 | (element) |
| .plcproj | `Project/ItemGroup/PlaceholderReference/@Include` | 6 | 2 | "Tc2_Standard" ×2, "Tc2_System" ×2, "Tc3_Module" ×2 |
| .plcproj | `Project/ItemGroup/PlaceholderReference/DefaultResolution` | 6 | 2 | (element) |
| .plcproj | `Project/ItemGroup/PlaceholderReference/DefaultResolution#text` | 6 | 2 | "Tc2_Standard, * (Beckhoff Automation GmbH)" ×2, "Tc2_System, * (Beckhoff Automation GmbH)" ×2, "Tc3_Module, * (Beckhoff Automation GmbH)" ×2 |
| .plcproj | `Project/ItemGroup/PlaceholderReference/Namespace` | 6 | 2 | (element) |
| .plcproj | `Project/ItemGroup/PlaceholderReference/Namespace#text` | 6 | 2 | "Tc2_Standard" ×2, "Tc2_System" ×2, "Tc3_Module" ×2 |
| .plcproj | `Project/ProjectExtensions` | 1 | 1 | (element) |
| .plcproj | `Project/ProjectExtensions/PlcProjectOptions` | 1 | 1 | (element) |
| .plcproj | `Project/PropertyGroup` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Application` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Application#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/DownloadApplicationInfo` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/DownloadApplicationInfo#text` | 2 | 2 | "true" ×2 |
| .plcproj | `Project/PropertyGroup/FileVersion` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/FileVersion#text` | 2 | 2 | "1.0.0.0" ×2 |
| .plcproj | `Project/PropertyGroup/GenerateTpy` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/GenerateTpy#text` | 2 | 2 | "false" ×2 |
| .plcproj | `Project/PropertyGroup/Implicit_Jitter_Distribution` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Implicit_Jitter_Distribution#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/Implicit_KindOfTask` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Implicit_KindOfTask#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/Implicit_Task_Info` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Implicit_Task_Info#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/LibraryReferences` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/LibraryReferences#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/Name` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/Name#text` | 2 | 2 | "Untitled1" ×1, "Untitled2" ×1 |
| .plcproj | `Project/PropertyGroup/ProgramVersion` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/ProgramVersion#text` | 2 | 2 | "3.1.4024.0" ×2 |
| .plcproj | `Project/PropertyGroup/ProjectGuid` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/ProjectGuid#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/SchemaVersion` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/SchemaVersion#text` | 2 | 2 | "2.0" ×2 |
| .plcproj | `Project/PropertyGroup/SubObjectsSortedByName` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/SubObjectsSortedByName#text` | 2 | 2 | "True" ×2 |
| .plcproj | `Project/PropertyGroup/TypeSystem` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/TypeSystem#text` | 2 | 2 | guid ×2 |
| .plcproj | `Project/PropertyGroup/WriteProductVersion` | 2 | 2 | (element) |
| .plcproj | `Project/PropertyGroup/WriteProductVersion#text` | 2 | 2 | "true" ×2 |
| .TcDUT | `TcPlcObject` | 2 | 2 | (element) |
| .TcDUT | `TcPlcObject/@ProductVersion` | 2 | 2 | "3.1.4024.16" ×2 |
| .TcDUT | `TcPlcObject/@Version` | 2 | 2 | "1.1.0.1" ×2 |
| .TcDUT | `TcPlcObject/DUT` | 2 | 2 | (element) |
| .TcDUT | `TcPlcObject/DUT/@Id` | 2 | 2 | guid ×2 |
| .TcDUT | `TcPlcObject/DUT/@Name` | 2 | 2 | "E_PackML_Mode" ×1, "E_PackML_State" ×1 |
| .TcDUT | `TcPlcObject/DUT/Declaration` | 2 | 2 | (element) |
| .TcDUT | `TcPlcObject/DUT/Declaration#text` | 2 | 2 | text(9 lines) ×1, text(22 lines) ×1 |
| .TcGVL | `TcPlcObject` | 1 | 1 | (element) |
| .TcGVL | `TcPlcObject/@ProductVersion` | 1 | 1 | "3.1.4024.16" ×1 |
| .TcGVL | `TcPlcObject/@Version` | 1 | 1 | "1.1.0.1" ×1 |
| .TcGVL | `TcPlcObject/GVL` | 1 | 1 | (element) |
| .TcGVL | `TcPlcObject/GVL/@Id` | 1 | 1 | guid ×1 |
| .TcGVL | `TcPlcObject/GVL/@Name` | 1 | 1 | "GVL_PackML" ×1 |
| .TcGVL | `TcPlcObject/GVL/Declaration` | 1 | 1 | (element) |
| .TcGVL | `TcPlcObject/GVL/Declaration#text` | 1 | 1 | text(6 lines) ×1 |
| .TcPOU | `TcPlcObject` | 8 | 8 | (element) |
| .TcPOU | `TcPlcObject/@ProductVersion` | 8 | 8 | "3.1.4024.16" ×8 |
| .TcPOU | `TcPlcObject/@Version` | 8 | 8 | "1.1.0.1" ×8 |
| .TcPOU | `TcPlcObject/POU` | 8 | 8 | (element) |
| .TcPOU | `TcPlcObject/POU/@Id` | 8 | 8 | guid ×8 |
| .TcPOU | `TcPlcObject/POU/@Name` | 8 | 8 | "FB_PackML_ModeManager" ×1, "FB_PackML_Unit" ×1, "PLC_PRG" ×1, "ladderLabel" ×1, … (8 distinct) |
| .TcPOU | `TcPlcObject/POU/@SpecialFunc` | 8 | 8 | "None" ×8 |
| .TcPOU | `TcPlcObject/POU/Action` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Action/@Id` | 1 | 1 | guid ×1 |
| .TcPOU | `TcPlcObject/POU/Action/@Name` | 1 | 1 | "SfcRun" ×1 |
| .TcPOU | `TcPlcObject/POU/Action/Implementation` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Action/Implementation/SFC` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Action/ObjectProperties` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Declaration` | 8 | 8 | (element) |
| .TcPOU | `TcPlcObject/POU/Declaration#text` | 8 | 8 | text(7 lines) ×2, text(30 lines) ×1, text(53 lines) ×1, text(34 lines) ×1, … (7 distinct) |
| .TcPOU | `TcPlcObject/POU/Implementation` | 8 | 8 | (element) |
| .TcPOU | `TcPlcObject/POU/Implementation/CFC` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Implementation/NWL` | 2 | 2 | (element) |
| .TcPOU | `TcPlcObject/POU/Implementation/SFC` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Implementation/ST` | 4 | 4 | (element) |
| .TcPOU | `TcPlcObject/POU/Implementation/ST#text` | 4 | 4 | text(212 lines) ×1, text(210 lines) ×1, text(42 lines) ×1, "nTick := nTick + 1;" ×1 |
| .TcPOU | `TcPlcObject/POU/LineIds` | 5 | 4 | (element) |
| .TcPOU | `TcPlcObject/POU/LineIds/@Name` | 5 | 4 | "FB_PackML_ModeManager" ×1, "FB_PackML_Unit" ×1, "PLC_PRG" ×1, "VltFixtureMembers" ×1, … (5 distinct) |
| .TcPOU | `TcPlcObject/POU/LineIds/LineId` | 8 | 4 | (element) |
| .TcPOU | `TcPlcObject/POU/LineIds/LineId/@Count` | 8 | 4 | "0" ×5, "210" ×1, "208" ×1, "40" ×1 |
| .TcPOU | `TcPlcObject/POU/LineIds/LineId/@Id` | 8 | 4 | "8" ×3, "2" ×2, "4471" ×1, "5227" ×1, … (5 distinct) |
| .TcPOU | `TcPlcObject/POU/Method` | 2 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Method/@Id` | 2 | 1 | guid ×2 |
| .TcPOU | `TcPlcObject/POU/Method/@Name` | 2 | 1 | "CfcStep" ×1, "Visible" ×1 |
| .TcPOU | `TcPlcObject/POU/Method/Declaration` | 2 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Method/Declaration#text` | 2 | 1 | text(5 lines) ×2 |
| .TcPOU | `TcPlcObject/POU/Method/Implementation` | 2 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Method/Implementation/CFC` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Method/Implementation/ST` | 1 | 1 | (element) |
| .TcPOU | `TcPlcObject/POU/Method/Implementation/ST#text` | 1 | 1 | "Visible := bIn;" ×1 |
| .TcPOU | `TcPlcObject/POU/ObjectProperties` | 1 | 1 | (element) |
| .TcTTO | `TcPlcObject` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/@ProductVersion` | 1 | 1 | "3.1.4024.16" ×1 |
| .TcTTO | `TcPlcObject/@Version` | 2 | 2 | "1.1.0.1" ×2 |
| .TcTTO | `TcPlcObject/Task` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/@Id` | 2 | 2 | guid ×2 |
| .TcTTO | `TcPlcObject/Task/@Name` | 2 | 2 | "PlcTask" ×2 |
| .TcTTO | `TcPlcObject/Task/CycleTime` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/CycleTime#text` | 2 | 2 | "10000" ×2 |
| .TcTTO | `TcPlcObject/Task/CycleUpdate` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/CycleUpdate#text` | 2 | 2 | guid ×2 |
| .TcTTO | `TcPlcObject/Task/Fb_exit` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/Fb_exit#text` | 2 | 2 | guid ×2 |
| .TcTTO | `TcPlcObject/Task/Fb_init` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/Fb_init#text` | 2 | 2 | guid ×2 |
| .TcTTO | `TcPlcObject/Task/ObjectProperties` | 1 | 1 | (element) |
| .TcTTO | `TcPlcObject/Task/PostCycleUpdate` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/PostCycleUpdate#text` | 2 | 2 | guid ×2 |
| .TcTTO | `TcPlcObject/Task/PouCall` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/PouCall/Name` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/PouCall/Name#text` | 2 | 2 | "MAIN" ×1, "PLC_PRG" ×1 |
| .TcTTO | `TcPlcObject/Task/Priority` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/Priority#text` | 2 | 2 | "20" ×2 |
| .TcTTO | `TcPlcObject/Task/TaskFBGuid` | 2 | 2 | (element) |
| .TcTTO | `TcPlcObject/Task/TaskFBGuid#text` | 2 | 2 | guid ×2 |
| .tsproj | `TcSmProject` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/@TcSmVersion` | 1 | 1 | "1.0" ×1 |
| .tsproj | `TcSmProject/@TcVersion` | 1 | 1 | "3.1.4024.74" ×1 |
| .tsproj | `TcSmProject/@xmlns:xsi` | 1 | 1 | "http://www.w3.org/2001/XMLSchema-instance" ×1 |
| .tsproj | `TcSmProject/@xsi:noNamespaceSchemaLocation` | 1 | 1 | text(1 lines) ×1 |
| .tsproj | `TcSmProject/Project` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/@ProjectGUID` | 1 | 1 | guid ×1 |
| .tsproj | `TcSmProject/Project/@ShowHideConfigurations` | 1 | 1 | "#x6" ×1 |
| .tsproj | `TcSmProject/Project/Plc` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/@AmsPort` | 1 | 1 | "851" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@FileArchiveSettings` | 1 | 1 | "#x000e" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@GUID` | 1 | 1 | guid ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@Name` | 1 | 1 | "Untitled2" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@PrjFilePath` | 1 | 1 | "Untitled2\\Untitled2.plcproj" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@ReloadTmc` | 1 | 1 | "true" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@SymbolicMapping` | 1 | 1 | "true" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/@TmcFilePath` | 1 | 1 | "Untitled2\\Untitled2.tmc" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/@Id` | 1 | 1 | "#x08502000" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/@KeepUnrestoredLinks` | 1 | 1 | "2" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/@TcSmClass` | 1 | 1 | "TComPlcObjDef" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/@TmcHash` | 1 | 1 | guid ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/@TmcPath` | 1 | 1 | "Untitled2\\Untitled2.tmc" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/CLSID` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/CLSID/@ClassFactory` | 1 | 1 | "TcPlc30" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/CLSID#text` | 1 | 1 | guid ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/CycleTime` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/CycleTime#text` | 1 | 1 | "10000000" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Id` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Id#text` | 1 | 1 | "0" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/ManualConfig` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/ManualConfig/OTCID` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/ManualConfig/OTCID#text` | 1 | 1 | "#x02010030" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Name` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Name#text` | 1 | 1 | "PlcTask" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Priority` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Contexts/Context/Priority#text` | 1 | 1 | "20" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Name` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/Name#text` | 1 | 1 | "Untitled2 Instance" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/TaskPouOids` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/TaskPouOids/TaskPouOid` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/TaskPouOids/TaskPouOid/@OTCID` | 1 | 1 | "#x08502001" ×1 |
| .tsproj | `TcSmProject/Project/Plc/Project/Instance/TaskPouOids/TaskPouOid/@Prio` | 1 | 1 | "20" ×1 |
| .tsproj | `TcSmProject/Project/System` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/System/Tasks` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/System/Tasks/Task` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/@AdtTasks` | 1 | 1 | "true" ×1 |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/@AmsPort` | 1 | 1 | "350" ×1 |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/@CycleTime` | 1 | 1 | "100000" ×1 |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/@Id` | 1 | 1 | "3" ×1 |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/@Priority` | 1 | 1 | "20" ×1 |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/Name` | 1 | 1 | (element) |
| .tsproj | `TcSmProject/Project/System/Tasks/Task/Name#text` | 1 | 1 | "PlcTask" ×1 |

**The `<ObjectProperties>` carrier — its `XmlArchive`, walked** (a TwinCAT object-property archive; the first walk
dropped it with the NWL internals and reported the carrier empty — corrected after review). Over the 13 loaded files:

| object | file:line | carrier | archived class and members |
|---|---|---|---|
| POU `VltFixtureSfc` | `Untitled2/POUs/VltFixtureSfc.TcPOU:555-654` | `<ObjectProperties><XmlArchive><Data><o t="SFCProperty">` + its own `<TypeList>` (class GUIDs) | `SFCProperty`: `Title "IecSfc"`, `Company "System"`, `Version "3.4.2.0"`, `Namespace ""`, `Flags` 15 entries (`EnableLimit Init Reset QuitError Pause Error Trans ErrorStep ErrorPOU CurrentStep Tip TipMode MaxFlags SFCErrorAnalyzation SFCErrorAnalyzationTable`, each `Use false` / `Declare true`), `CalcActiveTransOnly false`, `UseDefaults false`, `SFCErrorAnalyzation` / `SFCErrorAnalyzationTable` null (`<n>`) |
| action `VltFixtureMembers.SfcRun` | `Untitled2/POUs/VltFixtureMembers.TcPOU:594-688` | the same | `SFCProperty`, the same members except `Flags` 14 entries (no `MaxFlags`) and `UseDefaults true` |
| task `PlcTask` (Untitled1) | `Untitled1/PlcTask.TcTTO:15` | `<ObjectProperties />` | — (empty) |

The supplement fixture `TwinCAT Project13/…/Untitled1/POUs/VltFixtureSfc.TcPOU:551-650` holds the same `SFCProperty`
archive. **Both vendors archive the same property class** (CODESYS `meta.Properties[SFCProperty]` on its SFC POU and
action, finding 1) with different values for the same-named fixture: `Version` `3.4.2.0` (TwinCAT) vs `4.4.0.0` (CODESYS),
`Namespace` `""` vs `'IecSfc'`, CODESYS `UseDefaults true` on both, and CODESYS also archives `SFCCurrentSteps` /
`SFCMetaSteps` (null), which the TwinCAT archive does not name.

**Not loaded, not counted**: three git-tracked `.TcPOU` that no `.plcproj` `<Compile Include>` names, so TwinCAT never
loads them — `Untitled1/POUs/PLC_PRG.TcPOU`, `Untitled2/POU_PBD.TcPOU`, `Untitled2/POUs/ladder.TcPOU`. They hold no
path the loaded files lack (`SpecialFunc="None"` ×3, one `LineIds` with one `LineId`); the first walk counted them
(11 POUs, `PLC_PRG` ×2, 6 `LineIds`).

Seen only in the committed TwinCAT FIXTURES (Project13, `Volt.Ide.Twincat.Tests/fixtures/tc-pou`), not in the corpus:

.tsproj `TcSmProject/Project/@Target64Bit`; .TcIO `TcPlcObject`; .TcIO `TcPlcObject/@Version`; .TcIO `TcPlcObject/@ProductVersion`; .TcIO `TcPlcObject/Itf`; .TcIO `TcPlcObject/Itf/@Name`; .TcIO `TcPlcObject/Itf/@Id`; .TcIO `TcPlcObject/Itf/Declaration`; .TcIO `TcPlcObject/Itf/Method`; .TcIO `TcPlcObject/Itf/Method/@Name`; .TcIO `TcPlcObject/Itf/Method/@Id`; .TcIO `TcPlcObject/Itf/Method/Declaration`; .TcIO `TcPlcObject/Itf/Property`; .TcIO `TcPlcObject/Itf/Property/@Name`; .TcIO `TcPlcObject/Itf/Property/@Id`; .TcIO `TcPlcObject/Itf/Property/Declaration`; .TcIO `TcPlcObject/Itf/Property/Get`; .TcIO `TcPlcObject/Itf/Property/Get/@Name`; .TcIO `TcPlcObject/Itf/Property/Get/@Id`; .TcIO `TcPlcObject/Itf/Property/Get/Declaration`; .TcIO `TcPlcObject/Itf/Property/Set`; .TcIO `TcPlcObject/Itf/Property/Set/@Name`; .TcIO `TcPlcObject/Itf/Property/Set/@Id`; .TcIO `TcPlcObject/Itf/Property/Set/Declaration`; .TcPOU `TcPlcObject/POU/Property`; .TcPOU `TcPlcObject/POU/Property/@Name`; .TcPOU `TcPlcObject/POU/Property/@Id`; .TcPOU `TcPlcObject/POU/Property/Declaration`; .TcPOU `TcPlcObject/POU/Property/Get`; .TcPOU `TcPlcObject/POU/Property/Get/@Name`; .TcPOU `TcPlcObject/POU/Property/Get/@Id`; .TcPOU `TcPlcObject/POU/Property/Get/Declaration`; .TcPOU `TcPlcObject/POU/Property/Get/Implementation`; .TcPOU `TcPlcObject/POU/Property/Get/Implementation/CFC`; .TcPOU `TcPlcObject/POU/Action/Implementation/ST`; .TcPOU `TcPlcObject/POU/Property/Get/Implementation/ST`; .TcPOU `TcPlcObject/POU/Property/Set`; .TcPOU `TcPlcObject/POU/Property/Set/@Name`; .TcPOU `TcPlcObject/POU/Property/Set/@Id`; .TcPOU `TcPlcObject/POU/Property/Set/Declaration`; .TcPOU `TcPlcObject/POU/Property/Set/Implementation`; .TcPOU `TcPlcObject/POU/Property/Set/Implementation/ST`

## 0.2 Read/write inventory (the 2026-10-12 audit, file:line, completed by the census)

Paths are under `packages/volt-cli/src/` unless stated; line numbers as of `01e4910c48`. **R** = read (pull),
**W** = write (push/create). "Census" cites §0.1's finding number.

### The seam vocabulary

| site | what it carries | gap |
|---|---|---|
| `Volt.Engine/Item/ItemContent.cs:31-37` `ItemContent(Kind, Declaration, Body, Members, Unsupported, Stated)` | declaration, body, members | no object property, no object class — census 1-3 have nowhere to travel |
| `Volt.Engine/Item/ItemContent.cs:86-97` `Member(Kind, Name, Declaration, Body, Folder, Getter, Setter, ReturnType, DataType, …)` | a member's text, folder, accessors | no class (`AbstractPOUMethodObject` vs `POUMethodObject`, census 3), no `BuildProperty` (7 excluded methods, census 2) |
| `Volt.Engine/Item/ItemContent.cs:128` `Accessor(Declaration, Body, …)` | presence + text | `IsGet` not carried — derived from the name (below) |
| `Volt.Engine/Format/Task/TaskDescriptorFormat.cs:46-103` (labels `Type Interval Priority Event Watchdog Calls`) | a task as six labels | no `External event`, no call comment, no disabled-watchdog values, no `Core`/`TaskGroup`/`AllowEmpty`/… (census 5) |
| `Volt.Engine/Library/LibraryManifest.cs:49-66` (`LIBRARY NAMESPACE RESOLUTION PLACEHOLDER SYSTEM DEPENDENCIES MATERIALIZATION`) | a library reference | no `LinkAllContent` (5), `QualifiedOnly` (1), `Optional`, `HideWhenReferencedAsDependency`, `PublishSymbolsInContainer`, parameter tables, redirections (census 8) |
| `Volt.Engine/Item/ItemKind.cs:279` `EmptyManifest(kind) => "{kind}\n"` | the stub of every kind without a reader | content-free: every such item hashes identically |

### Proposal findings, each to its sites

1. **The class on every create** (data loss). R: `Volt.Ide.Codesys/Ide/CodesysTypeMap.cs:58` (`IPOUObject` — POU and
   `POUObjectCheckFunction` fold to `PlcPou`), `:59` (`IGVLObject || INVLObject` → `PlcGvl`; also folds
   `VarPersistentObject` and a GVL with `NetVarProperties`), `:68` (`IDUTObject || ITextListEnumerationObject` →
   `PlcDut`). W: `Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs:376` (every POU created
   `CreatePou(…, "FunctionBlock", …)`), `:381` (`create_dut` Structure), `:382` (`create_gvl` — NVL / persistent /
   parameter list created plain), `:391` (`create_interface`); TwinCAT `Volt.Ide.Twincat/Ide/TcObjectModel.cs:357-411`
   (`CreateChild`; `.TcPOU @SpecialFunc` never read or written). Census 3: 15 check functions, 3 text-list enums, 1
   NVL, 1 sender GVL, 4 persistent lists; 0 parameter lists.
2. **Member re-type / rename is delete + create** (data loss). `Volt.Engine/Sync/PushService.cs:1984-1986`
   (`retyped` = a member whose live kind differs), `:1991-2002` (deletes first), `:2004-2013` (creates
   `ide.CreateChild(site, m.Name, ItemKind.MemberCode(m.Kind), CreateSeed(m))`); create sites
   `CodesysObjectModel.Libraries.cs:398-412` (`create_method` / `create_action` / `create_property`). The class a
   member had (`AbstractPOUMethodObject` 10, census 3) and its object GUID are lost; a method's `BuildProperty`
   (7 excluded methods, census 2) with it.
3. **Object properties never read or written.** No source file names `ExcludeFromBuild`, `LinkAlways`, `External`,
   `SpecialFunc`, `ObjectProperties`, `Documentation` or `IMetaObject.Properties` (grep, 2026-10-13); the only
   object property any driver touches is the folder (`SVFoldersProperty`, through the tree walk). `ARCHITECTURE.md:153-156`
   admits exclude-from-build is "NOT implemented". Census 1-2: 11 excluded source objects + 4 excluded folders, 3
   link-always GVLs, 15 POUs with an online-change reserve, 2 POU images, 1 file-linked GVL; TwinCAT: 0 build properties
   in the corpus, and an `<ObjectProperties><XmlArchive>` `SFCProperty` on 1 POU + 1 action that no source file reads
   either (census 13).
4. **Tasks.** CODESYS R `Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs:162-189` (`ReadTask`): `:165-166`
   reads `event` and falls back to `external_event` — **folds an external event into `Event:`**; `:168-171` a disabled
   watchdog read as ABSENT (its values hidden — census 5: 3 tasks, `3200` µs on two); `:173-179` calls by name only.
   W `:250-296` (`WriteTask`): `:257` writes `event` only (an external event is moved to `event` on push); `:263-269`
   writes the watchdog values only when enabled. Call list rebuilt `:330-405`; `:387-401` carries a call's `Comment`
   BY NAME but no text spells it (census: 19/19 empty). Unread over 13/13 tasks: `Core`, `Core2`, `TaskGroup`,
   `AllowEmpty`, `Implicit`, `WithinSPSTimeSlicing`, `SynchTask`, `*Parameters`, `TaskGuid`/`EventPOUGuid`; the Task
   Configuration's system events (`alSysEventList`, len 1) are not an item at all (`ItemKind.cs:121` `TaskConfig` is
   a container). TwinCAT R `Volt.Ide.Twincat/Ide/TcTaskSchedule.cs:53-63` (`Read`: `Priority` + `CycleTime` of
   `TaskDef`; `:63` returns `CyclicType`, `Event: null`, `Watchdog: null` — hard-coded, `:44` `CyclicType`), W
   `:71-103` (`SysTaskPatch`); `Volt.Ide.Twincat/Ide/TcObjectModel.Task.cs:87-147`. Other `TaskDef` members and the
   `.TcTTO` members (`TaskFBGuid`, `CycleUpdate`, `PostCycleUpdate`, `Fb_init`, `Fb_exit`) unread (census 15).
5. **SFC transitions absent.** `Volt.Engine/Item/ItemKind.cs:338-339` (`IsMember` excludes `PlcTrans`), `:346-349`
   (`IsInlinedInPou` includes it — the walk skips it, and no member read takes it); CODESYS
   `CodesysTypeMap.cs:49` (`ITransitionObject` → `PlcTrans`). Census 10: 0 `TransitionObject`s and no SFC body in the
   four real corpora; the one fixture transition is embedded in its SFC body.
6. **A TwinCAT DUT create always seeds 606.** `Volt.Ide.Twincat/Ide/TcObjectModel.cs:374-380` (`if (kindCode ==
   ItemKind.PlcDut) kindCode = ItemKind.PlcDutStruct;`, DIALECT C2e — the code after a reload unmeasured).
7. **Wire divergences.** Stub manifest: CODESYS `Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs:594-616`
   (`NoDescriptorReader` → `ItemKind.EmptyManifest(kind)` = `kind\n`), TwinCAT
   `Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs:768-813` (`:811-812` `Name=<name>\n` for every kind without a
   descriptor; `:778` `EmptyManifest` only when `ProduceXml` is empty). Library `SYSTEM`: CODESYS reads
   `SystemLibrary` (`CodesysObjectModel.Libraries.cs:105`; census 8: true 142 / false 122) — but DEFAULTS it: a missing
   or non-bool member reads as false (`is bool b && b`), and a missing `Namespace` as `""` (`:104`); TwinCAT hard-codes
   false and takes namespace `?? name` (`BeckhoffDriver.Content.cs:816-830`). Both vendors default the same two
   fields; only the default differs. Interface property accessors: TwinCAT reads
   PRESENCE only (`BeckhoffDriver.Content.cs:637-640`, `Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs:391`) —
   CODESYS reads each accessor object (`CodesysDriver.Content.cs:254-305`); neither writes one
   (`CodesysDriver.Content.cs:506`, DIALECT D21).
8. **Guesses and fallbacks.**
   - END line: `Volt.Engine/Format/St/StWriter.cs:83-87` (`EndKeyword`), `:97` `FallbackPouHeader = "FUNCTION_BLOCK"`.
   - GET/SET by name: `CodesysTypeMap.cs:46` → `:161-162` `RefineAccessor(name)`; the vendor member is `IsGet` (census 4).
   - Missing aspect read as `""`: `Volt.Ide.Codesys/Ide/CodesysObjectModel.cs:148-149` (`ReadAspectText … ?? ""`),
     `:167-172` (`TryReadAspectText`: `GetMember(doc, "Text") as string ?? ""`); TwinCAT
     `Volt.Ide.Twincat/Ide/TcObjectModel.cs:503` (`DeclarationText ?? ""`), `:510-515` (`ImplementationText ?? ""`, a
     missing member → `""`).
   - Identity defaults: `CodesysObjectModel.cs:101` (`GuidOf` → `Guid.Empty`), `:102` (`HandleOf` → `0`).
   - Library reference defaults, CODESYS (finding 7 names the TwinCAT ones; added after review):
     `Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs:104` (`Namespace … as string ?? ""`), `:105`
     (`SystemLibrary … is bool b && b` — missing reads false), `:110` (a placeholder's resolution: `EffectiveResolution`,
     else `DefaultResolution`, else `""`), `:94` (`RefDisplayName`: `Name … ?? ""`).
   - Task fields, CODESYS: `Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs:191`
     (`Str(o) => Convert.ToString(o)?.Trim() ?? ""`) — every task field read through it defaults a missing member to
     `""`: `kind_of_task`, `interval`, `interval_unit`, `priority` (`:182-185`) and the watchdog's `time`,
     `time_unit`, `sensitivity` (`:171`); `:165-166` the event read (`Convert.ToString(…)`, a missing member → `""` →
     no event — and the external-event fold, finding 4).
   - Whitespace body → null: `Volt.Ide.Codesys/Driver/CodesysDriver.Content.cs:118-119` (`BodyText`), TwinCAT
     `BeckhoffDriver.Content.cs:313` (`ReadBody`: `IsNullOrWhiteSpace(raw)` → no body), `Volt.Ide.Twincat/Ide/TcArchive.cs:48`, `:92`.
   - `AbstractMemberFold`: `Volt.Engine/Format/St/AbstractMemberFold.cs:34-52`, applied at
     `Volt.Engine/Sync/Materializer.cs:171`, `Volt.Engine/Sync/PushedText.cs:50-51`, `PushService.cs:1321`, `:1406`.
9. **Cosmetic, each to measure or spell.**
   - Trailing newlines trimmed: `CodesysDriver.Content.cs:45` (`declaration.TrimEnd('\n')`), `:118-119`;
     `ItemContent.cs:122-125` (`AccessorDeclaration.Keep`); `Volt.Engine/Format/St/StReader.cs:493`, `:517`, `:944`;
     `PushService.cs:1936`.
   - Members re-sorted: `Volt.Engine/Format/St/StWriter.cs:51-53` (`OrderBy(KindOrder).ThenBy(Name, Ordinal)`).
   - Sibling order not spelled: CODESYS `meta.OrderedSubObjects` / `Index` (read by nothing); census gives no order
     distribution (the archive's `SubObjectGuids` order is 1.3's `member-order` / `folder-order` measurement).
   - Empty folders, descriptor values flattened/dropped: `Volt.Ide.Codesys/Ide/CodesysObjectModel.Descriptors.cs:225-248`
     (`FacetDescriptor` — `Descriptor.Flatten`).
   - Device name "first that answers": `CodesysObjectModel.Descriptors.cs:28-38` (`Field(o, params names)`).

### What the census adds (not in the proposal)

- **Per-object build properties on members** (7 excluded methods, census 2) — the carrier must sit on `Member` too
  (the proposal says so; now counted).
- **Online-change memory reserve** (`MemoryReserveForOnlineChange = 200`, 15 POUs) and **POU images**
  (`POUImageProperty`, 2 × 449 KB) — object properties the proposal's list (`%EXCLUDE_FROM_BUILD`, `%EXTERNAL`,
  `%LINK_ALWAYS`, `%COMMENT`, `%NETVAR`) does not name.
- **A GVL linked to an external file** (`FileLink`, 1) — a GVL whose content the IDE re-exports before compile.
- **NetVarProperties on a plain `GVLObject`** (the sender, 1) — not only the `NVLObject` class.
- **Task Configuration system events** (1, lenze) — a project object no item carries.
- **Embedded files** (`EmbeddedFileObject`, 2, pro) — warned, never an item.
- **Library item flags** `LinkAllContent` (5) and `QualifiedOnly` (1), over all 264 items.
- **The text list a text-list enum archives beside its declaration** (finding 3; 109 rows over 3 enums) — what a
  plain-DUT create discards.
- **The TwinCAT object-property archive** (`<ObjectProperties><XmlArchive>`, an `SFCProperty` on 1 POU + 1 action) —
  the TwinCAT side of the `ObjectProperties` carrier has a witness (finding 13).
- **Device `Disable`** (2, bak) — the `.device` descriptor does not carry it.
- **`DocumentationProperty`** (the object comment) and **`ObjectAccessProperty`** (per-object rights) exist in SP21
  with 0 corpus occurrences.

### Docs that contradict the code (for 4.1)

`packages/volt-cli/ARCHITECTURE.md:142-148` (the wire "keyed by bare item name … collapse … a non-issue" — the
CLAUDE.md invariant says the opposite: FULL name on the wire), `:153-156` (exclude-from-build not implemented),
`:212` ("accessor shape round-trips byte-identically … on both bridges" — TwinCAT reads interface-accessor
presence only), `:225` ("Round-trips are lossless"); `docs/items.html:129` and `:233` ("both vendors answer
identically", "Both drivers emit identical wire kinds") — false for stub manifests and library `SYSTEM`;
`docs/wire.html:18` ("both vendors answer identically"). `docs/driver.html` makes no such claim in prose (grep
2026-10-13); its "identical across vendors" (`:118`) is about `DriverBase`.
