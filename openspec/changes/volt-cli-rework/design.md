# Design: how the rework is done (decision 1.2, 2026-10-20)

The owner delegated the decision ("review all options in detail and decide"). Inputs: `input/map-and-rating.md`,
`input/vendor-neutrality.md`, `input/foreign-client-review.md`, `input/loc-baseline.md`.

## What the research established

- The defect that blocks the goal (a new vendor is one host) is concentrated in ONE place: the shape of the `Ide/`
  contract and of the Engine code that consumes it. Numeric TwinCAT `TREEITEMTYPE` kind codes branch the Engine in 26
  places; `ICodeStore` carries the NWL network body; kinds, languages, `%`-keys and vendors are closed tables.
  Vendor-neutrality of the Engine scores 3/10.
- The hosts are not a tangle (6.5 and 5.5 overall). They hold the measured vendor knowledge: 45+ DIALECT rows, many of
  them workarounds that exist only in code beside a comment (modal-dialog avoidance, save-free move, rename via a
  temporary name, SP18 constructor gaps). Duplication between them is ~150–200 lines of pure network rules.
- Behind the wire there are ~19k lines of product code and ~34k of tests. Most unit tests test internal structure; the
  oracles that survive any restructuring are the e2e suite on every IDE cell, the wire transcript and the contract
  suite of 1.3 (not built yet), and DIALECT.md as the specification of vendor behaviour.

## Options

| | A. Full rewrite of the four projects | B. Staged refactor (new seam beside the old, move, delete) | C. Rewrite the seam + Sync, refactor the hosts | D. Cleanups only |
|---|---|---|---|---|
| End state | clean | clean | clean | the seam stays CODESYS-shaped; goal not met |
| New-vendor goal | met | met | met | not met |
| Loss of measured vendor knowledge | high: workarounds not under an e2e are rediscovered in the field | low | low: the hosts keep their code and tests | none |
| Oracle during the work | e2e + transcript only; unit tests rewritten | all suites keep their meaning | e2e + transcript + host suites; Engine unit tests rewritten with the Engine | all suites |
| Working state between steps | none until the end | after every step | after every step | after every step |
| Releases for PLC Assist meanwhile | stopped or on old code | continue | continue | continue |
| Effort (estimate) | 6–9 weeks | 3–5 weeks | 4–6 weeks | 1–2 weeks |
| Engine code quality afterwards | designed | inherited structure, moved | designed | inherited |

## Decision: C

- **Why not A:** its only gain over C is a fresh host codebase, and the hosts are where the measured knowledge lives and
  where the score is already acceptable. It costs the most, has no working state midway, and loses behaviour that no
  e2e pins.
- **Why not B:** it keeps the Engine's inherited structure (PushService ~2.3k lines, 1k of them comments; the walks with
  their own loops) and only moves it. The Engine is the part that scores lowest, and a moved tangle is still one.
- **Why not D:** it does not meet the goal.
- **Why C:** the part that scores 3 is redesigned; the parts that score 6–7 and hold the vendor knowledge are kept and
  refactored; every step leaves a working, releasable state.

## How C runs (each step green on every suite and every e2e cell; the wire transcript byte-identical)

1. **Bugs first**, as small separate changes (found by the research, risks for a second client today):
   a push without `expectedProjectName`/`expectedPlatform` writes into whatever project is served; a pipe frame is read
   with no size limit (inside the IDE process on CODESYS); the applications longest-prefix match is not per segment
   (to confirm); the `bun run check` reference-extension check checks nothing; a push op's discriminator must come
   first in the JSON (undocumented order rule).
2. **Safety net (1.3)**: the OpenRPC-driven contract suite that records a wire transcript per vendor fixture; one
   implementation + gate per wire rule; the mixed-version cell against 0.1.17884; the new-vendor gate with BOTH
   assertions (no vendor/NWL names above `Ide/`, and no `ItemKind.Plc*` code or NWL type in `Ide/I*.cs` or `Sync/`).
3. **The new contract, written cleanly beside the old**: kinds as strings stated by the host through one registry (which
   also feeds the extension set `bun run check` gates); bodies keyed by language with readers/writers plugged in per
   `IMPLEMENTATION <LANG>`; the `%`-key set and vendors as registries; no NWL type and no numeric code in it.
4. **A third test vendor outside the CODESYS family** implements only the new contract and passes the transport suite —
   the design is proven before a real host moves.
5. **The Engine above the contract is rewritten against it** (Sync: push, fetch, refs, build; Item; the vendor-neutral
   part of Format), with its unit tests rewritten alongside; both hosts keep running through a thin adapter from the old
   contract. The NWL-specific part of `Format/Network` moves below the contract; `NetworkModel` and network text stay
   the Engine's vendor-neutral graphical form.
