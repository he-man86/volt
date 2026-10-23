# Map (1.1) and quality rating BEFORE (1.0a): behind the wire

Read-only, at `62451aa676` (2026-10-20). Scope: `Volt.Engine` (+ `Volt.Engine.Host`), `Volt.Ide.Codesys`,
`Volt.Ide.Twincat`, `Volt.Contracts` + `Volt.Wire`, and their tests. Paths are relative to `packages/volt-cli/src/`
(tests: `test/`). LOC comes from `loc-baseline.md`. "Claim" means a reading of the code. Nothing was run live; anything
that needs a live bridge says so.

How the counts were taken (4.0b repeats them the same way):
- **vendor names**: `grep -E 'Codesys|CODESYS|Twincat|TwinCAT|Beckhoff|Nwl|NWL|TcPOU|TcXae|XAE'`, counted as all lines,
  then as code lines only (lines not starting with `//`).
- **history comments**: comment lines that match `used to|no longer|\bwas (INTERNAL|a |the |once|briefly|deleted|removed)|
  \bIt was\b|\bonce (was|meant|made|wrote|held)|went with|is gone|are gone|is GONE|deleted;|\(deleted|since-deleted|
  before the fix|until [0-9]|Until 5|earlier today|ARCH FOLLOW-UP|the old |formerly|retired`. This is a proxy. It
  over-counts some lines that state a live rule.
- **PLCopen**: `grep -E 'PLCopen|PlcOpen'` (the PLCopen transport is deleted).

---

## 1.1 Map

### Volt.Engine (+ Volt.Engine.Host)

**What it should own** (ARCHITECTURE.md:116-145): `Ide/` = "the contract a vendor bridge implements, and only this";
`Item/` = what an item is; `Format/` = Volt's text forms; `Library/`; `Sync/` = one service per op. Host = the one
op→service map (`BridgePipeHost`).

**What the code does instead**

| # | finding | evidence |
|---|---|---|
| E1 | `Ide/` is not only the contract. It also holds a host-side kit that only the drivers call: vendor facts and their wording. | `Ide/InterfaceAccessorGuard.cs:6-22` (TwinCAT crash D21, CODESYS D41; `RefuseIfChanged` is called by TC only, `RefuseBody` by CDS only); `Ide/BothVendorsRefusedNames.cs:1-12` (an intersection of the two vendor lists, named "BOTH"); `Ide/ExcludedFolder.cs`, `Ide/MeasuredNames.cs` (12 call sites, all in the two hosts); `Ide/DIALECT.md` (a census of CODESYS-family facts) sits in the Engine |
| E2 | The item-kind table is TwinCAT's `TREEITEMTYPE` enum. The whole engine classifies by those integer codes. | `Item/ItemKind.cs:10-14` ("Codes and constant names ARE TwinCAT's native TREEITEMTYPE"); `Item/ProjectItem.cs:12` `int KindCode`; `ItemKind.Plc*` is used in `Sync/PushService.cs`, `Ide/MemberSites.cs`, `Ide/ProjectDeclarations.cs`, `Ide/TreeNav.cs`; `PushService.cs:2063` `PouKindToCode`; vendor comments on the code lines `ItemKind.cs:69-113` |
| E3 | `Format/Network/` holds 3,199 code lines (35% of Engine code). They are shaped on the 3S NWL object model, so a CODESYS-family format sits in the Engine core. | `Format/Network/NetworkModel.cs:17` ("shaped on … the 3S NWL object model, which BOTH vendors expose"); `NetworkMembers.cs:66` `class NwlMembers`; `NetworkModel.cs:146`; `NetworkText.cs:73` `UnviewedNetwork = "NWL"`; `NetworkModel.cs:86-163` (vendor `BoxTreeOperand`, `OutputItemList`, `InputFlags[0]`, the Demux node) |
| E4 | The `Ide/` contract signature hard-codes the network form. | `Ide/ICodeStore.cs:40` `WriteContent(…, IReadOnlyList<PushedNetworkBody>)`, `:90` `ValidateSource(…, PushedNetworkBody)`, `:157` `NetworkScope NetworkScopeFor(…)`; `Item/ItemContent.cs:72` `IsNetwork` |
| E5 | The path identity is minted in `Sync/`, and its arithmetic lives in `Item/`. So a host reaches up into `Sync`. | the minter is `Sync/Versioning.cs:20,27` (`FolderOf`, `PathOf`); the arithmetic is `Item/ItemPath.cs:20-70`; the host call is `Volt.Ide.Twincat/Driver/BeckhoffDriver.Tree.cs:563` `Volt.Engine.Sync.Versioning.PathOf(…)` |
| E6 | There is no single path comparer. "Addressed path ignores case, held key stays exact" (commit `80ae1cccb1`) is applied site by site. | 143 `OrdinalIgnoreCase` sites in Engine. The exact-match sites are a mix: `Sync/PushService.cs:59,475,978,1055,1086` compare bare names `Ordinal`; `PushService.cs:67` `currentVersions` uses the default comparer and `:69` `itemCache` uses IgnoreCase |
| E7 | User-facing messages name CODESYS. | `Format/St/StReader.cs:200-205` ("the CODESYS build refuses it too") |

