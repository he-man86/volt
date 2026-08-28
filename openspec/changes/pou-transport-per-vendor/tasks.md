## 0. Evidence — measured, do not re-derive

Full tables in `checklist.md`. Condensed, because this is the part that must survive:

- **TwinCAT PLCopen fails 7 requirements**: R1 declaration, R6 member declarations, R10 network metadata,
  W1/W6/W8 their write halves, W11 in-place replace, W14 no-normalization. Every crisis this month is one of
  those rows.
- **`DocumentXml` passed all four deciding experiments.**
  - **R3** — the body is an EXPRESSION TREE (`BoxTreeAssign` / `BoxTreeBox` / `BoxTreeOperand` / `Operator` /
    `ParamList`), measured on **both** LD and FBD. `contact` / `coil` / `PowerRail` are **0 in both** — a ladder
    is a VIEW (`DefaultViewMode`), the storage is already the lowered boolean form. Operands carry `Type` inline.
  - **W14** — set a document back unchanged: byte-identical except the POU `Id`, which PLCopen zeroes anyway.
    Measured on both languages (15,175→15,175 / 21,689→21,689 chars, one line each).
  - **W12** — malformed documents are refused WHOLE with a line/position diagnostic, POU byte-intact. Stronger
    than the PLCopen import.
  - **R9** — folders are structural: `<Folder Name="Inner"/>` plus `FolderPath="Inner\"` on the member.
- **CODESYS PLCopen carries the declaration and members fine, and its native is now measured and REJECTED** —
  90,434 bytes for one graphical POU, a GUID-typed object-graph dump carrying editor canvas geometry. §1.

### What the TwinCAT converter DELETES rather than adds

The cost argument that rejected `DocumentXml` was backwards. On a native transport these become unnecessary:

| today, for TwinCAT | why it goes |
|---|---|
| `GraphReader.LowerLadder` | there are no contacts to lower |
| `InstanceTypes` declaration text-parse ("an approximation forever") | operands carry `Type` |
| `RestoreChildFolders` | `FolderPath=` is in the document |
| the whole carry + refusal machinery | nothing is regenerated |
| declaration-from-the-aspect, for TwinCAT | the document carries it verbatim |

### Traps that each cost real time — every one reads as "the API is broken"

1. A name walk finds the WRONG item when names repeat (`PLC_PRG` exists three times in one project) and returns
   0 chars.
2. `PlcOpenImport` settles ASYNCHRONOUSLY — the item stays invisible in the same COM session even after
   re-acquiring the PLC-project handle, while a fresh process sees it at once. Import and probe must be separate
   invocations. (D4d covers handles to the *replaced* item; this is the parent's enumeration and is wider.)
3. **PowerShell's COM binding can return the parameterized `Child` property as a COLLECTION**, so a helper that
   returns a COM object yields `System.Object[]` and every later `.ChildCount` comparison fails. Keep tree
   searches INLINE and cast (`[int]`, `[string]`).
4. `DocumentXml` is 0 chars on folders, libraries, task references and a POU's ACTION child (an action exposes
   `ImplementationXml`).
5. TwinCAT language codes: **ST=1, SFC=3, FBD=4, CFC=5, LD=6**.

---

## 1. CODESYS held to the same standard — DONE. Verdict in `checklist.md` §CS

`export_native` had been rejected on one 3,166-byte glance, which is thinner than TwinCAT's four experiments.
"Best possible per vendor" means measuring both, so it was measured.

- [x] 1.1 **R3 — DISQUALIFYING.** One graphical POU exports as **90,434 bytes** (TwinCAT's entire LD POU is
      14,849): a `Single`/`List2` .NET object-graph dump (`Method="IArchivable"`) with **30 distinct type GUIDs**
      and the editor's canvas geometry (`Bounds`, `CanvasWidth`, `AutoSizeCanvas`) serialized into it. It is the
      editor's state, not a description of the logic.
- [x] 1.2 **W14 — deliberately not run.** R3 disqualified the transport; measuring the write behaviour of one
      that cannot be read spends the budget in the wrong place.
- [x] 1.3 **W12 — deliberately not run**, same reason.
- [x] 1.4 **R10 — answered NEGATIVE, and the answer was wrong; see §1b.7.** `OutCommented` / `Title` / `Label` appear nowhere in the
      CODESYS archive, so **no** CODESYS transport fixes the disabled-network hole.