6. **The hosts move onto the new contract, one at a time** (CODESYS first, then TwinCAT), refactored in place: the
   adapter goes, the vendor-neutral helpers (`MemberDeclaration`, `Clean`/`Trimmed`) go up into the Engine, the
   host-only helpers leave `Ide/`. No shared CODESYS-family layer (owner caution; the measured overlap is too small).
7. **The old contract is deleted**; then the 2.x finds (legacy, the five open silent fallbacks, the hidden features)
   and the inputs since 2026-10-18.
8. **The contract documents are regenerated** from the schema (closed vocabularies as data, the create/update rule, the
   push baseline, the frame rules, no history) — together with the wire changes the audit implies (`networkText` →
   `languages`, the vendor enum from the vendor table): one change, wire protocol 2, coordinated with PLC Assist.

**Runner-ready (owner, 2026-10-20: a self-hosted live-IDE runner comes later).** The safety net of step 2 and every
live check after it are built so a self-hosted Windows runner can run them unchanged, while they run on the dev machine
until then:
- one entry point per live check (`bun run release:matrix`, extended with the contract suite and the transcript
  comparison), no interactive step, no dependency on the engineer's own open IDEs or desktop state;
- each run serves its own fixture copies through `ide.ps1` and closes them, so a run leaves the machine as it found it;
- every result is a file (`release-matrix.json`, the transcript diff, per-cell logs) that a workflow can attach and that
  `promote` already reads;
- a prepared workflow for the runner (`schedule` + `workflow_dispatch` + push to `dev`, never `pull_request` — the repo
  is public), disabled until the machine exists: openspec `ci-live-ide-runner`.
When the runner exists it moves before step 5, so the Engine rewrite runs under continuous live checking.

Guardrails: a measured vendor workaround is never dropped without its DIALECT row and a test that pins it; a step that
cannot keep the transcript byte-identical stops and is reported.

## Expected rating after (1.2 potential, same criteria as 1.0a)

Engine 5 → ~8 (vendor-neutrality 3 → 8), Ide.Codesys 6.5 → ~8, Ide.Twincat 5.5 → ~7.5, Contracts + Wire 6 → ~8.
`input/map-and-rating.md` lists what moves each score.

## New `Ide/` contract (step 3, 2026-10-22)

Written beside the old one, in **`Volt.Engine/Seam/`** (namespace `Volt.Engine.Seam`). Why that name: ARCHITECTURE.md
already calls this boundary "the vendor seam"; `Host` is taken (`Volt.Engine.Host`, the pipe host); `IdeV2` names a
version that means nothing once step 7 deletes `Ide/`; `Vendor` collides with `IIdeSession.Vendor` and `Vendors` in
every file under `Volt.Engine`. `Sync/` does not use it until step 5, so the wire stays byte-identical.

### What a vendor DECLARES: one `VendorDeclaration`, four registries, one `Catalog`

A host hands over one declaration. A `Catalog` is built from the declarations of every vendor a process knows. Each
registry refuses a conflict at registration, by name, so two hosts cannot drift apart silently.