**Engine duplication** (Engine only; for duplication between the hosts see the table below)

| rule | copies |
|---|---|
| the per-item version walk (Map → skip manager → `SafeVersion` → identity → `CountUnclassifiable`) | `Sync/ProjectSnapshot.cs:101-155` (refs and fetch now share it through `onItem`, `FetchService.cs:127`); `Sync/PushService.cs:72-101` (own loop, `CountUnclassifiable` twice); `Sync/BuildService.cs:120-128` (a fourth `SafeVersion` loop) |
| `IsAbstract(string?)` | `Format/Body/BodyFormatGuard.cs:251`, `Format/St/AbstractMemberFold.cs:74` (same body) |
| `RejectAll` fallback | `Sync/PushService.cs:119` and `:135` (same `currentProjectVersion ?? ProjectSnapshot.Walk(…, "push-reject")`) |

**Leaks**: E5 (a host calls `Sync`). The Engine grants `InternalsVisibleTo` to the 3 test projects only
(`Volt.Engine.csproj:10-20`), which is fine. `Volt.Cli` uses `Volt.Engine.Item/Library/Sync` (front-of-wire phase, noted only).

### Volt.Ide.Codesys

**What it should own** (ARCHITECTURE.md:280-303): driver facades plus the `CodesysObjectModel` gateway (the only
reflection), the network reader/writer over live `NWLObject`, and `CodesysDispatcher`. **What it does**: that, plus the
items below. It parses no ST text (grep for `END_VAR`/`VAR` parsing: none outside the generated refused-name list).

| # | finding | evidence |
|---|---|---|
| C1 | The checkout/modify/commit transaction is written 3 times. | `Ide/CodesysObjectModel.cs:211`, `:264`, `Ide/CodesysObjectModel.Properties.cs:376` (`GetObjectToModify … ?? throw`) |
| C2 | Diagnostics cross an untyped `List<object>` of `Dictionary<string,object?>` inside one assembly. | `Ide/CodesysObjectModel.Build.cs:33,74,105,155` → `Driver/CodesysDriver.cs:220,225,234,278,304,355` |
| C3 | Line and column are scraped from message text, and the code is misfiled. | `Ide/CodesysObjectModel.Build.cs:109-110` → `Ide/CodesysObjectModel.Libraries.cs:362-375` (`ParseLine`/`ParseColumn` live in Libraries.cs) |
| C4 | Dead code. | `Ide/NwlInterop.cs:70` `Int` (0 callers; its `: 0` fallback); `Ide/CodesysPlatform.cs:53` `All` (0 users), `:29-33` `KnownOn` (never read) |
| C5 | Silent fallbacks that are still open. | `Ide/CodesysObjectModel.Libraries.cs:76-77` (`Namespace`/`Name as string ?? ""`, review B2: a library can vanish and then reads as deleted); `Ide/CodesysObjectModel.Task.cs:180` (`if (GetMember(f,"pous") is {} pous)`: no `pous` member means the call list is skipped and the push reports success, B9); `Ide/CodesysObjectModel.Properties.cs:165` (`_objMgr == null → null`, B11) |
| C6 | An "ARCH FOLLOW-UP" left open. | `Driver/CodesysDriver.cs:207` (and Engine `Ide/DriverBase.cs:67`) |