- [x] 1.5 **The GUID question — answered, and moot.** The type GUIDs ARE consistent: each maps 1:1 to an object
      kind across 1,314 objects, and the action row (decl=0, impl=7) independently confirms "an action has no
      declaration". But a converter would need a 30+ entry GUID→type map per graphical POU, maintained per
      CODESYS version. **Moot**, because the transport is rejected AND because Volt already classifies by
      OFFICIAL identifiers on both vendors: named interfaces on CODESYS (`IPOUObject`, `IPOUMethodObject`,
      `IActionObject`, `IGVLObject` — `CodesysTypeMap`) and the native `TREEITEMTYPE` enum on TwinCAT. **No GUID
      type scheme enters the product.** The only GUID a driver touches is an object's own instance handle, which
      CODESYS's API requires (`GetObjectToRead(handle, guid)`) — a calling convention, not a classification.
- [x] 1.6 **SUPERSEDED by §1b.6 — CODESYS moves to the NWL object model.** As decided at the time: keep PLCopen — larger, GUID-typed, no network metadata, editor state rather than
      a document. PLCopen is a documented standard with domain vocabulary and is the better transport *for this
      vendor*.

**Consequence, so it is not misread:** `lossless-push` does **not** disappear. CODESYS keeps regenerating a body
from network text and keeps every loss that change exists to stop. It becomes **CODESYS-only**, and the engine
keeps network text, `GraphModel` and the carry/refuse invariant. Only TwinCAT sheds them.

**One datum to size that work against:** of 249 POUs in a real customer project, **248 have a textual
implementation** — one graphical POU in 1,314 objects.

## 1b. The third option neither column scored — the vendors' shared OBJECT MODEL

§1 scored CODESYS's **native serialization** (`export_native`) and rejected it: 90,434 bytes of GUID-typed
`IArchivable` dump carrying editor canvas geometry. That rejection **stands, and is not what this section
revisits.** A serialization and an object model are different things, and the object model was never scored
because it was never noticed.

Measured 2026-08-28 — full evidence and reproduction in `nwl-object-model.md`, probe committed as
`scripts/probe-nwl-objectmodel.py`:

- [x] 1b.1 **CODESYS graphical bodies are reachable as TYPED objects.** `ObjectMgr.GetObjectToRead(handle, guid)`
      -> `.Object` -> `Implementation` returns `NWLObject.NWLImplementationObject` for both `fbd` and `ladder`,
      with `NetworkList` of `NWLObject.Network`. **The aspect type IS the language** — CFC returns
      `CFCImplementationObject`, ST returns `STImplementationObject`. Dispatch is a cast, not a lookup, and
      `CodesysObjectModel` already calls the very member that returns it.
- [x] 1b.2 **The body traverses with everything network text needs.** `GetTree(i)` -> `BoxTreeAssign` ->
      `.RValue` -> `BoxTreeOperand` -> `.Operand` with `OperandExpr`, per-item `Id`, and `Flags` exposing the six
      named booleans. `INetwork.Accept(INWLItemVisitor)` means a renderer is a **visitor, not a parser**.
- [x] 1b.3 **Writes commit through the same objects.** `GetObjectToModify` -> mutate -> `SetObject(meta, true,
      null)`; re-read confirms `Label '' -> 'VLT_PROBE'`. `SetTree` / `InsertTree` / `AppendTree` /
      `RemoveNetworkItem` / `Normalize` are all on `INetwork`. **No serialization in either direction.**
- [x] 1b.4 **TwinCAT stores the same model.** `POU_PBD.TcPOU` holds `<Implementation><NWL>` wrapping an
      `<XmlArchive>` of that object graph. Not a schema — a serialized graph of the same types.