| Registry | Row | Refuses (at registration) | Answers (lookup) | vendor-neutrality |
|---|---|---|---|---|
| `VendorRegistry` | `VendorRow(Id, Display)`; the pipe is `volt.bridge.<Id>.<pid>` | an id that is no lower-case word; one id with two display names | `Display(id)`, refusing an unknown id by name | W10 |
| `KindRegistry` | `KindRow(Kind, Extension?, Role, Shape?, Format?)`; `Role` = `Source` / `Descriptor` / `WritableDescriptor` / `Member` | one kind spelled with two extensions; one extension for two kinds; one kind with another role, shape or format; an extension that is no lower-case word; a member with an extension, an item without one; a source kind without a format or shape | `KindOfWireName(path)` / `ForExtension(ext)`: an unknown extension is `BAD_REQUEST`, naming it and the known set. `ExtensionOf(kind)`. `SourceExtensions`: THE set `bun run check` compares the TS/JSON copies against | W1, W9, W14, C4, S1 |
| `LanguageRegistry` | `LanguageRow(Name, IBodyReader? Reader)`. With a reader the language is SHOWN (`IMPLEMENTATION <NAME>`); without one it is hidden only (`IMPLEMENTATION <NAME> UNSUPPORTED`) | a name that is no upper-case word, or is `NONE` / `UNSUPPORTED`; one name with two readers | `IsShown(name)`, `Reader(name)`, `Shown` (the list `health` reports in protocol 2 instead of `networkText`) | W4, W5, S2, S3, C6 |
| `PropertyKeyRegistry` | `PropertyKey(Key, Grammar, Repeats)`; `Grammar` = `Flag` / `Integer` / `Word` / `Words` / `Text` | a key that is no upper-case word; one key with two grammars; `FOLDER` (a member's place, not a property) | `Parse("%KEY value")` gives `Property(Key, Value)`, refusing an unknown key or a malformed value by name; `Format(property)` | W8, C8 |

The `%`-key set stays CLOSED per process: an unknown key is refused, never carried as an opaque bag (the closedness the
owner kept in `ObjectProperties`). But the set is the union of the declared keys, not a record in the Engine. Whether
THIS vendor holds a key stays the host's pre-flight answer (`ValidateProperties`).

### What a vendor IMPLEMENTS: `IVendorDriver` = `IVendorSession` + `IVendorTree` + `IVendorStore`

| Member | Replaces | Why | Item |
|---|---|---|---|
| **Session** | | | |
| `Declaration` | none | the host states its rows; the Catalog is built from them | S1 |
| `IsConnected`, `Vendor`, `ServedProjectName`, `IdeVersion`, `Product*`, `Unsupported`, `NotServedBecause`, `Disconnect`, `ShouldMarkDegraded`, `Recover`, `SelectProject` | same | already generic | C14 |
| `MarshalToIdeThread<T>`, `ProjectRows()`, `HealthProbeFloorMs` | `RunOnStaThread<T>`, degraded state, `BuildHealthResponse` (and `DriverBase`'s protected `MarshalToIdeThread`/`SnapshotHealth`/`ProbeThrottleMs`) | PRIMITIVES only (step-4 finding F5): the degraded-state machine, the busy/freshness bracketing and the health composition are the same for every vendor and stay the engine's; a host supplies rows and its marshal. STA is a COM detail | C13, C14 |
| `Build(apps)`, `GetBuildDiagnostics(walk)` | same (`walk` returns the new `HostWalk`) | generic | C11, W12 |
| `ExtractLibrarySignatures()` | same; `LibrarySignatureCache` leaves the contract (the engine holds it) | a vendor with no library manager answers none | C12 |
| **Tree** | | | |
| `Walk(observer)` → `HostWalk{Items: WalkedItem(Name, ItemRef, Kind, Folder), UnwalkedFolders, Unreadable, Applications}` | `WalkItems`, `ProjectItem.KindCode` | the kind is a registry string the host states | C1, C3 |
| `Root`, `Children(node)`, `Parent(node)`, `Name(node)` | `GetTreeRoot`, `ChildCount`/`ChildAt`, `Parent`, `Name` | one list call; the host answers children however its IDE allows (TwinCAT's interface accessors from XML) | C3, C5 |
| `Classify(node)` → `NodeClass(Role, Kind?, HoldsItems, Takes?)`; `Role` = `Folder` / `Container` / `Item` / `Member` / `Skip` | `KindCode` and the `ItemKind.Plc*` predicates in `TreeNav`, `ItemLookup`, `MemberSites` | the ENGINE never sees a number. A folder is one Volt creates; a container is a structural node it descends by name and never creates; `HoldsItems` = a create/move target (today's measured `MoveHolders`); `Takes` = the kinds a dedicated container holds whatever its localized name (CODESYS Task Configuration: `task`) | C1 |
| `CreateFolder(parent, name)`, `CreateChild(parent, name, kind, CreateArgs(Language?, Signature?, Class?))` | `CreateChild(…, int kindCode, seed, ObjectClass?)` | a kind string; the one create argument is named for what it is | C2 |
| `Delete`, `Rename`, `Move`, `HandlesSurviveStructureChange` | same | generic | C16 |
| none | `InterfacePropertyAccessors` | gone: the property's `Children` answer it | C5 |
| **Store** | | | |
| `Read(item)` → `Content` | `ReadContent` → `ItemContent` | body keyed by language, properties as declared keys (below) | S2, W8 |
| `Write(item, Content, IReadOnlyList<PushedBody>)` | `WriteContent(…, PushedNetworkBody)` | `PushedBody(BodySite, Language, object Model)`: the model is whatever that language's reader made | C6, S3 |
| `ReadManifest(item, kind)`, `WriteTask`, `ValidateTask` | same | `.task` is a descriptor a vendor may simply not declare | C9, C10 |
| pre-flight: `ValidateSource(existing, PushedBody[])`, `RefusedName`, `RefusedMemberCreate`, `ValidateAccessor(memberKind, ContentAccessor)`, `ValidateProperties(what, PropertySet, create)`, `RefusedLanguageChange` | same; `ValidateInterfaceAccessor` generalised by kind | the vendor's measured refusals; `VendorDriverBase` refuses nothing by default (net48 has no default interface members) | C5, C7, C15 |
| none | `NetworkScopeFor` | moves onto the language's reader: `IBodyReader.Read(code, BodyContext(Declaration, Pushed))` | C6, S3 |

**Plug-ins** (instances the declaration carries):
- `IBodyReader { object Read(string code, BodyContext ctx) }`: a shown language's validator. Network text's returns
  its `NetworkBody`; a plain-text language returns the code.
- `IItemFormat { Name; string Write(Content); Content Read(string text, string kind, string name, Catalog, string vendor) }`:
  the FILE layout of a source kind. It reads through the catalog: the kind's shape, the `IMPLEMENTATION` line
  (`ImplementationLine`, one grammar, the shown set from the registry) and the `%`-keys.

**Design finding while writing this:** the file layout is not the body language. The IEC layout (`PROGRAM …
END_PROGRAM`, `METHOD … END_METHOD`, `%`-lines under the `IMPLEMENTATION` line) is `StReader`/`StWriter`. SCL
(`FUNCTION_BLOCK "Motor" … BEGIN … END_FUNCTION_BLOCK`) or an L5X routine are other layouts that hold bodies in their own
languages. So a source kind's row names its `IItemFormat`, and that format asks the `LanguageRegistry` for the body under
each `IMPLEMENTATION <LANG>` line: one line grammar, one registry per question.

**Content** (`Seam/Content.cs`):
- `Content(Kind, Declaration, BodyText?, Members, PropertySet)`
- `BodyText(Language, Code, Form, Why?)`, with `Form` = `Shown` / `Hidden` / `Abstract`. It replaces today's
  `StatedLanguage`, the language line encoded in the body text, and `Unsupported`. (Not `Body`: that is a namespace,
  `Format/Body`, in every file under `Volt.Engine.Format`.)
- `ContentMember(Kind, Name, Declaration, BodyText?, PropertySet, Folder?, Get?, Set?)`
- `ContentAccessor(Declaration?, BodyText?)`
- `PropertySet`: an ordered list of `Property(Key, Value?)`

No NWL type, no number, and no closed language or key list anywhere in `Seam/`. The new-vendor gate pins that at an
exact zero.

### Could a non-CODESYS host implement it? (probe questions, not designs)

| Question | Siemens TIA (FB/FC/OB/DB/UDT, SCL, LAD as SimaticML) | Rockwell (programs/routines/tags, AOI, RLL) |
|---|---|---|
| its kinds | rows `fb`/`fc`/`ob`/`db`/`udt`/`tags`, roles Source/Descriptor; no CODESYS row inherited | rows `program`, `routine` (a Member of a program, or Source), `aoi`, `tags` |
| its languages | `SCL` shown (a plain-text reader); `LAD`/`FBD` shown only if a SimaticML reader is registered; `STL` hidden | `ST` shown; `RLL` shown with its own reader, or hidden; `FBD`/`SFC` hidden |
| file layout | its own `IItemFormat` (SCL blocks) | its own (`ROUTINE … END_ROUTINE`, or one routine per file) |
| tree | `Container` = PLC device, `Folder` = block group, no `Takes` | `Container` = controller/tasks, no `Takes` |
| members | none (zero `Member` rows) | AOI parts and program routines as `Member` rows with their shape |
| properties | `%OPTIMIZED`, `%KNOW_HOW_PROTECTED` as declared keys | `%REVISION`, `%ROUTINE_TYPE` |
| build / libraries / tasks | compile gives diagnostics, by network as `line`; global libraries give none (empty list); no `.task` row (an OB carries its cycle) | verify gives diagnostics; no library manager; tasks fit `.task` if it declares that row |
| left open | whether a TIA/Logix name can hold `/` (the path does not escape it, W2) | same |

### The old contract on the new one (the step-5 adapter: old host to new contract, byte-identical)

| Old | New, through the adapter |
|---|---|
| `KindCode(item)` + `ItemKind.Map`/`IsContainerManager`/`IsTopLevelCrud`/`IsMember` | `Classify`: `PlcFolder` → `Folder`; `Application` → `Container(HoldsItems)`; `PlcLogic`/`Device`/`GenericContainer`/managers → `Container`; `TaskConfig` → `Container(Takes=[task])`; a mapped item code → `Item(Map(code))`; a member code → `Member(MemberKind)`; `Skip`/`Unknown` → `Skip` |
| `WalkItems` → `ProjectItem(Name, Ref, KindCode, Folder)` | `WalkedItem(Name, Ref, Map(KindCode), Folder)`; unwalked, unreadable and applications unchanged |
| `ChildCount` + `ChildAt` | `Children` (an `UnreadableItemException` child keeps its meaning) |
| `CreateChild(p, n, code, seed, cls)` | `CreateFolder` → `PlcFolder`; `CreateChild(p, n, kind, args)` → `PouKindToCode`/`MemberCode(kind)`, with `args.Language ?? args.Signature` as the seed |
| `InterfacePropertyAccessors` | the adapter's `Children` of an interface property |
| `ReadContent` → `ItemContent` | `Content`: `Body(Stated.Language, code, Form, Unsupported)`, the code split off its line by `ImplementationMarker.Split`; `ObjectProperties` → `PropertySet` by the keys of `PropertyLines` |
| `WriteContent(…, PushedNetworkBody)` | `PushedBody(site, LD/FBD, NetworkBody)`; the network-text reader is the old `NetworkScopeFor` + `NetworkText.Validate` |
| `ItemKind` tables | the CODESYS-family declaration: `pou itf gvl dut` as Source with the IEC format; 18 descriptor rows; `task` as WritableDescriptor; 5 member rows; `ST`/`LD`/`FBD` shown, `CFC`/`SFC`/`IL` hidden; the 13 `PropertyLines` keys. It is registered TWICE (once per host), and the registry proves the two spell it alike |

### What stays below the contract

- NWL and the NWL bag of `Format/Network` (`NwlMembers`, `RebuildLoss nwl-*`)
- the CODESYS object model and the TwinCAT archive
- every DIALECT row
- the numeric codes (`CodesysTypeMap`, `TREEITEMTYPE`)
- `BothVendorsRefusedNames` (each host answers `RefusedName`), `InterfaceAccessorGuard`, `MeasuredNames`
- the CODESYS library-manager model

There is no shared family layer (owner). Each host carries its own declaration, and the registry refuses the two
drifting apart.

### Step 4 findings: the third test vendor (2026-10-22)

`Fakeco` (`test/shared/Fakeco.cs`) implements ONLY `IVendorDriver`: kinds `block` (`.blk`, a body), `type` (`.typ`) and
`station` (`.stn`, a descriptor); `IMPLEMENTATION FKL` shown (plain text) and `LAD` hidden; keys `%RETAIN` and `%NOTE`;
its own file layout (`FakecoFormat`: `%`-lines, declaration, `IMPLEMENTATION` line, code); an in-memory tree. A
test-only adapter (`test/shared/SeamDriverAdapter.cs`, the reverse of step 5's) serves it through the existing
transport: refs, fetch, push (update, create into a new folder, delete), build and health pass over the pipe
(`ThirdVendorTransportTests`). What it proved, and what it forced:

| # | Finding | Changed |
|---|---|---|
| F1 | The contract fits a non-family vendor with no member of it faked: no code, no NWL, no IEC header. The OLD engine does not: its kind table, its file layout (`StReader`/`StWriter`) and its `int` codes are closed, so `.blk` is `BAD_REQUEST` and dropped from `refs` before the host is asked | a transitional door for kinds a catalog declares, deleted in step 5: `Item/SeamAdmission` (the kind rows under synthetic codes from 100000, never a vendor's) and `Format/St/AdmittedFormats` (the row's `IItemFormat` instead of the IEC layout, `Content` ⇄ `ItemContent`). Family rows untouched, nothing admitted in a shipped process: the wire is byte-identical |
| F2 | The old pre-flight hands a driver only NETWORK bodies, so a vendor's own shown language (FKL) never reaches `ValidateSource`; and a create's language is decoded from the text (`NetworkText.LanguageOf`: null for FKL) | none in the contract (it already keys every shown body by language, `PushedBody`); the adapter reads every shown body through its registered reader at `Write`. Step 5's engine does it in the pre-flight |
| F3 | The old kind table is process-wide: a `.pou` pushed to the Fakeco bridge reaches the IEC reader and is refused only by the host, at APPLY (`UNSUPPORTED`), not as `BAD_REQUEST` before any write | held red-first (`A_family_extension_is_a_BAD_REQUEST_on_a_bridge_that_did_not_declare_it`, `ExpectRed` until step 5): a process's catalog is its host's declaration alone |
| F4 | The old `ObjectProperties` record cannot carry a declared key, so `%RETAIN` cannot cross the old engine | `AdmittedFormats` refuses it by name (`UNSUPPORTED`) instead of dropping it; the keys are proven at the contract (`ThirdVendorContractTests`), over the pipe in step 5 |
| F5 | A host that only has primitives would have to re-implement the degraded-state machine, the busy/freshness bracketing and the health composition the old `IIdeSession` asks for | `IVendorSession` is primitives only (`MarshalToIdeThread`, `ProjectRows`, `HealthProbeFloorMs`); the composition stays the engine's (`DriverBase` today) |
| F6 | `KindShape.Composite` and `MembersInside` are read only by `StReader`/`StWriter`: they are IEC-layout facts, not kind facts | none yet: step 5 moves them into the IEC format; the engine keeps `Body`, `Accessors`, `Signature` |
| F7 | `Body` collides with the `Volt.Engine.Format.Body` namespace in every `Format` file | renamed `BodyText` |

The new-vendor gate pins `Volt.Engine/Seam/` at an exact zero: no vendor or NWL symbol, no family code, no `KindCode`, no
NWL type (`NewVendorGateTests.The_new_contract_names_no_vendor_no_NWL_and_no_family_code`).

## Step 5 plan: the Engine onto the new contract (2026-10-23)

Measured before writing it: `Sync/` is 15 files and ~3.8k lines (`PushService` 2.1k), `Item/` ~1k, `Format/` ~8.5k, `Ide/`
~2.1k, `Seam/` ~0.8k. The Sync entry points are called ~460 times from the tests, every one with an old-contract driver
(`FakeIde`, a `DriverBase`). The oracle of every sub-step is the unchanged test suites plus the live matrix's transcript
comparison on the merged result: a sub-step that cannot keep a test green without changing what the test asserts stops
and is reported.

### What the Engine holds of one host: `HostLink`

`Sync/HostLink` is the one value every Sync service and the pipe host take:

| Member | What | Until |
|---|---|---|
| `Driver` | the host as `IVendorDriver` | for good |
| `Catalog` | `Catalog.Of(Driver.Declaration)`: THIS host's declaration alone, so a family extension is `BAD_REQUEST` on a bridge that did not declare it (F3) | for good |
| `Session` | the engine's session composition (`DriverBase`: degraded state, IDE-thread bracketing, single-flight health probe, the health response, the library-signature cache) | step 6 moves it out of `DriverBase` into the engine, when the hosts stop inheriting it |

Two ways in: `HostLink.Of(IVendorDriver)` for a host that speaks only the new contract (the session is the engine's
composition over the host's primitives, F5), and `HostLink.Of(DriverBase)` for the two shipped hosts and `FakeIde`
until step 6 (the driver is the adapter below, the session the host itself). An implicit conversion from `DriverBase`
keeps the ~460 old-contract call sites in the tests compiling unchanged, so they stay the oracle; it goes with the
adapter in step 6.

### The adapter: old host to new contract (`Ide/LegacyDriver`, deleted in step 6)

It is the table "The old contract on the new one" made code, plus what step 4 found:

- **Declaration** (`Ide/FamilyDeclaration`): built from the old tables (`ItemKind`'s file table, `ShapeOf`,
  `PropertyLines.Keys`, the six languages), with the vendor row from `Vendors`. Not a hand copy per host in step 5:
  the hosts are untouched in this step, and a third copy of 30 rows beside two that the registry compares only once
  both hosts register is a drift risk with no gain. Step 6 moves it into each host (the registry then proves the two
  spell it alike).
- **Classify** maps every code the old predicates read, so the engine's rules over `NodeClass` decide what they decided
  over codes: a source code is `Item(kind)` of a `Source` row, a task `Item(task)` of the `WritableDescriptor` row, a
  descriptor code `Item(kind)`, `PlcFolder` `Folder`, `Application` `Container(holdsItems)`, `TaskConfig`
  `Container(takes: task)`, every other container and a container manager `Container`, a member or accessor code
  `Member(kind)`, `Skip`/`Unknown` `Skip`. Where an old predicate was looser than the role names suggest it stays as
  loose (a lookup descends through every node that is no source item, as `IsTopLevelCrud` made it), and is listed for
  step 7.
- **Walk**: the old items with their kinds as strings. An unmapped code and a container manager never become a
  `WalkedItem`: the engine's backstop (`ProjectSnapshot`'s two skips) moves here, where the code still exists.
- **Read / Write**: `ItemContent` ⇄ `Content` (`Format/St/FamilyContent`, the body half of step 4's `AdmittedFormats`
  plus the `%`-keys): a body's language is its `Stated` fact, its code the text under the line
  (`ImplementationMarker.Split`/`Join`, the IEC layout's own rule), a hidden body's reason its `Why`, the properties the
  `PropertyLines` lines as declared keys; `ReturnType`/`DataType` travel as `ContentMember.Signature` (one value, which
  of the two is the member kind's). A read is folded (`AbstractMemberFold`) as every engine read was.
- **Bodies**: LD and FBD are read by `Format/Network/NetworkBodyReader` (the old `NetworkScopeFor` + `NetworkText.Validate`,
  its model the validated network WITH its scope), ST by `PlainTextReader`; the adapter hands the old driver
  `PushedNetworkBody` rebuilt from them.
- **Create**: a folder is `PlcFolder`; a source kind its one seed code (`PouKindToCode`, moved here); a member its
  `MemberCode`; an accessor its POU or interface accessor code; `CreateArgs.Language ?? Signature` is the seed and
  `Class` the `ObjectClass`.
- **Pre-flight**: one to one, except `ValidateAccessor(kind, …)`, which reaches the old `ValidateInterfaceAccessor` for
  an interface property only (the old engine asked nothing else).

### Sub-steps (each committed alone, every C# suite and `test/unit` green)

1. **5.1 the link and the adapter**: `HostLink`, `LegacyDriver`, `FamilyDeclaration`, `IecFormat` (the IEC layout as an
   `IItemFormat`: `StReader`/`StWriter` through `FamilyContent`, the pull's three IEC refusals moved from
   `Materializer`), `NetworkBodyReader`. The pipe host takes a `HostLink`; nothing in Sync uses it yet.
2. **5.2 Sync on the link**: the walks and reads first (`ProjectSnapshot`, `Versioning`, `Materializer`, refs, fetch,
   grep, build, `OpGuard`), then the tree helpers the push uses (`TreeNav`, `ItemLookup`: `Children`/`Classify`), then
   the push on `Content` end to end. The push pre-flight reads EVERY shown body through its registered reader (F2) and
   asks the format for the item's kind by its extension in THIS host's catalog (F3); `%`-keys cross as a `PropertySet`
   (F4). Fakeco is served as itself (`HostLink.Of(Fakeco)`); the test-only `SeamDriverAdapter` is deleted.
3. **5.3 kind facts**: `KindShape` moves into `Seam/` without `Composite`/`MembersInside`, which become the IEC format's
   own table (F6).
4. **5.4 the transitional seam goes**: `SeamAdmission`, `AdmittedFormats`, the `ItemKind`/`StReader`/`StWriter`
   hooks, `PouKindToCode` in Sync; every ratchet pin lowered to what is left.
5. **5.5 the contract-suite defects**: each fixed only where today's wire already has the code for the refusal
   (protocol stays 1); any other is reported.

### What stays in the Engine after step 5, by name (step 6/7 work, listed so it is not forgotten)

- Family RULES the push still states by kind word, each a vendor fact a host should state: the C38 name scope
  (`pou`/`dut`/`gvl` share one name), the interface re-find after a create, the abstract method class derived from
  `IMPLEMENTATION NONE`, a property's accessors named `Get`/`Set`.
- `ItemContent`, `StReader`/`StWriter` as the IEC format's own model (the old record, below the format now).
- The NWL member bag in the network model (`NwlMembers`): moving it below the contract is a model change of its own,
  done with the hosts in step 6.
- `PushedText` (the CLI's post-push comparison): front of the wire, the later phase.

### Wire

Nothing in step 5 changes a byte on the wire for the two shipped vendors: same walks, same reads, same texts, same
codes. What changes is Fakeco's (a test vendor): `.pou` on its bridge is `BAD_REQUEST` before any write (F3), and
`%RETAIN` crosses the pipe (F4).

### Step 5 as built (2026-10-23)

- 5.1 `a90714bec9`, 5.2 `e4b485c4cc`, 5.3 `f0b64f7ae0`, 5.4 `7813757d28`, 5.5 `980f75c518`. The pipe host took the
  `HostLink` in 5.2, with Sync, not in 5.1. `HostLink.Of(IIdeDriver)` makes its driver and catalog on first use, so a
  session answers `health` before any declaration is built.
- The old `ItemLookup.Find`/`Locate` now ask the one lookup (`Sync/TreeLookup`) through the adapter; `ItemLookup.All`
  stays the hosts' walk for their declarations index. `SourceScopes.Validated` stays for two host tests (the
  `NetworkText.Validate` count is 2 until step 7).
- Contract additions the port needed: `IItemFormat.Write(content, name)` (the IEC format's pull refusals name the item),
  `ContentMember.Signature`, `NodeClass.Noun` (a refusal names a node as the old wording did),
  `KindRegistry.FindByWireName`, `PropertyKeyRegistry.ClassKey`/`ClassOf`.
- Measured differences, none on the shipped wire: a signature accessor's body is one value (`""` and `null` were two
  spellings of "nothing to write"); an unmapped code or a container manager in a walk is dropped by the adapter (log only);
  the push asks a host's `ValidateSource` whenever a body is shown (the adapter forwards only network bodies, as before).
- 5.5 not fixed, for the owner: a `deleteItem` quoting a version for a path that names nothing is the documented,
  pinned idempotent no-op (`PushConflictCodeTests`), where wire.html promises `ITEM_MISSING`. Changing it changes what a
  replaying client sees.

## Step 6 plan: the hosts onto the new contract (2026-10-23)

Measured before writing it: the two drivers are 3.8k lines (`CodesysDriver` 1.4k in three partials, `BeckhoffDriver`
2.0k in four); their own offline suites call the old members ~190 times (`ReadContent`, `WriteContent`, `WalkItems`,
`ValidateSource`, …) and assert the IEC record (`ItemContent`) they return; `FakeIde` (1.5k lines) is an old-contract
host behind ~460 Engine and CLI test call sites.

### What each host becomes

`CodesysDriver` and `BeckhoffDriver` implement `IVendorDriver` and nothing of the old contract: no `DriverBase`, no
`IIdeDriver`. Refactored in place, in each host's own new partial (`*.Seam.cs`):

- **Declaration**: each host states its own: its vendor row, its six languages with ITS network reader (its own
  `NetworkScopeFor`), the property keys it holds. The kind rows are read off the IEC-family tables the Engine already
  holds (`ItemKind`), the same tables the push and the format read: a hand copy per host would be a third spelling of 30
  rows that the registry compares only within one process.
- **Tree and store**: the host answers in the new words over its own object-model code. Its IEC record stays its read
  model below the contract (`ItemContent`, the IEC format's model); the conversions are the IEC tables' own functions,
  moved out of the adapter beside the tables they read, so both hosts call ONE spelling of each: code → `NodeClass` and
  kind → the one code each kind is created as (`Item/ItemKind`), and the read fold, the network bodies a host's writer
  takes and a create's seed and class (`Format/St/FamilyContent`). The old members a host test calls stay as the host's
  own methods (no interface), so those ~190 assertions stay the oracle unchanged.
- **Session**: primitives only (F5). `MarshalToIdeThread` (public), `HealthProbeFloorMs` (CODESYS the engine's default
  1000 ms, TwinCAT 5000 ms, as today) and one probe, `ProbeProjects()`, which answers a `ProjectProbe(Rows, Bound,
  NotAnswering)` instead of publishing: the rows; whether the served binding is live (the engine then clears degraded,
  as each host's snapshot did: CODESYS when a project is open, TwinCAT when a selection is connected and the XAE
  answered); and, on TwinCAT, why the XAE did not answer (the ambient probe then fails with `PLC_DISCONNECTED` after the
  rows are published, as `BeckhoffDriver.TriggerAsyncProbe` did). The contract's `ProjectRows()` becomes this probe.
- **The composition** is the engine's alone (`Sync/ComposedSession` over `DriverBase`'s machinery): degraded state,
  IDE-thread bracketing, the throttle, the single-flight probe, the health response, the library-signature cache. A
  `select` refreshes the rows after the host's own select, and a `disconnect` clears degraded with the host's own, as
  both hosts did. The startup refresh is the host's start calling `HostLink.RefreshHealth()` on its IDE thread right
  after its connect, where each host's `Connect` called `SnapshotHealth` (no marshal from the primary thread into
  itself).
- **Helpers**: `MemberDeclaration` (map D5, identical in both hosts apart from the read) goes up into the Engine
  (`Ide/MemberSites`); `Clean`/`Trimmed` (D4) stay each host's own (the comment read beside them differs, DIALECT N42f;
  two one-line bodies are no rule).

### What stays for step 7, by name

`FakeIde` stays an old-contract host: moving it is moving the oracle of ~460 call sites, done with the old interfaces
in step 7. So the adapter (`LegacyDriver`), the old-host declaration (`FamilyDeclaration`), `HostLink`'s old-host door
and its implicit conversion leave `src/` for `test/shared/` (they serve the test double alone); the old `Ide/`
interfaces (`IIdeDriver`, `IIdeSession`, `IProjectTree`, `ICodeStore`) and `DriverBase` (the composition
`ComposedSession` and the double both stand on) stay in the Engine until step 7.

### Sub-steps (each committed alone, every C# suite and `test/unit` green)

1. **6.1 CODESYS**: the engine prep (the probe record, `ComposedSession` taking the session over, the conversions moved
   to the tables, `MemberDeclaration` up), then `CodesysDriver` on `IVendorDriver`; `PipeHost` serves a `HostLink`.
2. **6.2 TwinCAT**: the same; `WorkerStart` hands the pipe host a `HostLink`; the host's own lookups (`ItemLookup.Find`
   / `All` over `this`) ask the Engine's one lookup through the new contract.
3. **6.3 the adapter leaves `src/`**: `LegacyDriver`, `FamilyDeclaration`, `HostLink.Of(IIdeDriver)` and the implicit
   conversion move to `test/shared/` beside `FakeIde`; `BridgePipeHost(IIdeDriver, …)` goes. Ratchets re-pinned down.

### Wire

Nothing changes on the wire: same walks, reads, texts, codes and health rows, by the same functions; the live matrix's
transcript comparison is the proof on the merged result.