### Volt.Ide.Twincat

**What it should own**: driver facades plus `TcObjectModel` (COM), `TcArchive`/`TcItemArchive`, the network reader,
writer, builder and writer-to-text, `StaDispatcher`, and the worker entrypoint. **What it does**: that, plus the items below.

| # | finding | evidence |
|---|---|---|
| T1 | It reaches up into `Sync`. | `Driver/BeckhoffDriver.Tree.cs:563` (E5) |
| T2 | Production branches exist only for the offline doubles' shape (review B5, still open). | `Ide/TcObjectModel.Properties.cs:29-35` and `:77-85` (`RuntimeBinderException → null`, doc: "it is the offline doubles' shape"); `Driver/BeckhoffDriver.Content.cs:100`, `:143` (`if (live is null) return; // the offline doubles' shape`) |
| T3 | The flag→bit encoding is written twice in this host. | `Ide/TcNetworkWriter.cs:1054-1068` `Bits`, `Ide/TcArchiveBuilder.cs:445-457` `Bits` (same body, different message) |
| T4 | Two writers for one model: an in-place edit plus a builder. | `Ide/TcNetworkWriter.cs` (1,160 lines) plus `Ide/TcArchiveBuilder.cs` (502) plus `Ide/TcArchiveWriter.cs` (217); both `WriteNode` (`TcNetworkWriter.cs:447`) and `Node`/`Box` (`TcArchiveBuilder.cs:111,190`) walk `Node` |
| T5 | Silent fallbacks that are still open. | `Ide/TcDeviceDescriptor.cs:47,51` (unparseable XML returns `null`, then becomes `EmptyManifest`: every broken device hashes the same, B6); `Ide/TcObjectModel.cs:714` (`ReadImplementation`: a binder miss reads as the empty body `""`, although `:707` refuses a null answer by name) |
| T6 | A forwarder. | `Ide/TcObjectModel.Session.cs:390-392` (`LookupTreeItemDynamic` → `LookupTreeItem`, review A13) |
| T7 | Inputs since 2026-10-18 placed here: (a) saved-file reads; (b) `CarryLive`; (c) the Explorer hierarchy read. | (a) `Ide/TcObjectModel.Properties.cs` `SavedFacts` (`LinkAlways`/`External`/`CompilerDefines`/`AdditionalAllocation` from the `.plcproj`; C39 lag); (b) `Ide/TcItemArchive.cs:120-134` (unsaved CFC/SFC on a move); (c) `Ide/TcSolutionExplorer.cs`, `Ide/TcHierarchy.cs` (read for the whole tree; PLC subtree only is the fix). The declarations-index input sits in the Engine: `Ide/ProjectDeclarations.cs:55` `ItemLookup.All` |

### Volt.Contracts + Volt.Wire

**What they should own** (ARCHITECTURE.md:14-60): the closed vocabularies, DTOs, `WireJson`, and `VoltLog` (Contracts);
bytes on a pipe (Wire).