- [x] 1b.5 **But TwinCAT cannot reach it live.** With the fixture solution loaded, the PLC tree walked,
      `ProduceXml` called, and three documents open: **zero** modules loaded under
      `C:\TwinCAT\3.1\Components\Plc\`, and a sweep of every process on the machine found `NWLObject` loaded
      **nowhere**. `File.OpenFile` on a `.TcPOU` opens the XML text editor, and the TwinCAT project reports
      `ProjectItems.Count = 0`, so DTE cannot reach the PLC editor factory. An in-proc Volt component inside
      TcXaeShell would have nothing to attach to — **this is not a VSIX away**, and nobody should spend a week
      finding that out.

### What this overturns

- [x] 1b.6 **§1.6 "CODESYS keeps PLCopen" is SUPERSEDED.** It was decided against the native *serialization*,
      which was the only alternative on the table at the time. The object model beats PLCopen on the same
      checklist rows PLCopen was chosen for, and on the ones it lost: it carries `Title` / `Label` / `Comment` /
      `OutCommented` (**R10**, the disabled-network hole §1.4 declared unfixable on CODESYS), it needs no
      GUID map (§1.5), and it costs no serialization in either direction.
- [x] 1b.7 **§1.4's negative result was answered too narrowly.** "`OutCommented`/`Title`/`Label` appear nowhere
      in the CODESYS archive" is true of the archive and false of the IDE. **An absence found by grepping one
      serialization is not an absence in the vendor** — the same error this repo already recorded once, about
      searching for a NAME when a format may encode by VALUE.
- [x] 1b.8 **`GraphModel` gaining `Title`/`Label`/`Comment`/`OutCommented` is no longer a TwinCAT concession**
      (§4.3 framed it as one). Both vendors carry all four. It is the shared model, and PLCopen was the lossy
      party.
- [x] 1b.9 **"IL unsupported" is a policy about a VIEW, not a body format.** `INetwork` exposes `ActivateFBD`,
      `ActivateIL`, `CanConvertToIL`, `GetILLine`, `ILActive`, `ILValid`, matching `NWLDisplayMode { LD, FBD,
      IL }`. `GraphReader` lowering LD into the same node graph as FBD was right for the same reason. Restate it
      that way in DIALECT; do not change the policy.

### The one thing that is NOT proven, and it gates the CODESYS adapter

- [ ] 1b.10 **Node CONSTRUCTION is unmeasured.** What is proven is traversal and mutation of an EXISTING
      network's properties. Building a body from network text needs new `IBoxTree` / `Operand` instances, and
      the factory for those is unknown — `INetwork` takes them (`AppendTree(IBoxTree)`) but nothing measured so
      far *makes* one. **Prove it before writing the adapter**: construct one two-operand network from nothing,
      commit it, reopen the project, confirm it is there and the IDE compiles it. Until that passes, the honest
      claim is "CODESYS reads typed and edits typed", not "CODESYS writes typed".

      If construction turns out to be impossible or unstable, the fallback is **not** PLCopen for everything: it
      is typed READ plus PLCopen WRITE for CODESYS, which still deletes the read-side graph parsing and still
      fixes R10. Say so explicitly if it happens rather than quietly restoring the old path.

---

---

## 2. The boundary — this is the design error, and it blocks everything

`ICodeStore` currently demands a PLCopen document from every driver:

```csharp
string ReadXml(ItemRef item);
void   WriteXml(ItemRef item, string xml);
```

An IDE without a PLCopen export **cannot implement the contract**. That is why TwinCAT cannot adopt its own
better transport: the engine will not let it. The refactor is not cleanup after the transport change — it is what
unblocks it.

- [ ] 2.1 **`ICodeStore` speaks `ItemContent`**, not XML: `ReadContent(ItemRef) → ItemContent` /
      `WriteContent(ItemRef, ItemContent)`. `ItemContent` already exists and is already vendor-neutral
      (`Kind`, `Declaration`, `Body`, `Members`, folders) — the boundary is simply drawn one layer too low.
- [ ] 2.2 **The engine stops knowing what PLCopen is.** No `plcopen` string, no TC6 namespace, no `addData`
      anywhere under `Volt.Engine/`.
- [ ] 2.3 **`GraphModel` is the neutral graphical intermediate** and STAYS in the engine. Each driver converts
      its own body form to it. Network text — Volt's own format — stays in the engine too.
- [ ] 2.4 **`DIALECT.md` moves out of the engine.** A vendor-facts document inside the vendor-neutral package is
      the design error in miniature. Split it per vendor.

## 3. Target layout — the PACKAGES are already right; one thing moves

> **Superseded in two places by §3b:** PLCopen is deleted rather than moved into the CODESYS package, and the
> folder move happens FIRST, not last. The package-graph analysis below stands unchanged.

The nine projects are correctly layered already, and this change adds, merges and renames **none** of them:

| package | job | depends on |
|---|---|---|
| `Volt.Contracts` | the wire DTOs | — |
| `Volt.Wire` | named-pipe transport: framing, dispatch | Contracts |
| `Volt.Engine` | **Volt's own formats + sync + the driver contract** | Contracts |
| `Volt.Engine.Host` | serves the engine behind the wire | Contracts, Engine, Wire |
| `Volt.Cli.Ide.Codesys` / `.Twincat` | the vendor drivers | Engine.Host, Engine, Wire |
| `Volt.Cli` | the `volt` CLI | Contracts, Wire, Engine |
| `Volt.Cli.Connector[.Core]` | tray supervisor | Contracts, Wire |

**The defect is not the layout — it is what sits INSIDE `Volt.Engine`.** PLCopen lives there, so the
vendor-neutral layer performs a vendor's format conversion. That is the whole error, and moving one folder fixes
it.

### The line

- **`Volt.Engine` owns what VOLT invented** — the `.fb` file layout (`StReader`/`StWriter`), network text,
  `GraphModel` (Volt's neutral graphical model), and sync/merge/versioning. It never learns a vendor's
  serialization.
- **Each vendor package owns how ITS IDE stores things**, including the conversion into `GraphModel` and
  `ItemContent`. CODESYS: PLCopen. TwinCAT: the native document. A third IDE: whatever it has.

### Why this is not academic — Siemens

TIA Portal has **no PLCopen export**; its API is Openness with its own representation. A Siemens driver would
implement `ReadContent`/`WriteContent` and never touch PLCopen — but **today it cannot be written at all**,
because `ICodeStore` demands `string ReadXml()`. That is the same wall TwinCAT is behind. The contract, not the
package graph, is what excludes new vendors.

```
Volt.Engine/
  Ide/       ICodeStore (ItemContent in / out), IProjectTree, TreeNav
  Item/      ItemKind, ItemRef, ItemContent
  Source/    VOLT'S OWN FORMATS ONLY
    St/        the canonical .fb layout
    Network/   network text + GraphModel
  Sync/      Materializer, PushService, FetchService, Versioning

