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
| `IsConnected`, `Vendor`, `ServedProjectName`, `IdeVersion`, `Product*`, `Unsupported`, `NotServedBecause`, `Disconnect`, degraded state, `ShouldMarkDegraded`, `Recover`, `SelectProject`, `BuildHealthResponse` | same | already generic | C14 |
| `RunOnIdeThread<T>` | `RunOnStaThread<T>` | STA is a COM detail | C13 |
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
- `IItemFormat { Name; string Write(Content); Content Read(string text, string kind, string name) }`: the FILE layout
  of a source kind.

**Design finding while writing this:** the file layout is not the body language. The IEC layout (`PROGRAM …
END_PROGRAM`, `METHOD … END_METHOD`, `%`-lines under the `IMPLEMENTATION` line) is `StReader`/`StWriter`. SCL
(`FUNCTION_BLOCK "Motor" … BEGIN … END_FUNCTION_BLOCK`) or an L5X routine are other layouts that hold bodies in their own
languages. So a source kind's row names its `IItemFormat`, and that format asks the `LanguageRegistry` for the body under
each `IMPLEMENTATION <LANG>` line: one line grammar, one registry per question.

**Content** (`Seam/Content.cs`):
- `Content(Kind, Declaration, Body?, Members, PropertySet)`
- `Body(Language, Code, Form, Why?)`, with `Form` = `Shown` / `Hidden` / `Abstract`. It replaces today's
  `StatedLanguage`, the language line encoded in the body text, and `Unsupported`.
- `ContentMember(Kind, Name, Declaration, Body?, PropertySet, Folder?, Get?, Set?)`
- `ContentAccessor(Declaration?, Body?)`
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
