> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

# Design — bridge-one-to-one

> **State.** §1 (step 1, tasks 1.1-1.3), §2 (step 2, tasks 2.1-2.3) and §3 (step 3, tasks 3.1-3.5) hold the DECISIONS. §0.1 / §0.2 (step 0) hold MEASUREMENTS only; a
> "candidate" there is decided in §1.

## 1. Design (decided 2026-10-13, step 1: tasks 1.1-1.3)

**Target.** Every vendor member is SPELLED, a MEASURED CACHE, or REFUSED BY NAME. Default spelled. `[n]` = §0.1 census
count over the six corpora; a `vendor-facts` fact is cited by its row id (`packages/volt-cli/scripts/vendor-facts.table.ts`,
recorded in `vendor-facts.<vendor>.json`, §1.3).

### 1.2 The contract (decided first: the table below names its forms)

**The carrier — a closed, typed `ObjectProperties` record on `ItemContent` and `Member`, spelled as `%`-lines, the
directive form `%FOLDER` already is.** Each property is a named field; the vendor-neutral name is the text form; a
driver that reads a vendor member no field names refuses the ITEM by name (pull: listed unreadable with the member's
name; this is also the completeness oracle's failure, 2.1). Rejected: `{attribute …}` pragmas in the declaration
(CODESYS compiles them — the property would become code); a sidecar file per item (two files per wire key); an open
key/value bag mirroring the vendor archive (vendor representation above the seam, and the vendors' values differ for
the same class — `SFCProperty` 3.4.2.0 vs 4.4.0.0).

```csharp
// Volt.Engine/Item/ObjectProperties.cs — one record, vendor-neutral; null/false/empty = the line is absent.
public sealed record ObjectProperties(
    ObjectClass? Class,                       // %CLASS …           null = the kind's plain class
    bool ExcludeFromBuild,                    // %EXCLUDE_FROM_BUILD
    bool LinkAlways,                          // %LINK_ALWAYS
    bool External,                            // %EXTERNAL
    bool EnableSystemCall,                    // %ENABLE_SYSTEM_CALL
    int OnlineChangeReserve,                  // %ONLINE_CHANGE_RESERVE <n>      (0 = absent)
    string? CompilerDefines,                  // %COMPILER_DEFINES '<text>'
    IReadOnlyList<string> Undefines,          // %UNDEFINE '<name>'             one line each
    string? Comment,                          // %COMMENT '<text>'
    bool ParameterList,                       // %PARAMETER_LIST
    IReadOnlyList<NetVarSetting> NetVar,      // %NETVAR <Key>: <value>         one line each; WITHOUT %CLASS NVL = a sender
                                              //   GVL's NetVarProperties, UNDER %CLASS NVL = the receiver's own members
    FileLink? FileLink);                      // %FILE_LINK <LinkType> '<path>'
public sealed record ObjectClass(string Word, string? Argument);   // CHECK CheckBounds · PERSISTENT · TEXTLIST_ENUM · NVL
public sealed record NetVarSetting(string Key, string Value);      // the vendor member name, its value as the vendor renders it
public sealed record FileLink(string LinkType, string Path);
// ItemContent(…, ObjectProperties Properties)  and  Member(…, ObjectProperties Properties): REQUIRED, never defaulted —
// a driver that has not read them cannot build the record (no `= ObjectProperties.None` parameter default).
```

`ObjectProperties.None` exists for a kind that has no vendor carrier at all (a task, a library reference, a device —
their members travel in their descriptor, below); a source driver never passes it for an object it did not read.

**Grammar** (one EBNF for the St reader, the St writer and the LSP's `frontend/syntax/format`):

```
props      = { prop-line } ;                       (* in the order of the table below; each key at most once,
                                                       except %UNDEFINE and %NETVAR, which repeat in vendor order *)
prop-line  = "%" key [ " " value ] newline ;       (* the line opens with "%" + a KEY, nothing before it, and the key
                                                       ends at a space or the line's end; any other "%…" line is CODE *)
key        = "CLASS" | "EXCLUDE_FROM_BUILD" | "LINK_ALWAYS" | "EXTERNAL" | "ENABLE_SYSTEM_CALL"
           | "ONLINE_CHANGE_RESERVE" | "COMPILER_DEFINES" | "UNDEFINE" | "COMMENT" | "PARAMETER_LIST"
           | "NETVAR" | "FILE_LINK" ;
value      = class-value | integer | st-string | netvar | file-link ;
class-value= word [ " " word ] ;                   (* CHECK <CheckFunctionSelection member> | PERSISTENT | … *)
st-string  = "'" { st-char } "'" ;                 (* an ST STRING literal: $-escapes ($', $$, $N, $T, $R, $L, $hh), one line *)
netvar     = name ":" " " text ;                   (* the vendor member name, then its value as the vendor renders it *)
file-link  = word " " st-string ;
```

* **What is a property line (gate 1, review)**: ONLY a line that opens with `%` followed by one of the closed keys
  above (or `FOLDER`), the key ending at a space or the line's end — exactly how `StReader.FolderOn` (`:1181`) tells
  `%FOLDER ` today. Every other line that opens with `%` is CODE: valid ST opens lines with `%` — a direct-address
  assignment `%QB1 := x;`, `%qx0.0 := TRUE;` (the corpora hold 4: bakon-nano `OutputControl.pou:50-54`) — and such a
  line can stand exactly where properties are peeled (a body's first line, under `IMPLEMENTATION`). So there is no
  "unknown key" and no "lower-case key" refusal: `%QB1` and `%class` are code, which the compiler judges. A direct
  address can never collide with a key (IEC addresses are `%I` / `%Q` / `%M` + a size letter or a digit; no key is
  `I`, `Q` or `M` followed by one of those). The LSP's `readPropertyLine` uses the same closed list.
* **Order**: `%CLASS` first, then `%FOLDER` (a member's), then the keys in the grammar's order. One canonical
  spelling: the writer emits exactly that; the reader refuses another order, a repeated key and a value on a flag
  (or a flag-less key with no value), each by line (the LSP reports the same, as it reports a misplaced `%FOLDER`
  today).
* **Placement** — `%FOLDER`'s rule, extended to items: directly under the object's `IMPLEMENTATION` line (an item's or
  a member's body), else closing its declaration (a DUT, a GVL, an interface, a property, an interface member, an
  `IMPLEMENTATION NONE` member's declaration — the `PeelFolderClosing` site). Anywhere else the push refuses the line
  by name (`StReader.RefuseLinesInDeclarations`), as it refuses a misplaced `%FOLDER` today.
* **A flag's absence** is the value measured on every object that has no such vendor property (false / 0 / empty); the
  READ still requires the vendor member present wherever the vendor archives it — a `BuildProperty` whose member is
  missing refuses its item by name (no `?? false`).
* **Presence of a defaulted carrier** (an object with a `BuildProperty` whose seven members are all default, 31 of the
  56, vs an object with none): not spelled — decided by the completeness oracle (2.1): a create without the property
  must read back every member with the same value, and the build must answer the same; if either differs, a
  `%BUILD_PROPERTIES` flag is added (then a design change recorded here).
* LSP: `frontend/syntax/format/folder.ts` generalizes to `object-properties.ts` (`peelProperties` under the boundary,
  `readPropertyLine` + `closesDeclaration` at the declaration's end, `reportMisplacedProperty`), with the same tests
  `folder.test.ts` has, one per key; the analyzer ignores the lines (they are not code).

**Migration.** A format extension: a re-pull writes the new lines. An OLD text lacks them and would push "not
excluded" over an excluded object, so the binding records the text-format version (`.git/volt` `format: 2`) and a push
from an older one refuses by name ("re-pull: the text predates object properties"). New forms go to the owner in the
close report (the list at the end of 1.1).

**Task descriptor** (`TaskDescriptorFormat`): labels added — `External event: <name>` (its own field; the event fold
is deleted), the watchdog's three members spelled as the vendor holds them, enabled or not — `Watchdog: <time>
<unit> (sensitivity <n>)` and, disabled, `Watchdog: off <time> <unit> (sensitivity <n>)` (measured kept behind the
flag, the UNIT included: §1.3 `watchdog-off-values`, `123 µs` / `3` across a reload), `Calls: A // <comment>, B` (a call's comment after `//`, only when non-empty), and one label per
other `TaskObject` member only where it differs from the value measured on 13/13 (`Core -1`, `Core2 -2`,
`TaskGroup 'IEC-Tasks'`, `AllowEmpty false`, `Implicit false`, `WithinSPSTimeSlicing true`, `SynchTask ''`) — the
label then states the vendor value (`Core: 1`). A non-empty `*Parameters` list (0 of 13) refuses the task by name.

**One watchdog spelling (gate 1, review)**: `<time>` and `<unit>` are two vendor members and are spelled as two
tokens, each exactly as the vendor holds it — `<unit>` is never implied by a default (`3200 µs` must not push back
as `3200` in `ms`, a 1000× change) and never dropped after a `T#` literal (`Descriptor.Unitize`'s two folds are
deleted for the watchdog); an EMPTY member is spelled `''` (the census's CTP watchdog — time `''`, unit `ms`,
sensitivity `1`, disabled — reads `Watchdog: off '' ms (sensitivity 1)`; the one task with unit `""` reads
`… <time> '' …`). Units measured: `ms` ×8, `µs` ×4, `""` ×1. A bare `Watchdog: off` is the TwinCAT form only (its
task has no watchdog member, C36); on CODESYS a bare `off` is refused by name (the values behind the flag are content).

**Transitions**: a standalone `TransitionObject` (0 in the corpora) is refused by name — a deviation from task 1.2's
member blocks, recorded "niche: accepted loss (0 occurrences in the corpora)"; the embedded ones travel inside the
unsupported SFC body, whose `SFCProperty` is refused with it (below).

**Re-type / rename** keeps the object: a rename goes through the vendor's rename (GUID kept); a re-type of a member
only where the vendor keeps the object (C2l: a class never changes in place) — so a re-type is refused by name, never
delete + create. `abstract-member-equivalence` (§1.3) makes METHOD ↔ METHOD ABSTRACT no re-type: the class follows the
text (below).

### 1.1 The disposition table

**Every object (both vendors).**

| member | disposition |
|---|---|
| name | the file / member name (identity, CLAUDE.md invariant) |
| CODESYS `meta.ParentGuid` + `SVFoldersProperty`; TwinCAT the tree path / `.plcproj` folder | spelled: the folder (file path; a member's `%FOLDER`) |
| object GUID (`meta.Guid`, TwinCAT `@Id`) | NOT spelled — vendor-minted IDENTITY, not content: kept by every in-place write, rename and move (C2n), new on every create on both vendors (a create cannot be told a GUID through Volt's paths). **Owner decision, default named:** stays unspelled; a migration into another project mints new GUIDs as the IDE's own copy/paste does |
| `meta.TypeGuid` / `EmbeddedTypeGuids` | derived from the class (`%CLASS` / the kind) |
| `meta.Timestamp` [409 distinct of 436], `UniqueIdGenerator`, `LineInfoPersistence` on every text aspect, TwinCAT `<LineIds>` [8] | MEASURED CACHE (`editor-caches`): never written, never read into the text |
| sibling ORDER in a folder | CODESYS: STORED — creation order, kept across reload (`folder-order`: `Zed, Abc, Sub, Mid`); TwinCAT: DERIVED — folders first, then by name, before and after reload (`Sub, Abc, Mid, Zed`; `SubObjectsSortedByName True` 2/2). No text place for it (one file per item). **Owner decision, default named:** not spelled — a create appends, as the IDE's own Add Object does; CODESYS's stored order recorded as a known divergence until the owner decides |
| member ORDER inside an item | CODESYS: STORED — creation order, kept across reload (`member-order`: `Zeta, Mid, Alpha, Beta`); TwinCAT: DERIVED — by name, kind-blind (`Alpha, Beta, Mid, Zeta`). Spelling CODESYS's order would give one declaration two texts (the spec's wire-parity requirement). **Owner decision, default named:** not spelled — the text keeps its one canonical order (`StWriter` kind, then name), CODESYS's stored order recorded as a known divergence; a create appends |
| declaration / body TEXT, every character | stored verbatim, trailing newlines included (`trailing-newline-cache`, BOTH vendors: `…END_VAR\n\n\n` and `…END_VAR` are both kept across reload, and both pull identically today — a fold): SPELLED — the text between boundaries is the vendor text verbatim plus exactly ONE separator newline before the next boundary/END line; the reader strips exactly one. Every `TrimEnd('\n')` of §0.2 finding 9 is deleted |

**Object properties (CODESYS `meta.Properties`, TwinCAT `<ObjectProperties>`).**

| property · member | disposition — text form |
|---|---|
| `BuildProperty.ExcludeFromBuild` [11 true + 4 folders] | `%EXCLUDE_FROM_BUILD`; on a FOLDER [4]: refused by name (folders are not items) — listed for the owner |
| `BuildProperty.LinkAlways` [3] | `%LINK_ALWAYS` |
| `BuildProperty.External` [0] · `EnableSystemCall` [0] | `%EXTERNAL` · `%ENABLE_SYSTEM_CALL` |
| `BuildProperty.MemoryReserveForOnlineChange` [15 × 200] | `%ONLINE_CHANGE_RESERVE 200` |
| `BuildProperty.CompilerDefines` [0 on items; 2 on Applications] · `Undefines` [0] | `%COMPILER_DEFINES '…'` · `%UNDEFINE '…'`; on an Application (not an item): refused by name in the pull report |
| `DocumentationProperty.Documentation` [0] | `%COMMENT '…'` |
| `NetVarProperties` on a `GVLObject` [1 sender] | `%NETVAR <member>: <value>` per member (Acknowledge, Checksum, EventVariable, Interval, ListIdentifier, MinimumGap, PackVariables, ProtocolName, TransmitCyclic, TransmitOnChange, TransmitOnEvent, TaskName, ImportFileName, ProtocolParameterValues as `<key>=<value>` pairs); `GuidTaskStartSlot` / `GuidTaskEndSlot`: vendor-minted identity (as the object GUID). Create: `SenderGVLObjectFactory` then the members written (`create-each-class`: the factory makes a `GVLObject` with `NetVarProperties`) |
| `GVLObject.ParameterList` [0] | `%PARAMETER_LIST` — creatable (`ParameterGVLObjectFactory`, `create-each-class`) |
| `FileLink` [1] (`LinkType`, `FileName`, `lTimeStamp`) | `%FILE_LINK ExportBeforeCompile '<path>'`; `lTimeStamp`: cache (the file's mtime) |
| `POUImageProperty` [2 × 449 KB] | NOT SPELLED — niche: accepted loss (2 occurrences in the corpora; gate review of step 4b, finding 2). A binary image has no text form: the pull logs the item + property at Warn, an in-place push never writes it (the image stays), and a create from the text makes the POU WITHOUT it — no line marks it, so a create cannot refuse what the text does not show (a marker line would be a new text form the owner has not approved). The completeness oracle's known list carries it under that reason |
| `SFCProperty` [2 + TwinCAT 2], `CFCProperty` [10], `SFCLibraryProperty` [0], `TransitionMonitoringProperty` [0], `ActionObjectDuplicationModeProperty` / `TransitionObjectDuplicationModeProperty` [0] | REFUSED by name — they belong to an UNSUPPORTED body (SFC / CFC) and travel with it (the body is never written) |
| `ObjectAccessProperty` [0] (rights) | REFUSED by name |
| `DeviceProperty` [186], `ModuleType` [8], `ImagePoolPropertiesObject` [9], `ApplicationInfoObjectProperty` / `BaseLibrariesProperty` / `MathLibrariesProperty` / `StringLibrariesProperty` / `VisualProperty` [≤1] | properties of NON-items (device, image pool, application, library manager, visualization): carried by their descriptor where it exists (device below, library manager below), else refused by name in the pull report |
| every other loaded property class (CNC, CAM, Composer, C-source, Profibus, Profinet, DataSources, Trend; §0.1 0-occurrence table) [0] | REFUSED by name (0 in the corpora; "niche: accepted loss (0 occurrences)") |

**TwinCAT and the object-property lines (gate 1, review).** The table above is CODESYS's `meta.Properties`. TwinCAT
has no measured member for any of the keys: its corpus holds 0 build properties (`.plcproj` `Compile` entries carry
only `SubType Code`, 13/13), `<ObjectProperties>` holds only the SFC archive (refused with its body), and no
`vendor-facts` row has read or written a TwinCAT exclude-from-build, link-always or comment. So, on TwinCAT, until a
fixture and a probe row measure the vendor's member (tasks 2.2 / 3.3 — the census names `.plcproj`
`ExcludeFromBuild` / `LinkAlways` as the candidates):

| direction | TwinCAT disposition |
|---|---|
| PUSH of a text carrying `%EXCLUDE_FROM_BUILD`, `%LINK_ALWAYS`, `%EXTERNAL`, `%ENABLE_SYSTEM_CALL`, `%ONLINE_CHANGE_RESERVE`, `%COMPILER_DEFINES`, `%UNDEFINE`, `%COMMENT`, `%PARAMETER_LIST`, `%NETVAR` or `%FILE_LINK` | REFUSED by name, the item and the key ("TwinCAT: no measured member for %KEY") — never dropped, so a CODESYS text pushed to a TwinCAT binding cannot silently lose its exclude-from-build |
| PULL of an item whose `.plcproj` `Compile` entry holds any child element other than `SubType`, or whose `<ObjectProperties>` holds anything but the SFC archive | the item REFUSED by name (listed unreadable with the element's name) — an excluded TwinCAT object never reads as a built one |
| a key measured later | promoted to spelled by the probe row that measures it (a design change recorded here), both directions at once |

**Classes (`%CLASS`).** The vendor's class is spelled where the text cannot tell it; a create makes it or refuses by name.

| class [n] | disposition (create: `create-each-class`, §1.3) |
|---|---|
| `POUObject` [436], `POUMethodObject` [1288], `PropertyObject` [373], `PropertyAccessorObject` [340], `ActionObject` [47], `DUTObject` [287], `InterfaceObject` [97], `GVLObject` [60], `FolderObject` [464] | the kind's plain class: no `%CLASS` line |
| `InterfaceMethodObject` [182], `InterfacePropertyAccessorObject` [112] | derived from the parent (an interface's member): no line |
| interface accessor DECLARATION (gate 1, review; `tc-itf-accessor-decl`, D21, D41) | CODESYS: spelled verbatim (the corpora pull 93 of 95 `GET`s empty, 2 with `VAR`/`END_VAR`; D41 measured a scripting-made one empty and writable). TwinCAT: the IDE stores `PUBLIC` / `VAR` / `END_VAR` on every interface accessor it creates (measured, `tc-itf-accessor-decl`) and NO automation path writes or even reads it (D21: `0x800706BE` on `DeclarationText`), so that stored text is a MEASURED CONSTANT of the vendor, like `POULevel Standard`: it is spelled as the EMPTY declaration — the text a CODESYS interface accessor made by the same push holds (D41) — so the same interface pulls byte-identically on both vendors (the spec's wire parity); a TwinCAT accessor whose stored declaration (read from the `.TcIO`) is anything else REFUSES the item by name on pull, and a pushed non-empty interface accessor declaration is refused by name on TwinCAT (`InterfaceAccessorGuard.RefuseIfChanged`, today) and written on CODESYS. Neither a wire divergence (the `PUBLIC` line spelled on one vendor) nor a silent fold (an unmeasured text dropped). The parity gate 2.3 asserts it |
| `POUObjectCheckFunction` [15] — `SpecialFunc` (= `KindOfCheckFunction`, 10 of the 10 `CheckFunctionSelection` values seen) | `%CLASS CHECK <CheckBounds|CheckPointer|CheckRangeSigned|CheckRangeUnsigned|CheckLRangeSigned|CheckLRangeUnsigned|CheckDivInt32|CheckDivInt64|CheckDivReal32|CheckDivReal64>`; created as the vendor class with its `KindOfCheckFunction` (measured: class + kind kept across reload, build clean). TwinCAT (`tc-special-classes`, §1.3; gate 1): the PULL refuses by name any `SpecialFunc` other than `None` — no TwinCAT check function was ever observed (8/8 loaded POUs `None`, the XAE's implicit-checks dialog unmeasured), so its value vocabulary is unknown and is not guessed; the PUSH refuses `%CLASS CHECK` only where it would CREATE the class or CHANGE an existing object's class (no automation path makes it) — an UPDATE of an object that already holds that class is not refused (it cannot arise until the pull spells one; when a fixture measures the vocabulary, the pull spells it and updates keep the class, as CODESYS's do) |
| `VarPersistentObject` [4] | `%CLASS PERSISTENT`; update / rename / move keep it. CREATE (gate 1, one decision): the factory path is measured creatable (`VarPersistentObjectFactory`, `create-each-class`), but the list's `dymmattributecount` is unmeasured (members table below), so step 3 builds the create through that factory ONLY if the completeness oracle 2.1 (which runs before step 3) reproduces a re-created list — declaration and build — and otherwise refuses the create by name. Either way a SECOND one per application is refused by the vendor ("Cannot insert … below 'Application …'") — the push refuses it by name first |
| `TextListEnumerationObject` [3] | `%CLASS TEXTLIST_ENUM`; created by `TextListEnumerationObjectFactory`; its text list rows are a MEASURED CACHE (`textlist-enum-rows-derived`; `create-each-class` for the first write, `textlist-enum-edit` for Volt's own later edits, gate 1): one row per enumerator, `TextID` = the enumerator, `TextDefault` = its initializer text (`""` when it has none), plus ONE trailing row `""`/`""` — `(Red := 0, Green := 5, Blue)` gives `Red/0`, `Green/5`, `Blue/""`, `""/""` (4 rows, both columns read on every row). A push that REMOVES `Green` leaves `Red/0`, `Blue/""`, `""/""` (3 rows: `Green`'s row gone, not emptied); one that then RENAMES `Blue` → `Cyan` rewrites that row's ID (`Cyan/""`); after the reload the same 3 rows — rebuilt from the declaration, nothing of `Green` kept, and `RemovedTextListEntries` stays EMPTY (count 0) through every edit and the reload. So the rows hold nothing the declaration does not, and Volt's own remove / rename never fills `RemovedTextListEntries`. Language texts [0] and `RemovedTextListEntries` [0]: refused by name if non-empty — a non-empty one comes only from the vendor's own text-list editor (translations, an entry removed there), content Volt has no text form for |
| `NVLObject` [1] (receiver: `ImportFromFile`, `ImportFileName`, `ImportNetVarProperties`, `TaskName`, `SenderGVLName`, `ReferenceGuidGVL`) | `%CLASS NVL` + its members as `%NETVAR` lines — one meaning per context (gate 1): a `%NETVAR` line without `%CLASS NVL` is a SENDER GVL's `NetVarProperties` member; under `%CLASS NVL` it is a RECEIVER member (`ImportFromFile`, `ImportFileName`, `TaskName`, `SenderGVLName`, and the imported sender settings as `ImportNetVarProperties.<member>`). `ReferenceGuidGVL` and `GuidTaskSlot` are NOT spelled: vendor-minted GUIDs (the sender list's identity, the task slot's), under the object-GUID rule above — kept by every in-place write, never written by Volt; a CREATE is refused by name — its factory needs its wizard (`NVLObjectFactory.Create()` → NullReferenceException, measured); update / rename / move keep it (C2n). `ImportFileTimestamp`: cache (the import file's mtime) |
| `AbstractPOUMethodObject` [10] | derived from the text: `abstract-member-equivalence` measured it the same thing to the compiler as a `POUMethodObject` with ABSTRACT text (signature `Method/Abstract` both, C0431 both when unimplemented, both pull `IMPLEMENTATION NONE`); the only difference is the body slot, which `IMPLEMENTATION NONE` spells. A create of `METHOD ABSTRACT` with no code makes the vendor's abstract class (creatable, measured); `AbstractMemberFold` stays — it is now a measured equivalence, not a guess (proposal finding 8) — NARROWED (gate 1) to a body that is null or EMPTY (nothing between the boundary and the END line but the one separator newline, as `abstract-member-equivalence` measured: the slotted `A1` was created with no body text). Its `HoldsNoCode` = `IsNullOrWhiteSpace` (`AbstractMemberFold.cs:51`) would fold a whitespace-only body (`\n\n` stored in a `POUMethodObject`'s ST slot) to `IMPLEMENTATION NONE` and erase stored characters, against the "every character" row; such a body is spelled verbatim under `IMPLEMENTATION ST`, like any other stored whitespace. No fold of stored content remains |
| `AbstractFunctionblockPropertyAccessorObject` [0], `TasklocalGVLObject` [0], `TransitionObject` [0] | REFUSED by name ("niche: accepted loss (0 occurrences in the corpora)") |

**Members of the source classes (CODESYS archive names; §0.1 tables).**

| class · member | disposition |
|---|---|
| POU `POULevel` [Standard 436/436 POUs] | the one measured value: no line; any other value refuses the item by name. A check function (`POUObjectCheckFunction`, 15) does NOT archive it — its archive is `Implementation`, `Interface`, `SpecialFunc` (measured SP21 Patch 4, step 4b; the 451 once counted here included them), so it holds no `POULevel` to require |
| POU / GVL `AddAttributeSubsequent` [false 496/496] | same: no line; true refuses by name |
| POU `ChildObjectGuids` [empty 436/436] | same: non-empty refuses by name |
| POU `SpecialFunc` | `%CLASS CHECK …` (above) |
| `Interface` / `Implementation` aspects | the declaration / the body (and its language, `IMPLEMENTATION <LANG>`) |
| NWL `BranchCounter` / `ValidIds` / `DefaultViewMode` / `ImplId` | `ld-fbd-coverage`'s (out of scope here) |
| `Implementation.ParameterInitializationMethodGenerator` [null 3/3] | null measured on every occurrence: non-null refuses by name |
| accessor `IsGet` [340 + 112] | the `GET` / `SET` keyword, READ from `IsGet` (the name rule `RefineAccessor` deleted) |
| `VarPersistentObject` `guidinit` / `guidcyclic` | vendor-minted identity (as the object GUID) |
| `VarPersistentObject` `dymmattributecount` [33/6/100/14] | CACHE candidate (a counter the vendor keeps): measured by the completeness oracle 2.1 (a re-created list reproduces the declaration and builds); the create decision follows it (the classes table's `VarPersistentObject` row: factory create if 2.1 reproduces, else refused-on-create); never refused on update |
| `VarPersistentObject` `persvarlist` [null 4/4] | null measured: non-null refuses by name |
| `FolderObject.StructuredViewGuid` | vendor-minted |
| `TaskPOUCallObject.Commet` [sic], `Id` | `Commet`: spelled as the call's comment (`Calls: A // …`) where it differs from `PouObject.Comment` — measured equal (`""` 19/19); `Id`: vendor-minted |

**Tasks (`TaskObject` [13], TwinCAT `TaskDef` / `.TcTTO`).**

| member | disposition |
|---|---|
| `Kindoftask`, `Interval`, `Priority`, `Event`, watchdog enabled/time/unit/sensitivity | spelled (today's labels) |
| `ExternalEvent` [0] | `External event:` — its own label (the fold into `Event:` deleted) |
| watchdog values while DISABLED [3] | `Watchdog: off <time> <unit> (sensitivity <n>)` — measured KEPT behind the flag across reload, the non-default unit too (`watchdog-off-values`: `123` `µs` / `3` stayed); an empty member `''` (§1.2 "One watchdog spelling") |
| `PouList[].Comment` [19 × ""] | `Calls: A // comment` |
| `Core`, `Core2`, `TaskGroup`, `AllowEmpty`, `Implicit`, `WithinSPSTimeSlicing`, `SynchTask` [constant 13/13] | a label only where the value differs from the measured one (above) |
| `CustomParameters` / `IntervalParameters` / `EventParameters` / `ExternalEventParameters` / `FreewheelingParameters` [empty 13/13] | non-empty refuses the task by name |
| `TaskGuid`, `EventPOUGuid` | vendor-minted |
| Task Configuration `alSysEventList` [1 system event, len], `StackSize` / `UseConfigurableStackSize` [constant 5/5] | the Task Configuration is no item: a system event is REFUSED by name in the pull report (listed for the owner); non-default stack settings likewise |
| TwinCAT `TaskDef` (`watchdog-off-values`, TwinCAT `taskdef`: `Priority`, `CycleTime`, `AmsPort`, `AutoStart`, `IoAtBegin`, `ExceedWarning`, `CreateSymbols`, `ExtSync`, `TickModulo`, `InputUpdatePreTicks`, `DisableFpExceptions`, `WatchdogStackCapacity`, `CpuAffinity`) | `Priority` / `CycleTime`: today's labels; `AmsPort`: vendor-assigned; every other member a label of its own where it differs from the value measured on the corpus task (`true`, `false`, `0`, `false`, `false`, `0`, `0`, `false`, `0`, `#x0`). TwinCAT HAS NO WATCHDOG member: `Watchdog:` other than the bare `off`, an event and an external event refuse a TwinCAT push by name; the hard-coded `Type: Cyclic` / `Watchdog: null` (`TcTaskSchedule.cs:44/62`) is replaced by that refusal |
| TwinCAT `.TcTTO` `TaskFBGuid`, `CycleUpdate`, `PostCycleUpdate`, `Fb_init`, `Fb_exit` | vendor-minted GUIDs of the task's implicit objects |

**Library manager (`LibManObject` [9], items [264]; TwinCAT `References`).**

| member | disposition — manifest line |
|---|---|
| `Name` / `Namespace` / `PlaceholderName` / `DefaultResolution` / effective resolution / `SystemLibrary` | today's lines; every `?? ""` / `is bool b && b` default deleted — a missing member refuses the reference by name. TwinCAT `SYSTEM`: per `tc-library-system` (§1.3) |
| `LinkAllContent` [5] · `QualifiedOnly` [1] | `LINKALLCONTENT` · `QUALIFIEDONLY` |
| `Optional`, `HideWhenReferencedAsDependency`, `PublishSymbolsInContainer` [false 264/264], `Params` [null 264/264] | the measured value: no line; another refuses by name |
| `ParameterTable` [3 managers, 24 values] | `PARAMETER <library> <name> := <value>` |
| `PlaceholderRedirectionTable` [193] | `REDIRECT <placeholder> <resolution>` |
| `ResolverGuid`, `Id` | vendor-minted |
| TwinCAT placeholder `VSProperties` `HideReference`, `PublishAll`, `QualifiedlAccessOnly` [sic], `Optional` [`False` on the fixture's 3; gate 1, `tc-library-system`], its `ParameterList` (`Tc2_System`: 6 `PARAM.*`) | read-only measured; which CODESYS member each one IS is not measured (a name match is not a fact), so step 3.3 decides it with a probe row that writes one: until then a TwinCAT reference with any of the four other than `False` refuses by name, and the parameter list is spelled `PARAMETER <library> <name> := <value>` only once 3.3 measures its write (else refused by name). No SYSTEM line on TwinCAT (C37) |

**Non-source items and stubs.**

| member | disposition |
|---|---|
| stub manifest (visualization, text list, image pool, recipe, trace, symbol config, …) | ONE form on both vendors: `ItemKind.EmptyManifest` (`kind\n`); TwinCAT's `Name=` dropped (the name is the file). Their archives are REFUSED by name in the pull report (opaque — Volt never writes them) |
| device `Disable` [2] | `.device` descriptor `Disabled: true`; `Exclude` [0]: `Excluded: true`; the "first that answers" name read deleted (the vendor member is named) |
| `EmbeddedFileObject` [2], `ApplicationObject` [5], `PlcLogicObject` [5], `ProjectInfoObject` [1], `WorkspaceObject` [5] | not items: listed in the pull report by name (unchanged), never written |
| every 0-occurrence object class of §0.1 (alarm, CNC, CAM, Composer, C-source, data sources, redundancy, trend, unit conversion, web/target visu, hidden/transient variants) | REFUSED by name if met ("niche: accepted loss (0 occurrences in the corpora)") |

**TwinCAT files** (the census element table, §0.1).

| element / attribute | disposition |
|---|---|
| `TcPlcObject/@Version`, `@ProductVersion` | the IDE's file-format stamp: written by the IDE on save, never by Volt (cache of the writing IDE) |
| `POU/@Id`, `DUT/@Id`, `GVL/@Id`, member `@Id` | vendor-minted identity |
| `POU/@SpecialFunc` [None 8/8] | per `tc-special-classes` (§1.3) |
| `Declaration`, `Implementation/ST|NWL|…` | the text (verbatim, as above) |
| `LineIds` | measured cache (`editor-caches`) |
| `ObjectProperties` (`SFCProperty` [2], empty [1]) | REFUSED with the SFC body (above); an empty carrier is no property |
| `.plcproj` `Compile/SubType Code` [13/13], `SubObjectsSortedByName True` [2/2], `Folder` | the folder tree; the constants are the measured values |
| `.plcproj` `PlaceholderReference` (`DefaultResolution`, `Namespace`) | the library manifest |

**New text forms, for the owner's close report**: `%CLASS CHECK <check>`, `%CLASS PERSISTENT`, `%CLASS TEXTLIST_ENUM`,
`%CLASS NVL`, `%EXCLUDE_FROM_BUILD`, `%LINK_ALWAYS`, `%EXTERNAL`, `%ENABLE_SYSTEM_CALL`, `%ONLINE_CHANGE_RESERVE <n>`,
`%COMPILER_DEFINES '…'`, `%UNDEFINE '…'`, `%COMMENT '…'`, `%PARAMETER_LIST`, `%NETVAR <member>: <value>`,
`%FILE_LINK <type> '<path>'`; task labels `External event:`, `Watchdog: off <time> <unit> (sensitivity <n>)` (the enabled form `<time> <unit>` too; an empty member `''`),
`Calls: A // <comment>`, `Core:` / `Core2:` / `Task group:` / `Allow empty:` / `Implicit:` / `Within SPS time slicing:` /
`Synch task:` (only off their measured value); manifest lines `LINKALLCONTENT`, `QUALIFIEDONLY`, `PARAMETER`,
`REDIRECT`; device `Disabled:` / `Excluded:`; and the text itself verbatim (trailing newlines kept).
**Owner decisions with a named default** (proceeding on the default): the object GUID unspelled; folder sibling order
unspelled; CODESYS member insertion order unspelled (the text keeps its canonical order).

**Refused by name, collected** (pull warns item + property; a push never writes it; a create that would need it
refuses): the SFC/CFC properties with their bodies, `ObjectAccessProperty`, a folder's
`BuildProperty` [4], Task-Configuration system events [1], `EmbeddedFileObject` [2], standalone transitions [0], NVL
create [1], a second persistent list per application, the 0-occurrence classes and properties, and every member whose
measured constant a project breaks; on TwinCAT (gate 1) every object-property line and any `.plcproj` build entry
but `SubType`, a `SpecialFunc` other than `None`, a `%CLASS CHECK` create or class change, an interface accessor
declaration other than its measured constant, a library VSProperty off `False`; on CODESYS a bare `Watchdog: off`. Every fallback of proposal finding 8 is deleted: a missing fact refuses by name.

### 1.3 The measurements (vendor-facts rows, recorded 2026-10-13)

Ten rows (the nine task 1.3 names + `editor-caches`, the design's "caches, a row each" as one row of reads; gate 1 added `textlist-enum-edit` and extended `watchdog-off-values`, `tc-library-system` and `member-order`), recorded
by `bun scripts/vendor-facts.ts <vendor> --write --only …` on the change's own instance
(`VOLT_VENDOR_FACTS_INSTANCE=bridge-one-to-one`), CODESYS SP21 Patch 4 on a CodesysTestProject copy, TcXaeShell 15.0 on
a Project14 copy, then re-run without `--write`: the second run agreed fact for fact. Discovery for `create-each-class`
used single-use scratch runscripts (own `--noUI` CODESYS, project copies; not kept). The table gained one vocabulary
item, a design finding of the table's own rule ("if a fact does not fit the vocabulary, that is a design finding"): a
script `create` may name `factory` / `vendorClass` (+ `init`) — CODESYS only, the vendor's own Add Object path — and
the TwinCAT core's XML read now answers an attribute's value (PowerShell's adapter answered `""`). DIALECT rows:
**C2r** (new), **C2s** (new), **C34**-**C37** (new), **C2e** and **D21** (marker + finding).

| row | vendors | DIALECT | measured | decides (§1.1) |
|---|---|---|---|---|
| `create-each-class` | CODESYS | C2r | check function (constructed class + `DoCreate` aspects + `KindOfCheckFunction`), persistent list (factory; a 2nd per application refused by the vendor), text-list enum (factory), sender GVL (factory → `GVLObject` + `NetVarProperties`), parameter list (factory → `ParameterList true`), abstract method (constructed) — each kept as its class across a reload, build clean; NVL factory refused (`NullReferenceException`, needs its wizard). Text-list rows rebuilt from the declaration (4 rows for 3 enumerators: the trailing `""` row) — `textlist-enum-rows-derived` = cache. Today's pull folds every class away | `%CLASS` creates / NVL-create refusal / text-list rows a cache |
| `textlist-enum-edit` (gate 1) | CODESYS (TwinCAT absent: no such class) | C2r | rows `Red/0`, `Green/5`, `Blue/""`, `""/""` (both columns read on every row); a push removing `Green` → `Red/0`, `Blue/""`, `""/""`; renaming `Blue` → `Cyan` rewrites the ID; the same 3 rows after a reload; `RemovedTextListEntries` count 0 throughout | the rows a cache (rebuilt on every write, nothing else kept); a non-empty `RemovedTextListEntries` / language text refuses by name (only the vendor's own text-list editor makes one) |
| `abstract-member-equivalence` | CODESYS (TwinCAT absent: one method class) | C2r | `POUMethodObject`+ABSTRACT ≡ `AbstractPOUMethodObject`: signature `Method/Abstract` both, `C0431` both, clean when overridden, both pull `IMPLEMENTATION NONE`; code under the slotted one: `C0433` at build | the class follows the text; `AbstractMemberFold` stays as a measured equivalence |
| `tc-special-classes` | TwinCAT (CODESYS: `create-each-class`) | C2s | `CheckBounds` by `CreateChild` 603 and `CheckRangeSigned` by the push: `SpecialFunc="None"` in the file, no `SpecialFunc` member in the automation XML | TwinCAT `%CLASS CHECK` refused by name on a create or a class change (never on an update); the pull reads the file attribute and refuses any value but `None` by name (vocabulary unmeasured; gate 1) |
| `tc-dut-create-reload` | TwinCAT | C2e | push-created enum/union/alias/struct on the 606 seed → 605/607/623/606 after reload, same `Id`, same pulled text | the 606 seed stays (finding 6 closed by measurement) |
| `tc-itf-accessor-decl` | TwinCAT (CODESYS: D41) | D21 | push-created interface accessors save `<Declaration>` `PUBLIC` / `VAR` / `END_VAR`; the pull shows presence only | a measured constant of TwinCAT's (no write or read path, D21), spelled as the empty declaration CODESYS holds for the same interface (D41); any other stored text refuses the item by name (§1.1 classes, gate 1) |
| `member-order` | both | C34 | CODESYS creation order kept (`Zeta, Mid, Alpha, Beta`); TwinCAT by name (`Alpha, Beta, Mid, Zeta`). Gate 1: the property is now created with its type on both (`dataType: "INT"`); before, TwinCAT took the driver's vInfo (the body language) as the TYPE (`PROPERTY PUBLIC Beta : ST`, `TcObjectModel.cs:405`, a quirk for 3.3); a TwinCAT 611 create makes no accessors (CODESYS's makes GET/SET) | not spelled (owner decision, default) |
| `folder-order` | both | C34 | CODESYS creation order kept; TwinCAT folders first then by name | not spelled (owner decision, default) |
| `trailing-newline-cache` | both | C35 | both vendors keep `\n\n\n` and no-newline texts verbatim across reload; the pull folds them | SPELLED: text verbatim + one separator newline |
| `editor-caches` | both | C35 | CODESYS `LineInfoPersistence` a key derived from the object GUID, `UniqueIdGenerator` a string, `Timestamp` Int64 — filled by a scripting create, build clean; TwinCAT writes its own `<LineIds>` into the saved file, build succeeds | caches: never spelled or written |
| `watchdog-off-values` | both | C36 | CODESYS: a disabled watchdog keeps time `123`, unit `µs` (set off the default `ms`; gate 1) and sensitivity `3` across reload; the fixture's task as found: disabled, time `''`, unit `ms`, sensitivity `1`; TwinCAT `TaskDef` has 13 members and no watchdog / event | `Watchdog: off <time> <unit> (sensitivity <n>)`, `''` for an empty member; TwinCAT watchdog/event push refused |
| `tc-library-system` | TwinCAT (CODESYS: census) | C37 | no system member on a TwinCAT placeholder (`LibItemName`, `PlaceholderName`, `Namespace`, `RelativePath`, `DefaultResolution`, `EffectiveResolution`); gate 1: the system xpaths (element and attribute) run on EACH of `Tc2_Standard`, `Tc2_System`, `Tc3_Module` and on `References` answer nothing, their `PlcLibPlaceholder` / `VSProperties` subtrees read whole; the fixtures' `.plcproj`s hold no system element (offline) | `SYSTEM` is CODESYS's; TwinCAT's hard-coded `false` deleted, a pushed `SYSTEM` line refused |

## 2. Oracles, red first (decided 2026-10-13, step 2: tasks 2.1-2.3)

**Target.** Before step 3 changes a line, every finding of the proposal (1-8) and every undecided member is a RED test
that names it; step 3 turns them green one by one. A red test is an expected failure (bun `test.failing`; C#
`ExpectRed.Until("<task>", finding)`, a helper that FAILS when its body passes — "finding N holds now, remove the
mark"), so the suites stay green while the debt is visible and a fix cannot leave a stale mark behind.

**2.1 Completeness oracle — the vendor's own archive, before and after, member by member.** Per item kind, on a fixture
object of each class: read archive A (CODESYS: `SerializableValueNames` / `GetSerializableValue` of the object, its
`IMetaObject` and every `IObjectProperty` — the census walk made permanent as a vendor-core `archive` read; TwinCAT: the
saved file's elements and attributes plus its `.plcproj` entry), pull the item over the pipe, then push its text twice
— as an UPDATE (same text onto the object) and as a CREATE (the object deleted, the text pushed under its name in the
same project copy) — re-reading archive B after each. Every member of A is looked up in the disposition table
(`scripts/disposition.table.ts`, §1.1 as data: `vendor → class → member → spelled <text form> | cache <vendor-facts
row> | refused <reason>`): spelled must be equal in B, cache is skipped only when its cited row exists, refused must
have refused the pull or push WITH the member's name; a member the table does not list fails as `<class>.<member>:
undecided`. Runner `scripts/completeness.ts <vendor>` reuses the vendor-facts cores and instance handling (its own
`ide.ps1` instance, `VOLT_VENDOR_FACTS_INSTANCE=bridge-one-to-one`); expected failures in
`completeness.known.ts` keyed `<class>.<member>` with their finding — a listed entry that passes fails the run.
Rejected: a second blank project per vendor (a fixture item references its neighbours' types, so a lone create in an
empty project does not build, and it doubles IDE starts); comparing pulled TEXT only (text → text is blind to exactly
the members the text does not carry — the proposal's whole defect); a new bridge `archive` op (test-only surface on the
shipped wire — the vendor core already reads the IDE).

**2.2 Red tests per finding, two layers** (the volt-cli two-layer rule). FakeIde (`Volt.Engine.Tests`, push/fetch
services): 2.2 adds ONLY the `ObjectProperties` record (§1.2) and a FakeIde slot holding it, so the tests compile and
fail until 3.1-3.5 read and write it — no reader, writer or driver change. One test per finding: class kept on create
(1), re-type/rename keeps the object or refuses by name (2), excluded/link-always round-trip on `ItemContent` and
`Member` (3), `External event:` / call comment / watchdog-off values (4), transition (5, refused by name: standalone 0 in
the corpora), each fallback of (8) refused by name. (6) is closed by measurement (`tc-dut-create-reload`): no test.
Live e2e (`test/e2e/one-to-one/*.test.ts`, `VOLT_E2E_INSTANCE=bridge-one-to-one`): CheckBounds, NVL, persistent list,
text-list enum, abstract member rename, excluded POU, ExternalEvent task, call comment, transition — fixture objects
authored through the vendor's own Add Object path by a single-use authoring script, saved by the IDE and committed
(never hand-edited XML: vendor-serialization identity gate); the NVL (factory refused, C2r) on a copy of the corpus
project that holds `CAN_TO_PLC`, or its test is the create refusal by name.

**2.3 Wire-parity gate — live diff plus an offline twin.** `test/e2e/vendor-parity.test.ts` (both IDEs, already
diffs `sourceText` exactly) gains stub manifest (visualization, text list), library `SYSTEM` and interface-accessor
cases, red-marked. Because that suite needs two IDEs and never runs in CI, each driver's offline tests
(`Volt.Ide.Codesys.Tests` / `Volt.Ide.Twincat.Tests`, their doubles) assert the SAME expected string from one shared
constant per case. Rejected: offline only (doubles assert what we believe the vendor holds — fakes can assert a bug
away); live only (invisible in CI).

**Stays refused by name** (the oracle passes a refusal only when it names the member): NVL create (C2r), TwinCAT
`%CLASS CHECK` on create/class change and any `SpecialFunc` but `None` (C2s), TwinCAT object-property keys and
watchdog/event pushes, standalone transitions, every 0-occurrence class (niche: accepted loss).

**Migration.** None in the text: step 2 adds tests, the record type, the authoring script, fixtures and the runner.
Each step-3 task removes the marks of the findings it closes; 4.2 requires `completeness.known.ts` empty except
entries whose reason is a named refusal or a niche.

### 2.R What step 2 built and measured (2026-10-13, instance `bridge-one-to-one`, CODESYS SP21 Patch 4, TcXaeShell 15.0)

**The oracle (2.1).** `scripts/completeness.ts` + `scripts/disposition.table.ts` (§1.1 as data: spelled / cache / identity /
refused / scope / measure; `*` wildcards; a member not listed fails as undecided) + `scripts/completeness.known.ts`;
the cores gained two reads, `archive` (CODESYS: object + `IMetaObject` + every `IObjectProperty`, flattened in the
census notation, plus `$class` and each `TextDocument.Text`; TwinCAT: the backing file's elements/attributes + its
`.plcproj` `<Compile>` entry) and `objects` (the subject pick); `adopt` takes a guid or the wire kind's classes. Subjects
are a greedy cover of every feature the project holds (item class, member class, property class, non-default build
flag on an item / a member) plus every task. Offline logic: `test/unit/completeness.test.ts` (18 tests). Final runs,
each twice (`--write-known`, then a verify run: 0 unexpected, 0 stale):

| vendor | projects | subjects | failing members (= known) | of which |
|---|---|---|---|---|
| CODESYS | CodesysOneToOne copy (28 objects; CodesysTestProject at the time of this run), Pro2193 copy (3363) | 10 + 18 | **120 over 18 classes** | differs after the create 60 (build properties lost: `ExcludeFromBuild` / `LinkAlways` / `MemoryReserveForOnlineChange` on items AND members, the call comment, the external event, the text list), class lost 4 (`POUObjectCheckFunction`, `TextListEnumerationObject`, `VarPersistentObject`, `AbstractPOUMethodObject` → plain), text differs 16 (every one a folded trailing newline, finding 9), cache unmeasured 18, held-but-not-refused 20 (`POUImageProperty` ×4, the standalone transition ×16), differs after the UPDATE 1 (`Event`: an in-place write of an ExternalEvent task MOVES its event into `Event`, finding 4), create refused 1 (unsupported bodies) |
| TwinCAT | Project14 copy (30 items) | 12 (every source file + the task) | **4 over 4 classes** | `ObjectProperties` (the SFC archive) held but the pull names no `ObjectProperties` ×2, a trailing newline folded ×1, create refused for unsupported/graphical bodies ×1; tasks, DUTs, GVL and ST POUs reproduce every member through an update and a create |

**Measured by the oracle, new** (each a finding for step 3, not a decision taken here): `TextBlobForSerialisation` is
null as the census read every object and holds the WRITTEN TEXT after any scripting write of the document — cited as
cache row `text-blob-serialisation`, which no row measures yet (as `file-link-timestamp` and `nvl-import-timestamp`);
`SVFoldersProperty.ParentObjects` holds the containing folders' GUIDs (a re-made POU-internal folder is a new object) —
identity; `dymmattributecount` (the persistent-list cache candidate) is equal after an update and unmeasurable after a
create today (the create makes a plain GVL) — the decision waits for 3.2's class create, as §1.1 says. CODESYS tasks
reproduce every `TaskObject` member through delete + create EXCEPT the external event and the call comment.
**Not exercised** (no committed fixture holds the class): `NVLObject`, a sender GVL with `NetVarProperties`, a
`FileLink` GVL (bak only, not committed), a parameter list (0 in the corpora) — their red tests are the FakeIde ones.

**The red tests (2.2).** `ObjectProperties` (`Volt.Engine/Item/ObjectProperties.cs`, not yet on `ItemContent`), a
`FakeIde.Item.Properties` slot (kept on in-place writes, not made by a create), `ExpectRed.Until(task, finding, body)`
(`test/shared/ExpectRed.cs`; `VOLT_EXPECT_RED_TRACE=<file>` writes each red body's reason). `Volt.Engine.Tests/one-to-one`:
80 tests, **76 red** (finding 1: 19, 2: 3, 3: 38, 4: 12, 5: 1, 8: 3) + 4 green guards (a `%`-line that is no closed key —
`%QB1`, `%qx0.0`, `%CLASSIC` — stays code; an abstract method's EMPTY body still pulls NONE). Drivers:
`CodesysOneToOneRedTests` 11 red (text-list class, external event, disabled-watchdog values ×2, missing task member,
bare `Watchdog: off`, GET/SET by `IsGet`, whitespace body, null `Text`, guid/handle defaults, library defaults),
`TcOneToOneRedTests` 4 red (TaskDef members, whitespace body, null declaration / implementation). Live
(`test/e2e/one-to-one/one-to-one.test.ts`, `it.failing`): CODESYS **10** (check function class on pull and on create —
asserted on the IDE's own `export_native`, since a `%CLASS` line the push writes into a body reads back verbatim —, text-list
enum, persistent list + second refused, NVL create refused, abstract member rename keeps its object (native GUIDs),
excluded POU, External event, call comment, standalone transition), TwinCAT **2** (`%CLASS CHECK` and
`%EXCLUDE_FROM_BUILD` refused by name — measured accepted today and written into the body as code); all red, verified
live. Fixture objects authored by `scripts/author-one-to-one-fixture.py` into a fixture of their own,
`test/fixtures/CodesysOneToOne.project` (a copy of CodesysTestProject; review fix, below)
(build clean): `CheckDivDInt` (not `CheckBounds`: `create-each-class` creates that one in a fresh copy of this fixture),
`VltOto_TextEnum`, `VltOto_AbsBase.Pick`, `VltOto_Excluded`, `VltOto_ExtTask` (calls `VltOto_ExtCalled`: a task calling
nothing is a build warning), `VltOto_CommentTask` → `VltOto_Called // runs first`, `VltOto_Trans`; NO persistent list
(one per application — `create-each-class` creates one, and a second would turn its committed fact into a refusal).

**Review fixes (step 2, 2026-10-13).** (a) **The authored objects moved out of `CodesysTestProject.project`** into
`test/fixtures/CodesysOneToOne.project`, and CodesysTestProject went back to its committed bytes: that file is the HOST
project of the LSP oracle recorders (`record-exec.ts`'s default, `record:language` through `ide.ps1`) — the check function
`CheckDivDInt` would intercept every DINT division of every recorded fixture (a division by zero answering x/1 instead of
stopping the task) and collide with `implicit-checks.ts`'s own `CheckDivDInt` — and the fixture the committed vendor-facts
rows were measured on (`task-config-survives-delete` / `task-create` / `task-writable` read the Task Configuration's
children: two more tasks would rewrite C22's last-task evidence). The live one-to-one suite and the completeness oracle
serve CodesysOneToOne (`ide.ps1 -Fixture`, `vendor-facts.ts ide(…, "CodesysOneToOne")`). (b) **A known failure is keyed by
member AND kind** (`<vendor>:<class>.<member> — <kind>`; value-free kinds: `changed by the create`, `a trailing newline
folded by the update`, `lost by the create`, `create refused (<subject>): <codes>`, …): a known folded newline no longer
hides a dropped line, and an unsupported body's refused create no longer hides any other subject's. (c) **A refused UPDATE
is a finding** (`<class>.$update — update refused (<subject>): <codes>`) — a refused write reads back unchanged. (d) **An
unreadable archive value is `{"$unreadable": why}`** (a raised `GetSerializableValue`, `meta.Properties` included; past
the walk's depth; a CLR object with no archive whose ToString names only its class — one whose ToString says more,
`System.Version` / `DateTime` / …, is that text) and a finding wherever the member is compared. (e) **No `Implementation.*`
scope wildcard on CODESYS** (the core reads a graphical body as its class alone, so it matched exactly the ST members it
skipped); TwinCAT's scope is the `NWL` / `CFC` / `SFC` elements only. (f) **`SYSTEM true` pinned** on the CODESYS driver
(`A_system_placeholder_reference_pulls_SYSTEM_true`, `WireParityCases.SystemPlaceholderLibrary`), the other half of "spelled
only where true". (g) **`ExpectRed` is red only for an assertion** (`Xunit.Sdk.XunitException`) **or the product exception a
mark names** (`Until<TaskDescriptorException>`, the 8 descriptor-label marks); any other exception fails the test
(`ExpectRedTests`); the TwinCAT TaskDef mark asserts exactly one more line, an AutoStart label carrying `false`. (h) **The
abstract-member rename test runs LAST** in its block and a guard test first fails a served copy an earlier run already
renamed (today's delete + create re-makes `Pick` plain — verified live: the second run on one copy fails the guard).
The oracle re-run on both vendors after (a)-(e): CODESYS **130** member/kind pairs (the 120 members above, split by kind and subject: the trailing newline also folded by the CREATE on 7 classes, 3 more refused creates — `VltFixtureCfc`, `VltFixtureSfc` and Pro2193's `SetErrorFB` beside `VltFixtureMembers` —, and the external event also moved by the CREATE: `TaskObject.Event — changed by the create`), TwinCAT **8** (5 refused creates instead of 1 key: `ladderLabel`, `VltFixtureCfc`, `VltFixtureMembers`, `VltFixtureSfc` UNSUPPORTED, and `POUexecute` `NETWORK_UNSUPPORTED` — a refusal the old key hid); no unreadable value and no undecided `Implementation` member on either vendor; `--write-known`, then a verify run each: 0 unexpected, 0 stale.

**Review fixes (gate step 2, 2026-10-13)** — all seven findings held; none skipped; each got its failing test first
(`test/unit/completeness.test.ts` 18 → 32, `ExpectRedTests` 4 → 5). (1) **A known entry lists the SUBJECTS that fail it**
(`<project>/<wire>`: `CodesysOneToOne/…`, `Pro2193/…`, `Project14/…` — two projects may hold one name), and the verdict
is per subject: a failure of a subject the entry does not list is unexpected, a listed subject the run RAN that passes
is stale, a subject not run is judged for nothing — whatever the kind (the old rule read a subject only out of refusal
kinds, so `--only VltOto_ExtTask.task` called VltOto_CommentTask's call-comment entries stale). (2) **A refusal's kind
keeps its markers** (`create refused: UNSUPPORTED [partiallyApplied] [remains]`, `[renamedTo]` value-free) and the
subject left the kind (it is the entry's subject list); a refused create that left the item listed on the wire is
adopted and its archive judged member by member (`refusedCreateFindings`). (3) **The TwinCAT archive reads the file
byte-exact**: `XmlTextReader` with `Normalization = false` (no CRLF → LF), whitespace kept, a `#text` the element's
Text / CDATA / significant-whitespace nodes verbatim, UTF-8 only (another declared encoding, or invalid bytes, refused
by name); the framing `[xml]` dropped is three decided members, `$file#bom`, `$file#declaration`, `$file#comments`
(spelled: the IDE writes them; a push must reproduce them). (4) **`--write-known` rewrites only the subjects the run
ran** (`mergeKnown`; other subjects' entries and the other vendor's kept). (5) **No silent empty read**: CODESYS
`_snames` tells "no archive" (no `SerializableValueNames` member) from one that raises or is null (`_Unreadable`); an
object or meta whose names cannot be read carries `$names` / `meta.$names` = `$unreadable`, a node whose children
cannot be listed `$children` = `$unreadable`, `meta.Properties` is read by reflection that fails loud; the oracle
checks unreadable BEFORE undecided, so those markers fail as `unreadable`; the `objects` read fails loud on an
unreadable property list or build flag (CODESYS) or an unreadable file (TwinCAT `ObjectsRead`: no `catch { $null }`).
(6) **The dead per-member compare of a clean refused create is gone** (the refusal is the one finding — every member
went with the object); a wire item of a judged kind (`.pou` `.dut` `.itf` `.gvl` `.task`) that no class
`CS_ITEM_EXT` / `TC_ITEM_EXT` knows maps to is reported `UNCOVERED` and fails the run. (7) **`ExpectRed.Until<TRed>`
takes the reason** (`because`, a substring of the refusal's message: `'Core' is not a task field`): the same exception
type thrown for another reason — a label written twice, a missing `Type:`, another unknown label — propagates.
Re-run on instance `bridge-one-to-one` (`--write-known` from an empty list, then a verify run; then `codesys --only
VltOto_ExtTask.task`): CODESYS 28 subjects, **127 member/kind keys over 18 classes** (the 130 above with the four
subject-named refused-create keys now one `create refused: UNSUPPORTED` key listing its subjects), TwinCAT 12
subjects, **5 keys** (the 8 above, same merge) — the key set identical to the previous list once the subject left the
refusal kinds; **234 subject pairs** (verify runs: CODESYS 226 expected, TwinCAT 8; 0 unexpected, 0 stale, 0 uncovered; the `--only` run: 3 expected, 0 stale, exit 0); no unreadable value, no uncovered item, no partial create, and no new TwinCAT
finding from the byte-exact read (Project14's files keep CRLF through an update and a create; the one folded
trailing newline now reads `\r\n`).

**The parity gate (2.3).** `test/shared/WireParityCases.cs` (one constant per case) asserted by
`CodesysWireParityTests` / `TcWireParityTests`: stub manifests (CODESYS green, TwinCAT red ×2: `Name=<name>`), a
non-system placeholder library (red on both: `SYSTEM false`), an interface property GET (green on both). Live
(`vendor-parity.test.ts`): library SYSTEM `.failing` (red, verified), interface GET green on both, stub manifests SKIPPED —
neither fixture serves a visualization or a text list (no witness; the offline twin is the gate until one does).
**One decision taken to state the parity constant**, for the owner: `SYSTEM` is spelled only where it is TRUE (§1.2's
flag rule; TwinCAT has no such member, C37), so a CODESYS non-system reference reads like TwinCAT's.

## 3. Build (decided 2026-10-13, step 3: tasks 3.1-3.5)

**Target.** The 2.2 red marks and the `completeness.known.ts` entries go green task by task, until only named refusals
and niches are left; no step leaves a suite red.

**The choice — the properties ride the ONE content record, and the class is chosen at the create.**
- `ItemContent.Properties` / `Member.Properties`: required positional fields (no default). Read by the driver inside
  `ReadContent`, written inside `WriteContent`; the push compares them in `OnlyChanged` (a properties-only edit is a
  change, an unchanged body is still not written). The version is the file's, which now spells them — nothing to add.
- `IProjectTree.CreateChild(parent, name, kindCode, seed, ObjectClass? cls)`: the class is a required argument (null =
  the kind's plain class). CODESYS maps the class word to the measured path (C2r: check function and abstract method
  constructed; persistent list, text-list enum, sender GVL, parameter list by factory); every other property is then
  written by the `WriteContent` the push already runs after a create.
- Rejected: `Properties = null` defaults (a driver that never read them compiles and pushes "not excluded"); a separate
  `ReadProperties` / `WriteProperties` pair on `ICodeStore` (two reads of one object that can disagree — the two-record
  bug `ItemContent` exists to close); create plain then convert (C2l: a class never changes in place — `create-each-class`).
- **Rename / re-type (3.4)** — per owner and member kind, exactly ONE live member dropped and ONE added of that kind is a
  rename: `IProjectTree.Rename` (GUID and class kept, C2n), then the write. More than one on either side stays delete +
  create (no pairing guess; the text carries every spelled member and the create makes the class, so only the unspelled
  GUID differs — owner default, §1.1). A same-name kind change is refused by name, the two-push remedy stated (C2l).
  Rejected: pairing by body similarity (a guess); refusing every drop+add (blocks a real delete-and-add).

**Order — each task compiles and keeps the suites green.** 3.1 contract + St reader/writer + LSP `object-properties.ts`
+ both drivers' READ (the required field forces it: CODESYS `BuildProperty` / class / comment / `NetVarProperties`;
TwinCAT the measured empty record, a `.plcproj` build entry other than `SubType` or a non-SFC `<ObjectProperties>`
refused by name) + the `format: 2` binding. 3.2 CODESYS writes + class creates. 3.3 TwinCAT: TaskDef members, library
`SYSTEM` (deleted: spelled only where true), interface accessor declaration (the measured constant), the 611 vInfo
quirk (`TcObjectModel.cs:405`: the property's TYPE, not its language). 3.4 rename/re-type. 3.5 the fallbacks of
proposal (8): END line from the declaration's own keyword, GET/SET from `IsGet`, a missing aspect / null `Text` /
`Guid.Empty` / handle 0 refused by name, a whitespace body spelled verbatim, `AbstractMemberFold` on a null/empty
body only. Each task removes the marks it closes (`ExpectRed`, `it.failing`, known entries) and re-runs the oracle for
the classes it touched.

**Stays refused by name:** NVL create (C2r), TwinCAT `%CLASS CHECK` on create/class change and any `SpecialFunc` but
`None` (C2s), every TwinCAT `%`-key and watchdog/event push, a non-empty task `*Parameters` list, standalone
transitions and every 0-occurrence class (niche: accepted loss), a CODESYS bare `Watchdog: off`, a same-name re-type.

**Migration.** `format: 2` (§1.2): a push from a pre-step-3 text is refused "re-pull: the text predates object
properties"; the re-pull adds exactly the new lines (verified in 4.2). The `CreateChild` signature change touches every
call site (17) in one commit.

**Review fixes (gate step 3, 2026-10-13)** — each with its failing test first; one skipped, with its reason.
(1) **A rename never crosses the body slot**: `RenamePairs` pairs a dropped and an added member only when both or neither
state `IMPLEMENTATION NONE` — the vendor's rename keeps the class, and an abstract method's class follows the text, so
an `AbstractPOUMethodObject` renamed into a method with code (no slot for the body: refused AFTER the rename landed) and
the reverse are a delete and a create (`MemberRetypeRenameTests`). (7a) **`METHOD ABSTRACT` with no code is created as
the vendor's abstract class**: the engine derives `ObjectClass.AbstractMethod` from the text (never spelled — no
`%CLASS` line takes it) and passes it to `CreateChild` (`PushService.CreateClass`); CODESYS constructs
`AbstractPOUMethodObject` as `create-each-class` did (`NewConstructed`, the check function's path), TwinCAT makes its
one method class; the write then sends no body to the slotless object (`AfterRenames`). (7b) **A persistent-list create
is refused by name** until the completeness oracle reproduces a re-created list (`dymmattributecount`, §1.1) — the
factory path stays measured, unused. (7c) **A create carrying `%NETVAR` (a sender) or `%PARAMETER_LIST` is refused by
name in the pre-flight, as a create** (`ICodeStore.ValidateProperties(…, create)`): the sender's settings have no
measured write and the push does not hand a factory to the create — niche: accepted loss (1 and 0 occurrences in the
corpora). (2) **The measured constants are read**: `POULevel` (POU; a check function archives none — corrected in 4.2), `AddAttributeSubsequent` (POU, GVL),
`ChildObjectGuids` (POU), `persvarlist` (persistent list) and a body aspect's `ParameterInitializationMethodGenerator`
— each off its value refuses the item by name. (3) **Non-items are named in the pull report** (`WalkResult.UnreadableObjects`):
a FOLDER whose build property is off its default is refused and its objects are NOT walked (they are not built; nothing
would read them as excluded — neither pulled as built nor read as deleted); an application's build property (its
compiler defines) and the Task Configuration's system events / stack settings off `0` / `false` are listed and what is
under them is walked. (4) **CODESYS library redirections are spelled** — `REDIRECT <placeholder> <resolution>` in the
redirected placeholder's manifest, read through `LibManObject.GetRedirectedPlaceholderNames` /
`GetRedirectedPlaceholderResolution` (strings); a redirection no reference names, and the `ParameterTable`'s values,
are listed by name in the pull report: a value is an `IExpression` whose text form is UNMEASURED (no `PARAMETER` line
until a vendor-facts row reads one on a project that sets one — Pro2193). **Decision recorded, TwinCAT parameters**:
§1.1's "spelled only once 3.3 measures its write" is read as written for a PUSH — but a library manifest is never pushed
(read-only, no write path on either vendor), so there is no write to measure; refusing the reference would drop
`Tc2_System` from every TwinCAT pull. The TwinCAT `ParameterList` stays spelled (`PARAMETER`, the vendor's own text
from its XML); the parity gap is now named on the CODESYS side, not silent. (5) **The TwinCAT interface accessor's
stored declaration is read** from the saved `.TcIO` and held to the measured `PUBLIC / VAR / END_VAR`; another text
refuses the interface by name, and an accessor the saved file does not hold (an unsaved edit) is refused with the
remedy (save, pull). (6) **No silent "no properties" on TwinCAT**: an item publishing no `FullPath`, or one not on disk,
is refused by name; a `.plcproj` `Include` is resolved to a full path, so a LINKED file's build entry is seen; a
`<TaskDef>` must carry each of its 13 measured members and no other (each refused by name). **Niche, accepted loss
(0 occurrences in the corpora)**: an UNSAVED Exclude toggle in XAE — the read is of the saved files (0 TwinCAT build
properties in the corpora; reading the in-memory state needs an automation member no row has measured). (8) **Values
the text cannot carry are refused, not trimmed**: a `%NETVAR` value with surrounding blanks, a control character or the
literal `''` (`PropertyLines.Unspellable`, the writer's backstop and the CODESYS read); a CODESYS task member and a
call name / comment stored with surrounding blanks. (9) The live text-list assertion pins the separator exactly (one
blank line, then the class line closing the file) and the create's round trip byte-exact. (10a) **The device descriptor
reads the named member** — `IDeviceId.type` / `id` / `version` (reflected, ScriptEngine3 4.2.0.0), a missing one
refused by name. (11) **The `.plcproj` is read once per saved state** (path per bound PLC node, entries re-read only when
the file's write time or length changes) — it was a PLC-node `ProduceXml` and a whole-project load per item. **Skipped,
(10b) the TwinCAT 611 vInfo**: the create's one seed carries the accessors' LANGUAGE, which CODESYS's `create_property`
needs for graphical accessors and TwinCAT's 611 takes as the property's TYPE; giving TwinCAT the data type needs a second
seed field through `IProjectTree.CreateChild` at every create site — a change of its own. Nothing reaches the text: the
declaration written in the same push replaces the seeded type (`member-order` read the pulled text back).

**Second review of step 3 (gate, 2026-10-13)** — all five findings held; none skipped; each with its failing test first.
(1) **An excluded folder blinds nothing beside it**: it was recorded as an object of UNKNOWN kind (`Kinds` null), so
`WalkResult` put its PARENT — at the root, `""`, the whole project — into `UnwalkedFolders`: no deletion reported, the
walk never `Complete` (so `WillCreate` answered false and the pre-flight's create checks never ran) and every status
PARTIAL — Pro2193's 4 excluded folders on every pull and push. Now the folder is named with a known kind family (empty),
and its objects are walked and each NAMED unreadable with its kind (`'X' sits in the excluded folder …`), never
published: a known one is kept by `Removal`, an op on one is refused by name in the pre-flight, the walk stays complete
(`CodesysContainerRefusalTests`). (2) **A property's slots are its accessors'**: `RenamePairs` compares the member's and
each accessor's `IMPLEMENTATION NONE`, so `PROPERTY ABSTRACT Busy` (slotless GET) renamed into a concrete `Ready` whose
GET has code is a delete and a create, not a rename that keeps the slotless GET and refuses the body after it landed
(`MemberRetypeRenameTests`). (3) **A TwinCAT interface accessor storing an EMPTY declaration pulls** — the vendor-saved
`fixtures/tc-pou/ITF1.TcIO` (3.1.4024.16) stores `<![CDATA[]]>`; both it and the measured `PUBLIC / VAR / END_VAR` are the
empty declaration the text spells; any other text is still refused (`TcObjectPropertiesTests`). (4) **Only
`ExcludeFromBuild` leaves a folder's objects unwalked**: a folder linked always, or holding defines, is listed by name and
walked — it was decided by the reason's first words. (5) **A `%CLASS PERSISTENT` / `%CLASS NVL` create is refused in the
pre-flight** (`CodesysDriver.ValidateProperties`, create), all-or-nothing, beside 7c; `CreateClass` keeps its refusal
for a create the pre-flight cannot tell from an update (`CodesysObjectPropertiesTests`).

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
   `POULevel Standard` (436; the "+ 15" check functions do not archive it — corrected in 4.2), `AddAttributeSubsequent false` (POU 436, GVL 60), `ChildObjectGuids` empty (436),
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

**`POUObject.POUObjectCheckFunction`** — 15 (CTP 0 / bak 5 / awa 0 / pro 10 / len 0); archive members: SpecialFunc, POULevel, ChildObjectGuids, AddAttributeSubsequent, Implementation, Interface, UniqueIdGenerator — **corrected in 4.2 (2026-10-13)**: that list is the CLASS's declared members; an instance's archive (`IArchivable.SerializableValueNames`, SP21 Patch 4, measured on the fixture's `CheckDivDInt` and seen on all 15 by the live re-pull) names only `Implementation`, `Interface`, `SpecialFunc` — no `POULevel` row below for that reason. The driver required `POULevel` on it, so all 15 pulled unreadable (fixed, step 4b)

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