Volt.Cli.Ide.Codesys/
  Format/PlcOpen/   PlcOpenDocument, PouReader, PouSplice, Declaration, Namespaces,
                    ProjectStructure, GraphReader, GraphWriter, DIALECT-codesys.md
Volt.Cli.Ide.Twincat/
  Format/Native/    TcDocument reader/writer, BoxTree <-> GraphModel, DIALECT-twincat.md
```

- [ ] 3.1 Move the PLCopen layer into the CODESYS package, AFTER §4 — TwinCAT still needs it until its native
      converter exists.
- [ ] 3.2 Keep `GraphModel` + network text in the engine. They are Volt's, not a vendor's.
- [ ] 3.3 `bun run check` fails if `Volt.Engine` references a vendor format again. A guard, not a convention.

**A correction to an earlier draft of this plan:** it proposed a shared `Volt.Format.PlcOpen` package. That was
over-engineering for a temporary overlap — once TwinCAT is native, PLCopen is CODESYS-only and simply belongs in
the CODESYS package. Fewer packages, not more.

### Sequencing, because the order is what makes each step verifiable

1. **§2 — the contract.** `ICodeStore` speaks `ItemContent`. Both drivers implement it; both still call the
   PLCopen code, which stays where it is but is now called only BY DRIVERS, never by the engine.
2. **§4 — the TwinCAT native converter.** TwinCAT stops calling PLCopen.
3. **§3.1 — move PLCopen into the CODESYS package.** The engine is clean, and 3.3 keeps it that way.

## 4. The TwinCAT native converter

> Now one of **two** adapters onto the same model — see §4a for the CODESYS one. The `BoxTree*` shapes below
> are that shared model, which is why both adapters target `GraphModel` and not each other.

- [ ] 4.1 `BoxTree*` → `GraphModel`. Shapes measured: `BoxTreeAssign` (plain assignment, LD),
      `BoxTreeBox` carrying its own `OutputItems`/`InputItems` (FBD), `BoxTreeDemux` (EN/ENO), `BoxTreeOperand`,
      `Operand`, `Operator`, `ParamList`. More than one shape — stated plainly — but every one is a LOCAL tree:
      no `refLocalId` edges, no id chasing, no ladder lowering.
- [ ] 4.2 `GraphModel` → `BoxTree*`, and the whole-document write.
- [ ] 4.3 **Take `Title`/`Label`/`Comment`/`OutCommented` into the model** — for BOTH vendors, not as a
      TwinCAT concession (§1b.8). A disabled network is running-program state and
      this transport carries it; the model currently has nowhere to put it (`NetworkTextWriter` emits `DISABLED`
      but nothing reads it back across XML).
- [ ] 4.4 Close the coherence question first: a method's `<ST>` read back EMPTY from the document immediately
      after `ImplementationText` was set. Understand that before writing members through the document.

## 3b. Target layout — REVISED, and the folder move comes FIRST

Supersedes §3's ordering and its destination for PLCopen. Full reasoning and the measured per-file placement are
in `layout.md`.

**What changed:** §3 moved PLCopen *into the CODESYS package*. With CODESYS on the object model, PLCopen has no
vendor to belong to — it is **deleted**, not rehoused. And the move is now the FIRST step rather than the last,
because it changes no behaviour and immediately buys a checkable invariant.

```
Volt.Engine/
  Ide/  Item/ (+ ItemContent)  Library/  Sync/
  Format/     VOLT'S OWN ONLY   St/  Network/  Body/
  PlcOpen/    A VENDOR FORMAT, ON ITS WAY OUT (+ DIALECT.md)