| # | finding | evidence |
|---|---|---|
| W1 | Vendor facts in the contract. | `Contracts/Vocabulary/Vendors.cs:10-27`: a closed vendor list, `Display` throws on any other vendor (`:22`), and `TwincatShellProcesses` (one vendor's exe names; used by `Volt.Cli/Sync/BridgeResolver.cs:36`, `Connector.Core/TwincatFleet.cs:52`, `XaeWindows.cs:29`). `Wire/PipeNames.cs:11-22`: per-vendor constants and minters (`CodesysInstance`, `TwincatInstance`) instead of one `Instance(vendor, pid)` |
| W2 | The wire's item-kind vocabulary (kinds, extensions) lives in `Volt.Engine/Item/ItemKind.cs:127-162,353-369`, not in Contracts. A client of the contract cannot see it. | (and see E2) |
| W3 | Two JSON read rules on one frame: the envelope and responses skip unknown members, the request body refuses them. Documented. | `Contracts/Wire/WireJson.cs:31-44` |
| W4 | History paragraphs in DTO docs. | `Contracts/Wire/WireJson.cs:9-14` ("Before this, one writer config sat internal…"); `Contracts/Wire/ConnectRequest.cs:9`; `Contracts/Wire/Shared.cs:33-36` ("carried these six members as two copies") |

### Duplication between the two hosts (each a sharing CANDIDATE for 1.2; the default is two self-contained hosts)

| # | rule | CODESYS | TwinCAT | identical? | judgement |
|---|---|---|---|---|---|
| D1 | output-slot layout of a box (ENO echo, named outputs, the null at the connected slot, v2-measurements #12) | `Ide/CodesysNetworkWriter.cs:671-719` `OutputSlots` | `Ide/TcArchiveBuilder.cs:325-367` `OutputSlots` | same algorithm and messages, different slot record. Dead sub-clause on CODESYS: `connected > 0 && !(eno && connected == 0)` (`:715`) | **strong candidate**: a pure function over `NetworkModel` that touches no vendor object. It belongs in a CODESYS-family NWL layer, not in the Engine core (E3) |
| D2 | refuse a changed network read through a named main output | `CodesysNetworkWriter.cs:113-123` | `TcNetworkWriter.cs:320-329` | same condition (`NetworkPairing.NamedMainOutputs`), different wording | candidate: the condition only; each vendor keeps its own sentence |
| D3 | flag→vendor modifier bits; RESET refused as an invariant | `CodesysNetworkWriter.cs:842-870` (`ApplyFlags`/`SetBits` by member name) | `TcNetworkWriter.cs:1054` and `TcArchiveBuilder.cs:445` (bit masks, T3) | same mapping, different target (named member vs `TcArchive.Flag*` mask) | candidate: a family table `Flags → {Negation, Set, Jump, Return, Rtrig, Ftrig}`, each host applies it. First merge T3 inside TwinCAT (no owner question) |
| D4 | network header read plus text normalisation | `Ide/CodesysNetworkReader.cs:42-63` (`ReadNetworkShown`/`Header`), `:547` `Clean` | `Ide/TcNetworkReader.cs:63-85`, `:49` `Trimmed` | `ReadNetworkShown` is identical; `Clean` ≡ `Trimmed` (same body); the comment differs (TC `Comment()` CR LF, DIALECT N42f, load-bearing) | weak candidate: `Clean`/`Trimmed` only |
| D5 | `MemberDeclaration` (ACTION composed, empty declaration refused UNREADABLE) | `Driver/CodesysDriver.Content.cs:341-352` | `Driver/BeckhoffDriver.Content.cs:656-668` | identical except the read delegate | **Engine candidate** (vendor-neutral): `MemberSites` takes the read. It names no family fact apart from `ItemKind.PlcAction` (E2) |
| D6 | `ProjectDeclarations` construction plus `NetworkScopeFor` | `CodesysDriver.Content.cs:372-376` | `BeckhoffDriver.Content.cs:645-650` | identical shape, already shared below (`Ide/ProjectDeclarations`) | keep (2 lines each) |
| D7 | name refusal: measured word ∪ ASCII non-identifier, plus `RefusedPouName` | `Driver/CodesysDriver.Tree.cs:229,247-251` (plus a backtick exception) | `Driver/BeckhoffDriver.Tree.cs:414,453-456` | same formula; table, exception and sentence differ (measured) | keep: the differences are DIALECT facts; the one-liners are trivial |
| D8 | ReadContent member loop (`MemberSites.Of` → `ReadMember`, `ownerIsInterface`) | `CodesysDriver.Content.cs:31-34` | `BeckhoffDriver.Content.cs:38-41` | identical 4 lines | keep |
| D9 | NWL writer as a whole (1.1 open question) | `CodesysNetworkWriter.cs` 875 lines, live typed objects through `NwlInterop` reflection | `TcNetworkWriter.cs` 1,160 plus `TcArchiveBuilder.cs` 502 plus `TcArchiveWriter.cs` 217, over the `XElement` archive | same model and same slot/flag rules (D1-D3) over a different ACCESS (DIALECT N1, N4, N11) | the access cannot be shared (object vs XML; net48 in-proc vs net10 x86 worker). Only the pure model-side rules (D1-D3, D4) can be: about 150-200 lines in one netstandard2.0 family library both hosts reference. Owner decides; the risk is one vendor's fix moving the other's bytes, so the wire transcript (1.3) has to gate it |

Irreducible, so not candidates: dispatchers (`CodesysDispatcher` vs `StaDispatcher`+`ComMessageFilter`), refused-name tables
(generated from measurements), task writes (`CodesysObjectModel.Task` vs `TcTaskSchedule`), build diagnostics (different
sources), `ShouldMarkDegraded` (`CodesysDriver.cs:195` false vs `BeckhoffDriver.cs:155` RPC fault).
`LibraryManifest.Build` is already shared (`CodesysObjectModel.Libraries.cs:238`, `BeckhoffDriver.Content.cs:852`).

### What is left of the 2026-10-16 reviews (each claim re-checked against the current code)

**engine.md**: the following rows are **applied** (verified gone or changed): 2-12 (no `PLCopen` left in `Ide/`, `Item/`, `Sync/`; `ICodeStore` no longer
describes `ReadXml`), 14, 23 (CodeHelper deleted), 24 (`TreeNav.Descend`), 25 (retired-comment hint deleted), 26, 29 (`Refind`),
30, 31 (second `RefuseMemberRetypes` deleted), 32, 34, 36, 39, 40, 42, 43.
**Open**:
- row 1: history narrative, 77 lines by the proxy; `PushService.cs` is now 703 comment lines of 2,075;
- row 13: `DriverBase.cs:67` ARCH FOLLOW-UP;
- row 22: partly done (push and build keep their own walks);
- row 33: `MemberSites.Site` is still a hand-written struct (`Ide/MemberSites.cs:18`);
- row 35;
- row 37;
- row 41: `IsVerbatimKind` at `Sync/Materializer.cs:149-156`, still untested.

New stale comments:
- `Sync/BuildService.cs:124-126` says "`Identity` falls back to the BARE name". False since `unreadable-name-carries-kind` (`Versioning.cs:117-121`).
- `Versioning.cs:103` says "Three walks produce version maps". The build is a fourth.
- `Ide/BridgeLog.cs:12` cites the deleted `codesys-pipe.ps1`.

**cli-bridges.md (in scope only)**:
- **Applied**: A2 (worker probes gone; `Program.cs` is 60 lines), A6, A7, A15, A23, A29 (`HasProjects`, `_loggedTcCodes`), B4 (the `WaitForIdle` catches are `when (!IsRpcFault)`), B7, B8 (`WithViewMode` gone), C3, E11 (`WireJson` is case-exact), E14 (`NetworkTextReader.cs:1007` raises it).
- **Open**: A8 (C1), A10 (C3), A12 (C2), A13 (T6), A17 and A24 (C4), B2, B9, B11 (C5), B5 (T2), B6 (T5), C5 (`BridgeLog.cs:12`).
- **Not re-checked**: A11, A14, A16, A18, A19, B1, B3, C2, C4. They go to 2.x.

### Public API: 5 requests our CLI never sends (from reading the code; 1.3's contract suite has to confirm each live)

| # | request | what the bridge does | evidence | verdict |
|---|---|---|---|---|
| P1 | `push` (or `build`) without `expectedPlatform`/`expectedProjectName` | only the connected check runs; the push writes into whatever project is served | `Sync/OpGuard.cs:25-41` (comment at :33) ("Supplying NEITHER runs only the connected check (init/discovery)"), `PushService.cs:36` | holds only because our CLI is polite: a write op should require its binding |
| P2 | a push op whose `"op"` discriminator is not the first JSON member | STJ 10 polymorphism with `AllowOutOfOrderMetadataProperties` unset raises a `JsonException`, so BAD_REQUEST with a serializer message | `Contracts/Wire/PushModels.cs:34-36`, `WireJson.cs:39-44`, STJ 10.0.12 (`Directory.Packages.props:20`); `docs/wire.html:119` does not state the order | an undocumented ordering rule (a foreign client hits it) |
| P3 | `expectedProjectName`/`connect.project` in another case | compared `Ordinal`, so WRONG_PROJECT / PLC_DISCONNECTED, while every addressed item path matches ignoring case | `OpGuard.cs:35`, `Engine.Host/BridgePipeHost.cs` connect arm (`StringComparison.Ordinal`) | one fact, two comparers (E6) |
| P4 | a request from a client of another protocol | the request envelope carries no protocol (`Wire/PipeMessages.cs:11-12`); the bridge states it only on `health` (`BridgePipeHost.cs:127`) | a client that skips `health` is never refused; the mixed-version refusal is client-side only | holds only because our CLI is polite |
| P5 | a frame with no newline (a long or stuck stream) | `ReadLine` buffers without a limit; on CODESYS that buffer is inside the IDE process | `Wire/PipeServer.cs:259-272` | no frame cap |

Behaviour that is fine: an unknown op gives BAD_REQUEST (`BridgePipeHost.cs` default arm); an unknown body member gives BAD_REQUEST
(`WireJson.Request`); bad JSON gives BAD_REQUEST, not INTERNAL (`PipeServer.cs:217-222`); a push during a build gives IDE_BUSY (`Gated`).

---

## 1.0a Quality rating BEFORE (1-10)

For a HOST, the "vendor-neutrality" criterion asks whether the host stays below the contract. It scores up-reaches
(calls into `Sync`) and its own facts leaked above the seam. "Fakes" means production branches shaped for doubles,
and doubles that are looser than the IDE.

| criterion | Engine (+Host) | Ide.Codesys | Ide.Twincat | Contracts + Wire |
|---|---|---|---|---|
| placement | **6**: E1, E5; `Ide/` holds 7 non-contract helper files | **7**: C2, C3 misfiled; D1/D5 neutral or family logic inside the host | **6**: T1 up-reach, T2 production code for doubles, T3 | **6**: W1 vendor exe names and minters; W2 kinds outside the contract |
| duplication | **6**: walk ×3 (+build), `IsAbstract` ×2, RejectAll ×2, no single path comparer (143 sites) | **5**: C1 ×3; cross-host D1-D5 | **4**: T3, T4 two writers; cross-host D1-D5 | **8**: one `WireJson`; per-vendor `PipeNames` minters ×2 |
| vendor-neutrality above `Ide/` | **3**: 346 lines name a vendor or NWL, 25 of them code (`NwlMembers` ×12 in NetworkMembers/Model/Derivation, `ItemKind` ×8, `"NWL"` const, StReader ×3); the TREEITEMTYPE integer codes are the core classifier (E2); NWL-shaped `Format/Network` is 35% of the code (E3); the contract takes `PushedNetworkBody` (E4). The existing gate `test/Volt.Repo.Gates/EngineKnowsNoVendorFormatTests.cs:13` catches none of this | **9**: no up-reach into `Sync`; its D41 fact sits in Engine `InterfaceAccessorGuard` | **8**: T1; its D21 fact and its codes (E2) sit above the seam | **5**: 58 lines, 14 code lines (`Vendors.cs` 8, `PipeNames.cs` 6), a closed vendor list |
| legacy | **6**: 77 history comments (Host 5), 7 PLCopen, 2 ARCH FOLLOW-UP, `IsVerbatimKind`, 3 false comments; dead code ≈ 0 (rows 23, 39 deleted) | **6**: 73 history, 5 PLCopen, 3 dead members (C4), C3 scraper, `CodesysNetworkWriter.cs:848` "This used to refuse" | **5**: 83 history, 17 PLCopen (e.g. `TcNetworkWriter.cs:24,164,686,873` explain the deleted PLCopen lowering), T6, `BeckhoffDriver.Content.cs:277` "the CODESYS fix from earlier today" | **6**: Contracts 19 and Wire 6 history; W4 paragraphs |
| test strength | **7**: 1,292 facts in 157 files; 55 red-before-fix markers; `ExpectRed` has 0 live marks; 1 parked skip (`test/Volt.Engine.Tests/format/st/StFixedPointTests.cs:178`); `FakeIde` (1,508 lines, 69 sync test files) matches folders `Ordinal` (`test/shared/FakeIde.cs:319,396,401,417`) where the IDE lookup ignores case, so a case bug can pass; `DriverBase.cs:233` is virtual for the double | **7**: 305 facts in 51 files, 39 markers; C5 fallbacks have no red test | **6**: 422 facts in 75 files, 21 markers; T2: dynamic doubles shape the product (4 sites); T5 untested | **4**: `Volt.Contracts.Tests` has 17 facts in 5 files and none on `WireJson`, `PushOp` polymorphism or DTO shapes (covered indirectly by `Cli.Tests/wire`, `Repo.Gates/WireVocabularyTests`); Wire is tested from `Cli.Tests/wire/PipeTransportTests` plus `shared/PipeAccessTests` |
| public-API robustness | **5**: P1, P3 (Engine) | **6**: inherits P1-P5; C5 (a silent library drop reads as a delete, a skipped call list reports success) | **6**: inherits P1-P5; T5 | **5**: P2, P4, P5 |
| size | **5**: 9,129 code + 5,187 comment (36%); `PushService.cs` 2,075 lines | **6**: 3,812 + 2,246 (37%) | **5**: 5,597 + 3,235 (37%); network code ≈ 2,700 raw lines | **6**: Contracts 573 + 693 (**55%** comment), Wire 520 + 204 (28%) |
| **overall** | **5** | **6.5** | **5.5** | **6** |

### What moves each score (input for 1.2's potential rating)

- **Engine placement**:
  - move the host kit (`InterfaceAccessorGuard`, `MeasuredNames`, `ExcludedFolder`, `BothVendorsRefusedNames`, `DIALECT.md`) out of `Ide/`, into a host-side library or the hosts;
  - move the path minter into `Item/` (E5).
  - Target: 8.
- **Engine duplication**:
  - one walk kernel (push and build on `ProjectSnapshot.Walk`);
  - one `WirePath` comparer pair (addressed vs held) with a gate;
  - delete the `IsAbstract` and `RejectAll` copies.
  - Target: 8.
- **Engine vendor-neutrality** (the largest lever):
  - a vendor-neutral kind identity in place of the TREEITEMTYPE integers (hosts map their own codes);
  - NWL-specific model members (`NwlMembers`, Demux, slot nulls) below the contract;
  - `ICodeStore` takes a body by language, not `PushedNetworkBody`;
  - widen the 1.3 gate to the regex used above.
  - Target: 7-8, from 3. It depends on the 1.1a decisions.
- **Engine legacy**: the history sweep (owner OK), the 3 false comments, `IsVerbatimKind` (test or delete), ARCH FOLLOW-UP. Target: 8.
- **Engine tests**:
  - `FakeIde` folder compare made case-insensitive (red test first);
  - the contract suite (1.3) replaces fake-driven wire assertions.
  - Target: 8.
- **Engine public API**: P1 (write ops require the binding), P3 (one comparer). Target: 7.
- **Engine size**: the history sweep alone takes about 700 lines; splitting `PushService.cs` changes readability, not LOC. Target: 6-7.
- **Codesys**: C1 one `Modify` (dup 7); C2 typed diagnostic record; C3/C4 deletions (legacy 8); C5 red tests then loud failures (tests 8, API 7); D1-D3 if 1.2 approves a family layer (dup 7).
- **Twincat**:
  - T3 merge `Bits` (dup 5, then 7 with D1-D3);
  - T2 doubles gain `ProduceXml` and the product branches go (placement 8, tests 7);
  - T1 via E5 (neutrality 9);
  - the PLCopen history sweep (legacy 8);
  - T5 fixes (API 7);
  - the T7 inputs (performance, C39 correctness).
- **Contracts/Wire**:
  - `Vendors` and `PipeNames` keyed by vendor id (one minter; TwinCAT exe names move to the connector);
  - the wire kind vocabulary moves into Contracts (W2);
  - `Contracts.Tests` covers `WireJson`/`PushOp`/DTO shapes from the OpenRPC document;
  - P2 (allow out-of-order metadata or document it), P4 (protocol on the request, or a documented refusal), P5 (frame cap);
  - the W4 history sweep cuts the 55% comment share.
  - Target: 7-8 each.