```

- [x] 3b.1 **The folder move** — DONE 2026-08-28. Build clean (0 errors, 27 warnings, unchanged from
      baseline); offline suites **706 / 142 / 80 / 3, all green**, i.e. exactly the pre-move numbers.
      `NoStaleNamespaceTests` gained `Volt.Engine.Source` as a retired namespace — that guard's own stated
      protocol for a rename — so a stale reference in a COMMENT fails the build too. Originally described as:, pure relocation + namespace rename, no behaviour change.
      `Volt.Engine.Source.*` -> `Volt.Engine.Format.*` for Volt's own formats, `Volt.Engine.PlcOpen` for the
      vendor format, `ItemContent` -> `Volt.Engine.Item`. 119 files across the solution reference the old
      namespaces; this is wide but mechanical, and the build is the check.
- [x] 3b.2 **Invariant, live from that commit — and it landed STRONGER than written.**
      `Volt.Engine/Format/` contains zero `XElement` / `XDocument` / `XNamespace` / `XAttribute` references
      **and does not reference `Volt.Engine.PlcOpen` at all.** Two files the XML count had placed in `Format/`
      (`GraphRoundTrip`, `BodyFormatGuard`) turned out to be PLCopen-bound by DEPENDENCY while mentioning no
      XML themselves; the compiler caught both. See `layout.md` — the count is a first pass, the build is the
      adjudicator.
- [x] 3b.3 **Did NOT split the mixed files during the move** (`InstanceTypes`, `NetworkCode`, `NetworkSplice`,
      `BodyCodec`, `BodySpliceGuard`, `BodyGuard`). They go to `PlcOpen/` whole. A move that also changes
      behaviour is not reviewable as a move; §2 pulls their neutral halves back out.
- [x] 3b.4 `Source/DIALECT.md` -> `PlcOpen/DIALECT.md`, which is the path `CLAUDE.md` already documents. The
      per-vendor split of that document (§2.4) happens when the adapters land, not now.
- [ ] 3b.5 **Delete `PlcOpen/` outright** once both adapters exist, and add the `bun run check` guard so it
      cannot come back. This is 3.3, restated as a deletion rather than a relocation.

## 4a. The CODESYS NWL adapter (new — gated on 1b.10)

- [ ] 4a.1 `NWLImplementationObject.NetworkList` -> `GraphModel`, via `INWLItemVisitor` rather than a parser.
- [ ] 4a.2 `GraphModel` -> typed objects, using `SetTree` / `AppendTree` / `RemoveNetworkItem`.
- [ ] 4a.3 Language detection by **aspect type** (`NWLImplementationObject` / `STImplementationObject` /
      `CFCImplementationObject`), replacing the body-element sniff. CFC/SFC/IL stay markers — now identified by
      a cast instead of by a missing element.
- [ ] 4a.4 **Delete on the CODESYS side**: `GraphReader`, `GraphWriter`, the PLCopen splice path, and — if
      1b.10 passes — the carry/refuse machinery, which exists only because a body is regenerated from a
      projection. Nothing is regenerated when the objects are edited in place.
- [ ] 4a.5 **Pin the assembly version.** `NWLObject` is an internal 3S assembly with no compatibility
      commitment, at `3.5.13.0` on CODESYS and `3.5.13.30` on TwinCAT today. The adapter must fail loudly with
      the observed version in the message when a member is missing — never silently degrade. (This is the same
      durability question §1.5 raised against GUID typing, and it applies here too.)

## 5. What happens to the other in-flight changes

- **`declaration-from-the-aspect`** — SHIPPED and stays. The aspect is the object model rather than a
  serialization, so it is correct under any transport. For TwinCAT it may become redundant (the native document
  carries the declaration verbatim); redundant is not wrong, and it stays until that is proven.
- **`lossless-push`** — becomes **CODESYS-only**, or disappears entirely if §1 finds a better CODESYS transport.
  It exists because a body is regenerated from a projection; TwinCAT will no longer regenerate.
- **`splice-graphical-body` §2.1** (the LD contact demotion) — **closes for TwinCAT for free**: there are no
  contacts in the native form. Stays open for CODESYS pending §1.

## 5b. NO LEGACY — the old path is DELETED, not kept

The settled transports, so this is never ambiguous again:

| vendor | transport | call |
|---|---|---|
| **TwinCAT** | the **native document** | `ITcPlcPou.DocumentXml` get/set |
| **CODESYS** | **PLCopen XML** | `export_xml(objs, "", recursive, false, TRUE)` / `import_xml(Replace, xml, false)` — the 5th export flag is what emits `InterfaceAsPlainText`, and Volt passes it |

**This repo has form for leaving the predecessor standing.** `NoTestOnlyCodeInSrcTests` exists because the write
path was unified three times and *each unification left its predecessor shipped, compiled, documented and called
by nothing* — `GraphSplice.SpliceFbdLdBody` (~97 lines), `PushService.RemoveOrphanChildren` (19 lines, which then
received a bug fix, inertly), and `NetworkCodeIo` (66 lines whose own comment said "A TEST SEAM, kept
deliberately", in `src/`). A fourth would be the same mistake with better paperwork.

So, as acceptance criteria rather than intentions:

- [ ] 5b.1 **No vendor-selecting fork in the engine.** Not a flag, not a strategy interface with one live arm, not
      an `if (vendor == …)`. The driver answers `ReadContent`/`WriteContent`; the engine never learns which
      transport produced the answer.
- [ ] 5b.2 **`ReadXml`/`WriteXml` are REMOVED from `ICodeStore`**, not deprecated and not left as adapters.
- [ ] 5b.3 **The TwinCAT PLCopen path is deleted** once the native converter lands — `ExportPouXml`,
      `ImportPlcOpenXml`, and the `Move`-back that only existed because the PLCopen import relocates every item
      to the project root (W11). Its reason for existing is gone with it.
- [ ] 5b.4 **`RestoreChildFolders`, `LowerLadder` and the `InstanceTypes` declaration text-parse are deleted for
      TwinCAT** — the native document carries `FolderPath`, stores no contacts, and types its operands inline.
      Each is dead weight there, and dead weight that still runs is how a bug gets fixed inertly.
- [ ] 5b.5 **`NoTestOnlyCodeInSrcTests` must be green with no new allowlist entries.** An entry added during this
      change is the failure it was written to catch. (It has one known blind spot, recorded in
      `declaration-from-the-aspect`: a name mentioned in a COMMENT keeps dead code looking alive. Do not lean on
      it as the only check.)
- [ ] 5b.6 **No compatibility shim for the fixture corpus.** Recorded PLCopen fixtures stay as CODESYS fixtures;
      TwinCAT gets newly recorded native ones. A converter that exists only to keep old test data alive is
      legacy with a test-shaped excuse.
- [ ] 5b.7 **Line count goes DOWN.** Measured before/after per package. The TwinCAT converter is supposed to
      DELETE more than it adds (ladder lowering, instance-type inference, folder restoration, carry/refuse). If
      the total grows, the claim was wrong and the close-out says so.

## 6. Gates

- [ ] 6.1 Both vendors' e2e green, from a verified-clean environment (solution loaded, `--xae-pid` workers,
      pid-suffixed pipes — the checklist in `declaration-from-the-aspect` §6 exists because three runs were
      misread as regressions).
- [ ] 6.2 **Byte-for-byte round-trip on a corpus of real POUs**, per vendor: pull, push unchanged, pull again,
      compare. On TwinCAT this should be exact; where it is not, the difference is the vendor's normalization and
      must be named.
- [ ] 6.3 The wire is unchanged: both vendors still serve byte-identical responses for the same project. This is
      the invariant the whole split rests on.

## 7. Explicitly NOT in this change

- **Changing the wire or the parity boundary.**
- **CFC/SFC/IL** — still unsupported, still markers.
- **A third IDE.** The refactor makes one possible; adding one is separate work.
