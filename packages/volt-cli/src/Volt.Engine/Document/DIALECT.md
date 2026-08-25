# CODESYS ⇄ TwinCAT PLCopen dialect

**The one home for vendor facts about this layer.** It lives beside the code it describes, not in a change
folder, because a change gets archived and these facts do not stop being true. When a measurement lands, correct
it HERE and delete the claim from wherever else it crept into a doc-comment.

The structural conclusion first, because it is what the layer is shaped by:

> **The read path is a union — one tolerant reader serves both vendors. The write path is not, and its one deep
> divergence lives below the vendor seam in two `WriteXml` implementations. Nothing in Core branches on a vendor
> name, and nothing should start.**

There is deliberately **no dialect abstraction**. The gap between the two vendors is not missing indirection, it
is missing EVIDENCE: 16 facts below have never been measured on the other side. A class hierarchy would not have
caught that; the two-vendor fixture matrix in `PouSpliceTests` does. Every entry cites code, a recorded fixture, or is marked
**UNMEASURED**. Paths are relative to `packages/volt-cli/`.

*recorded* = a real vendor export committed as a fixture. *live-claimed* = asserted in a doc-comment or an
openspec task as measured against a running IDE, with no artefact in the repo. *synthetic* = hand-authored XML
(`fixtures/roundtrip/*` are synthetic — their own headers say so).

## The headline

**The single-document POU write has only ever been measured on CODESYS**, and the code says so in three places,
cited by SYMBOL rather than line because these citations have already drifted twice and a stale line number sends
the next reader to unrelated code: `ICodeStore.WritesPouAsOneDocument` (the contract + the evidence),
`DriverBase.WritesPouAsOneDocument` (defaults false), `CodesysDriver.WritesPouAsOneDocument` (true). TwinCAT falls
through to the per-child path in `PushService.WriteItemFromSource`, in the `if (!ide.WritesPouAsOneDocument)` arm
and the per-child loop below it.

`PlcOpenSpliceTests.cs:23-24` uses exactly two fixtures — one CODESYS, one TwinCAT — and the TwinCAT one exercises
only `SetDeclaration`, the non-ST refusal, name-scoping and action removal. **`AddChild`, `SetAccessor`, property
add and `SetChildText`-on-a-method are tested against CODESYS fixtures only**, because no TwinCAT fixture in the
repo contains a method, a property or an accessor.

## Classification

| | meaning |
|---|---|
| **A** | Cosmetic union — one tolerant reader serves both; no per-vendor code wanted |
| **B** | Genuinely needs per-vendor behaviour |
| **C** | A vendor LIMIT — one side simply cannot do it |
| **D** | UNMEASURED — believed, never verified |

### A — absorbed by one tolerant reader (16)

| # | Divergence | Evidence |
|---|---|---|
| A1 | `ReadXml` of a CHILD: CODESYS returns a doc rooted at the method; TwinCAT returns the whole enclosing POU | `TcObjectModel.cs:401-412`; absorbed by name-scoping (`OwnerOf`, `ItemBody`, `FindFbdLd`) |
| A2 | BOM: CODESYS's string carries one (stripped at `CodesysObjectModel.cs:788`); TwinCAT's does not | fixture headers |
| A3 | `fileHeader` productName/companyName differ | `corpus/POU.plcopen.xml:3` vs `tc-fbd/PLC_PRG.plcopen.xml:3` — **nothing reads it**; the cheapest dialect discriminator if ever needed |
| A4 | `projectstructure` addData: TwinCAT always, CODESYS only with `bExportFolderStructure` | 6/6 `tc-*`; 1/5 `codesys-pou` |
| A5 | `objectid` addData: TwinCAT always; CODESYS flag-gated. TwinCAT ALSO stamps `ObjectId=` as an ATTRIBUTE on every member element unconditionally (`tc-pou/FB_TcMembers.plcopen.xml:34, 63`), where CODESYS does so only with the folder flag. Never read; survives because the splice edits | `tc-fbd/PLC_PRG.plcopen.xml:212-214`; `FB_ChildFolderStructure.plcopen.xml:35` |
| A6 | `handleUnknown` value distribution | grep counts |
| A7 | **`InterfaceAsPlainText` copy count** — CODESYS TWICE once any variable is declared, TwinCAT ONCE | `corpus/POU.plcopen.xml:45`+`:197`, `FB_TwoDeclCopies.plcopen.xml:35`+`:142`; vs `tc-fbd/PLC_PRG.plcopen.xml:225` (sole copy, 3 localVars). Handled by `OwnDescendants` — **after a live failure**, see below |
| A8 | Interface export has no `<pou>` on BOTH vendors (was believed TwinCAT-only) | `codesys-itf/IModuleManager.plcopen.xml:45`; `PlcOpenPouParser.cs:53-59` |
| A9 | `<actions><action>` lowercase, before `<body>`, on BOTH | `FB_FolderChild.plcopen.xml:27,38`; `tc-fbd/PLC_PRG.plcopen.xml:45,218` |
| A10 | Access modifiers / attributes addData — CODESYS only; survives because the splice edits, never regenerates | `BoxFB.plcopen.xml:110-112` |
| A11 | `<documentation>` — CODESYS interface only | `IModuleManager.plcopen.xml:77-79` |
| A12 | FBD body placement + 10¹⁰ localId striding — identical | `corpus/POU.plcopen.xml:58`; `tc-fbd/PLC_PRG.plcopen.xml:47` |
| A13 | `fbd/implementationattributes` vendorElement — both emit it, both silently drop it on push | in `SafeToDrop` |
| A14 | `fbdcalltype`/`inputparamtypes`/`outputparamtypes` in FBD — identical | both |
| A15 | `typeName` casing: CODESYS **CFC** lowercase (`and`), FBD uppercase; TwinCAT uppercase | `FbdOperators` is `OrdinalIgnoreCase` |
| A16 | TwinCAT LD blocks omit the param-type addData (its FBD blocks carry it) | `tc-ld/ld_ton_rung_two_networks.plcopen.xml:152-157` |

> **A7 is the one that already bit.** Writing only the first copy meant a declaration change was accepted and did
> nothing — 31 red e2e tests, a deleted FB's instance stuck in `PLC_PRG`, the project not compiling. Every offline
> fixture had an EMPTY `<interface>` and therefore ONE copy, which is why the whole offline suite stayed green over
> an inert write path. Pinned now by `codesys-pou/FB_TwoDeclCopies.plcopen.xml`.

### B — genuinely per-vendor (7)

| # | Divergence | Where it lives |
|---|---|---|
| B1 | Transport: CODESYS in-memory `export_xml(…, "", …)`; TwinCAT file-based `PlcOpenExport(path, selection)` | two `ICodeStore` impls — correct |
| B2 | Export selection: CODESYS a node; TwinCAT a `'.'`-separated project-relative path, walking up to the enclosing POU | `TcObjectModel.cs:390-427` |
| B3 | Body-language gate: CODESYS a full export + element name; TwinCAT a cheap `ImplementationText` sniff (`<NWL>`/`DefaultViewMode`) | `TcPouReader.cs:16-43`; deliberate, `ARCHITECTURE.md:179-181`. Cost: ~20 ms vs ~1 ms |
| B4 | **LD-as-FBD read** — a TwinCAT empty LD body exports inside `<FBD>`; the COM language is authoritative. **Currently NOT handled on the production read path** — the override is dead | `GraphReader.cs:15-19`; `Materializer.cs:123-131` passes the element's own name |
| B5 | **CFC body placement** — CODESYS nests it under `<body>/<addData>/<data name="…/cfc">`, not as a direct child. **Not handled at all** | see Defects below |
| B6 | **Import mode** — CODESYS merges in place (`Replace`, no delete); TwinCAT ADDS and FAILS on a name collision, so it must delete first | `CodesysDriver.Code.cs:37-52` vs `TcPlcOpen.cs:38-51`. **The deepest genuine divergence in the path** |
| B7 | `CreateChild` semantics — TwinCAT rejects String vInfo on a FUNCTION, rejects `"ST"` on interfaces, wants the return type as vInfo for interface members, rejects `"LD"`; CODESYS ignores the language entirely | `TcObjectModel.cs:319-340`; `test/e2e/vendor-notes.test.ts:4-7` |

### C — vendor limits (6)

| # | Limit |
|---|---|
| C1 | TwinCAT `PlcOpenExport` has **no flags** — the export shape is not tunable |
| ~~C2~~ | ~~TwinCAT answers **`E_FAIL` for every DUT and GVL** export~~ — **WRONG, twice over, and it cost a capability flag.** Measured: `PlcOpenExport` exports a root DUT (2012 chars, `<dataType>`), a root GVL (1983, `<globalVars>`) and a FOLDERED DUT (`VltProbeF.VltProbeDutF`). What fails is a BARE name for a foldered item — `PlcOpenExport('PLC_PRG')` answers *"Selection 'PLC_PRG' not found!"* — because the selection grammar is the DOTTED project-relative path. **The E_FAIL was Volt's own**: `ExportPouXml` called `EnclosingPou`, which climbs `node.Parent` until it finds a POU, and for an item that has none the walk runs off the top of the tree where `Parent` throws COMException E_FAIL. `PlcOpenExport` was never reached, so the vendor never refused anything. Fixed by choosing the export target by KIND (`IsInlinedInPou`), which cannot run off the tree |
| **C2b** | **AND THE SECOND REASON WAS ALSO OURS: `623` IS `TREEITEMTYPE_PLCDUTALIAS` ON TWINCAT, NOT A GENERIC DUT.** With the export fixed, DUT creates still failed — TwinCAT's importer validates against TC6 and rejected an empty `<baseType/>` as "incomplete content". True, and the object was malformed before any export: `CreateChild` refuses a null vInfo for 623 (*"Base class not specified!"*) and takes any string as the alias's BASE CLASS, so Volt — passing the body language — created every DUT as an alias to a type named **"ST"**. The per-child write only survived it because `WriteText` landed the real declaration afterwards; the document path exports first. Measured, creating with the real subtype: **606 → `<baseType><struct/>`, 605 → `<baseType><enum><values>`, 607 → union — all three round-trip their own export AND take a spliced declaration.** And one seed serves all four: create **606** and let the pushed declaration re-derive, exactly as CODESYS does with `DutType.Structure` — struct stays 606, an enum declaration becomes 605, a union 607, and an alias (`: INT;` or `: STRING(80);`) becomes 623 with the right base. `TcObjectModel.CreateChild`. **Every source kind now travels as ONE PLCopen document on both vendors; the `CanExportDocument` capability added for this is deleted** |
| **C2c** | **TwinCAT HAS a library-signature surface** — `_ITcPlcLibraryManager.ProduceAllLibrarySignatures()` returns 181,179 chars of structured signatures (FB/function names, comments, typed inputs/outputs) on the fixture, out-of-process, today. So "TwinCAT has no resolved-library-signature surface yet" and ARCHITECTURE's "TwinCAT (out-of-process) can't extract" are both wrong; Volt simply implements no extraction there. The per-library `ProduceLibrarySignatures(pLibRef: VT_PTR)` wants a raw pointer an RCW does not satisfy — the all-libraries call needs no argument |
| **C2d** | **CODESYS's `create_pou` DOES take an implementation language.** Enumerated off the live scripting container: `create_pou(name: String, type: PouType [opt], language: Nullable\`1 [opt], return_type: String [opt], base_type: String [opt], interfaces: String [opt])`, and `create_function`/`create_function_block`/`create_program` each take one too. `CodesysObjectModel.CreateChild`'s "CODESYS's create_pou has no implementation-language parameter" was an inference. Volt still seeds and lets the import set the language, which works — but the reason recorded for it was false |
| **C2e** | **A TwinCAT `.tsproj` CAN hold more than one PLC project, and Volt silently binds the FIRST.** `TcObjectModel.FindPlcProject` iterates `TIPC`'s children and `break`s on child 1, so a second PLC project is invisible to `refs`/`fetch` — and invisible reads as DELETED to a pull. Read off the code, not measured live: creating a second PLC project over COM is refused (`CreateChild(56)` → "SubType not supported!"), so confirming the end-to-end behaviour needs a hand-authored two-project fixture. `ProjectEntry`'s "a CODESYS or TwinCAT project has no child projects" is wrong either way |
| C3 | TwinCAT's importer drops `negated` on an `<inVariable>`, so negation is encoded as `NOT x` in the expression text for BOTH vendors — `GraphWriter.cs:108-115` |
| C4 | TwinCAT's importer **crashes** on leaf fan-out ("Index was outside the bounds of the array"); refused globally in Core — `NetworkCode.cs:70-86` |
| ~~C5~~ | ~~TwinCAT has **no move primitive**~~ — **WRONG, and now implemented.** No `Move`/`Reparent` member exists (D4f settles that by enumeration), but `ExportChild`/`ImportChild` ARE one once the archive's entry paths are flattened. `TcItemArchive.Move` |
| C6 | TwinCAT `CreateChild` cannot create `"LD"` — created as FBD (the ladder view rides along as `DefaultViewMode` in the NWL archive, which `TcPouReader` preserves on read-back). **The vendor limit is only that.** What actually failed every LD create on the single-document path was Volt's own guard: `CreateChild` seeds FBD, the document then shows an empty `<FBD/>`, and `PouSplice.SetBody` read that as "made graphical on purpose" and refused the very LD body the same push was creating. A body language guard protects an ENGINEER's diagram; on a CREATE there is not one yet, and the document cannot tell the two apart — hence `SetBody(… establishing:)` |

### D — UNMEASURED (16)

**On TwinCAT:**

| # | Never verified |
|---|---|
| ~~D1~~ | **CLOSED — YES.** `PlcOpenImport` accepts a spliced document and the edit lands. Measured live on TcXaeShell 15.0 |
| ~~D2~~ | **CLOSED — YES, content survives in full.** Through the delete-then-import round trip: the method's body, the property, and BOTH accessor bodies all came back intact. Fixture `tc-pou/FB_TcFolderedMember.plcopen.xml` |
| ~~D3~~ | **CLOSED — the PLAINTEXT drives it**, exactly as on CODESYS. A var spliced into `InterfaceAsPlainText` alone, leaving the typed `<interface>` stale, landed in the IDE's declaration. This is what lets a splice write declarations at all |
| ~~D4~~ | **CLOSED — no USABLE move, but the first answer was measured wrongly and the correction matters.** There is no `Move`/`Reparent` member (that part held). But `ExportChild`/`ImportChild` DO exist on every tree item including a folder, and the first probe missed them because it looked for methods with a PROPERTY read (`CallType::Get`), which can never find one. Signatures from the installed TLB (`Components/Base/TypeLib/TCatSysManager.tlb`): `ExportChild(bstrName, bstrFile)`, `ImportChild(bstrFile, bstrBefore, bReconnect, bstrName)`. **They are still not a move**: the archive carries the item's SOURCE PATH, so importing into another folder recreates that hierarchy underneath it — moving `POUs/X` into `Moved` yields `Moved/POUs/POUs/X`. Usable only with a way to rewrite the path inside the archive, which has not been found. Two more facts if anyone tries: `ExportChild` REQUIRES a `.zip` filename (`.xml`, `.tszip`, `.tpzip`, `.tczip`, `.tcpou`, `.xti`, `.tsproj` are all refused), and `ImportChild`'s 4th argument RENAMES the child, which TwinCAT rejects outright ("Cannot change imported child name!") |
| **D4b** | **NEW, and a LIVE BUG.** `PlcOpenImport` lands the item at the **PLC-PROJECT ROOT**, never in the folder it came from. It is not on a folder tree item at all (`ITcSmTreeItem` has no such member) and takes only `(path, options)` — a third argument naming a target folder is `DISP_E_TYPEMISMATCH`. So placement is **unrecoverable** on TwinCAT: the primitive cannot target a parent and there is no move to fix it afterwards |
| **D4c** | **NEW, and it REOPENS D4b — the import options were never varied.** `TcPlcOpen` hardcodes `PLCIMPORTOPTIONS_NONE = 0`, the only value Volt has ever passed, and D4b/D1-D4 were all measured through it. Measured live on TcXaeShell (XAE pid 2036, fixture `TwinCAT Project13`, POU `PLC_PRG`), sweeping the options argument: `0` → **fails** with "Creation of object 'PLC_PRG' failed. Reason: Import conflict!" (the collision D4b's delete-first exists to avoid); **`1` → REPLACES IN PLACE** — item count unchanged (7→7, re-measured 10→10), no delete, no duplicate; `2`, `4`, `8` → each ADDS a copy (count +1 every time). **`1` is not a silent skip**, which is the trap CODESYS's `ConflictResolve.Skip` set: a marker comment spliced into the body via `PouSplice.SetBody` was present in the re-export afterwards (`CONTENT LANDED = True`). So TwinCAT HAS the `ConflictResolve.Replace` equivalent that made the CODESYS single-document write possible, and D4b's "placement is unrecoverable" was a property of **delete-then-import**, not of `PlcOpenImport` — nothing is deleted under `1`, so there is nothing to relocate. Still OPEN and NOT to be assumed: whether a merge under `1` flattens a POU's INTERNAL child folders the way CODESYS's does (CODESYS repairs that with `move()`, which TwinCAT lacks — D4) |
| **D4d** | **NEW — a TwinCAT PLCopen import INVALIDATES every handle to the item it replaced.** Any later COM call on that handle answers *"Item 'x' is deleted or invalidated by an ealier operation!"*. CODESYS's merge does NOT do this, and `PushService` carried the CODESYS reading as a general one ("`WriteXml` is a merge with no delete, so `pou` is not stale") — true there, false here. A graphical push reaches `RemoveOrphanChildren` immediately after `NetworkCode.Write` has imported, so on TwinCAT it was reconciling through a dead handle. **It went unseen for as long as it did because `BeckhoffDriver.ChildCount` caught the fault and answered `0`**: the orphan walk became a silent no-op, so a method deleted from a graphical POU survived in the IDE — the very bug the walk had been made unconditional to fix, still happening one layer down. Fixed by re-acquiring the item after the content write (`ItemLookup.Find`, hard-failing on a miss); the driver's accessor no longer fabricates `0`, so the next such fault is loud |
| **D4e** | **SUPERSEDED by D4f-D4h — read those first.** Every "not fixable in Core" claim below rested on `IProjectTree.Move` being impossible on TwinCAT, and it is not. Kept because the three failure modes it names are the right decomposition; modes (1) and (2) are now fixed and mode (3) stands. ~~MEASURED, and it CLOSES §5: TwinCAT cannot take the single-document write. The second write arm is permanent.~~** Enabling `WritesPouAsOneDocument` on `BeckhoffDriver` and running the full live suite gives **36 failures / 60 pass** (against 96/0 on the per-child arm), in three distinct modes, none of them fixable in Core: (1) **PLACEMENT IS LOST** — a POU in `POUs/Sub` comes back with folder `""`. The import lands it at the PLC-project root exactly as D4b says, and `RestoreChildFolders` cannot put it back because `IProjectTree.Move` throws `Unsupported` on this vendor (D4 — `ExportChild`/`ImportChild` carry the item's source path, so they recreate rather than move). This is the whole ballgame: CODESYS survives the same flattening ONLY because it has `move()`. (2) **HANDLES DIE MID-OP** — *"Item 'VltE2E_p_upd' is deleted or invalidated by an ealier operation!"* on a 3-op push, because the import invalidates every handle to the object it replaced (D4d) and the one-document path keeps working with the handle afterwards. (3) **THE BODY LANGUAGE IS NOT ESTABLISHED ON CREATE** — every LD create lands as FBD (*"has a FBD body in the IDE but the push carries LD"*), so on TwinCAT the import does not set the language the way it does on CODESYS, where `CreateChild`'s seed is overwritten by the imported body element. **Per §5.5 this is a vendor limit to RECORD, not to work around**: do not reintroduce a Core-side compensation. The honest consequence for the rewrite is that `WritesPouAsOneDocument` and the per-child arm are NOT transitional — they stay until Beckhoff ships a reparent verb, and the second arm should be NAMED rather than treated as going away |
| **D4f** | **THE MOVE EXISTS. D4 and C5 were both wrong, and each for a reason worth keeping.** The dispatch surface of `ITcSmTreeItem` was ENUMERATED — `IDispatch::GetTypeInfo` → `ITypeInfo::GetFuncDesc`/`GetNames` on a live tree item — instead of probed by name. There is genuinely no `Move`/`Reparent` member; that half of D4 holds and is now settled rather than assumed. What the enumeration also gave was the real signatures, which two earlier probes had guessed at: `PlcOpenImport(bstrFile, options, bstrSelection, bFolderStructure)` — **four** arguments, of which Volt has ever passed two, and D4b's "a third argument naming a target folder is `DISP_E_TYPEMISMATCH`" was landing on `bstrSelection`, never reaching the folder flag at all. And `ExportChild(bstrName, bstrFile)` / `ImportChild(bstrFile, bstrBefore, bReconnect, bstrName)`. **The archive is a plain zip and the item's source path is an ENTRY NAME** — that is the "way to rewrite the path inside the archive" D4 said had not been found. Measured, all four cells: exporting `VltProbeF/VltProbePou` yields one entry `VltProbeF\VltProbePou.TcPOU` and importing it into `VltProbeG` gives `VltProbeG/VltProbeF/VltProbePou` (D4's path recreation, reproduced); **rename that entry to `VltProbePou.TcPOU` and the same import gives `VltProbeG/VltProbePou`** — a true move. It carries CHILDREN (an FB with a method arrives with `childCount=1`) and therefore graphical bodies, which `PushService`'s delete-and-recreate move can never do. Implemented as `TcItemArchive.Move`; only entry names are rewritten, every entry's bytes are copied through untouched |
| **D4g** | **`PlcOpenImport` ALWAYS deposits at the PLC-project root — measured exhaustively, and it is a property of the EXPORT.** The full matrix (`options` ∈ {1,2,4,8} × `bFolderStructure` ∈ {false,true} × `<ProjectStructure>` flat/hand-nested = 16 cells) was run against a POU genuinely sitting in a folder. Under `REPLACE` all eight cells relocate it to the root; under the ADD options all eight leave the original alone and drop the copy at the root. Neither the folder flag nor a hand-nested structure block changes anything, and the reason is upstream: **TwinCAT's PLCopen EXPORT writes a FLAT `<ProjectStructure>`** — `<Object Name="VltProbePou" ObjectId=…/>` with no enclosing folder — so the placement is not in the document for any import flag to honour. D4b's "unrecoverable" was therefore half right and half a measurement gap: the relocation is real and unavoidable, but it is now UNDONE in the vendor layer (`TcObjectModel.ImportPlcOpenXml` moves the item back via D4f), so `ICodeStore.WriteXml` means *write this document to THIS item, in place* on both vendors and the asymmetry stops below the seam |
| **D4h** | **`<ProjectStructure>` is what TwinCAT's importer keys POU CHILDREN off — and it is the reason the single-document write still fails there.** With `WritesPouAsOneDocument` on and D4f/D4g in place the live suite improves from D4e's 36 fail to **29 fail / 67 pass**, and the largest remaining class (~16 tests) is *every child is missing, including on the CREATE*. Isolated with a three-cell probe on a freshly-created FB spliced with one method: (A) the document exactly as `PouSplice` writes it → `childCount=0`; (B) + an `ObjectId` attribute on `<Method>` → `childCount=0`; (C) + the child ALSO listed inside `<ProjectStructure>` → **`childCount=1`**. So the `<data name="…/method"><Method>` addData block alone is ignored: a member exists for TwinCAT only if `<ProjectStructure>` declares it. CODESYS emits the block `handleUnknown="discard"` and drops it on import, which is why `PouSplice` was written never to maintain it — the splice edits members and leaves the structure block stale, and the document ends up internally inconsistent (members in one place, "no members" in the other). TwinCAT's own export, as ground truth: `<Object Name="Meth" ObjectId=…/>` for a method (id as an ATTRIBUTE on `<Method>`), `<Object Name="Act" ObjectId=…/>` for an action (id in a NESTED `<addData><data …/objectid>` under `<action>`), `<Object Name="Prop" …/>` for a property, and **`<Folder Name="Sub"><Object Name="InFolder" …/></Folder>` for a POU-internal child folder** — the structure `RestoreChildFolders` repairs with `move()` on CODESYS is expressible in the document here. Making the splice maintain the block is a shared-document fix, not a TwinCAT workaround |
| **D4i** | **A POU-INTERNAL MEMBER FOLDER DOES NOT SURVIVE A DOCUMENT IMPORT ON TWINCAT.** The folder IS in the document — TwinCAT's export writes `<Folder Name="Inner"><Object Name="Helper" .../></Folder>` inside `<ProjectStructure>` (fixture `tc-pou/FB_TcFolderedMember.plcopen.xml`) — and its importer ignores it. Measured as a 2x2: folder pre-created via the scripting API or not, member nested in `<Folder>` in the document or not; all four cells land the member at the POU ROOT with the folder deleted. (An earlier reading said the nested member was DROPPED entirely; that was a probe artifact — `WalkItems` does not descend into a POU, so no member was ever visible to it. The member IS created; only its placement is lost.) So `ProjectStructure` writes members FLAT: the nesting is honoured by neither vendor (CODESYS discards the whole block) and buys nothing. **The placement is restored afterwards — see D4j**, which is why this is a detour rather than a blocker |
| **D4j** | **AND IT IS RESTORABLE — the member's folder is an attribute in the POU's OWN file. This was the last thing blocking the single-document write on TwinCAT, and it is closed.** `ExportChild` REFUSES a member — *"The tree item 'Deep' cannot be exported seperately because it has no document file. Please export the parent node that contains the document!"* — which reads like the end of the road, and is instead the whole clue: a member is not a file because TwinCAT keeps the entire POU, members and all, in ONE `.TcPOU`. Read that file and the placement is right there. Measured live, the complete shape: `<Folder Name="Helpers" Id="{guid}">` elements that NEST by element, one path segment each; and on the member `FolderPath="Helpers\Inner\"` — full path, backslash-separated, TRAILING separator — with the SAME attribute on `<Method>`, `<Action>` and `<Property>` alike. So the relocation happens one level up: export the POU, rewrite the attribute (and create the `<Folder>` chain), delete, re-import. Verified on a textual AND an FBD member in one go: both land in the folder, bodies intact — the archive is the vendor's own format, so nothing is rebuilt from text. Cost, and it is real: placing a member is a full POU round trip, so a POU with N foldered members pays N of them, and each one INVALIDATES every handle into that POU. `PushService.RestoreChildFolders` therefore re-finds the POU once per member — it used to hoist that lookup out of the loop, which was correct only while CODESYS (whose move touches nothing but the moved object) was the sole driver that reached it |
| ~~D5~~ | **CLOSED — measured, and IDENTICAL.** TwinCAT's member shape matches CODESYS's exactly: `<data name="…/method"><Method name= ObjectId=>`, `<data name="…/property"><Property>` with `<GetAccessor>`/`<SetAccessor>` nested. Recorded live from TcXaeShell as `tc-pou/FB_TcMembers.plcopen.xml`. `PouSplice.AddChild`'s shape is right for both vendors → **category A** |
| ~~D6~~ | **CLOSED — measured, and it DIFFERS.** TwinCAT emits **Get before Set** (`tc-pou/FB_TcMembers.plcopen.xml:69`, `:83`); CODESYS emits **Set before Get** (`codesys-pou/BoxFB.plcopen.xml:304`, `:331`). Order only, so → **category A** — but `SetAccessor` claimed "vendors emit Set before Get" as a universal, which was false |
| D7 | Does TwinCAT nest a CFC body under `<body>/<addData>` the way CODESYS does? No TwinCAT CFC/SFC fixture exists |
| D8 | Does TwinCAT's import discard `projectstructure`/`objectid` the way CODESYS's does? |
| D9 | The `PlcOpenExport` selection grammar — still flagged "NEEDS LIVE VERIFICATION" in the source that uses it |
| D10 | Late-bound dispatch reachability of `PlcOpenExport`/`PlcOpenImport` — the note is partly contradicted by the fact that the `tc-*` fixtures were captured through exactly that call, but has never been retracted |

**On CODESYS (the mirror gap, less often noticed):**

| # | Never verified |
|---|---|
| D11 | **The entire LD export/import shape.** No CODESYS LD capture exists anywhere; `GraphWriter` emits TwinCAT's shared-rail form (left rail id 0, right rail 2147483646, regenerated `networktitle` markers) to CODESYS. `GraphWriter.cs:219` claims live CODESYS verification with nothing to show for it |
| D12 | EN/ENO pin naming — `NetworkTextReader.cs:228-232` hardcodes TwinCAT's `EN`/`In2…`/`Out2`/`ENO` and writes it into CODESYS |
| D13 | Embedded output assignment on write — the LD writer always embeds a non-primary output in its pin, a rule derived entirely from live TwinCAT |
| D14 | `negated` on `<inVariable>` — the C3 workaround is exercised by **no fixture on either vendor** |
| D15 | The FBD `<comment>` shape — "CODESYS rejects bare text" (`GraphWriter.cs:69`); no recorded CODESYS export contains a `<comment>` at all |
| D16 | Whether **either** IDE accepts a `<Property>` written without `<interface><returnType>` |

## Structural conclusion

**The read path is genuinely a union and should stay one.** The two real read gaps (B4, B5) are *missing
tolerance*, not missing vendor branches.

**The write path is not a union and does not claim to be.** Its one deep divergence (B6) already lives below the
vendor seam in two `WriteXml` implementations. `WritesPouAsOneDocument` is an explicit, self-documenting staging
flag whose deletion is gated on measurements that have not been taken.

So the structure copes with two dialects through **evidence, not indirection**: one tolerant reader, vendor
difference confined to the driver, and a two-vendor fixture matrix that turns a divergence into a failing test
instead of a live surprise.

D5 — the largest gap — is now CLOSED: `tc-pou/FB_TcMembers.plcopen.xml` was recorded live from TcXaeShell
(an FB with a method, a property and both accessors, a shape that existed nowhere in the repo). It confirms the
member shape is common, closes D6 with a real difference, and corroborates that the two-copy declaration is
CODESYS-only. What remains unmeasured on TwinCAT is all about the IMPORT (D1-D4), which no export can answer.

## Part 9 — false comments found (Convention 8: a false comment is a defect)

1. `PlcOpen/PlcOpenDocument.cs:585-587` attributes `<actions>`-before-`<body>` to TwinCAT. **CODESYS does it too**
   (`FB_FolderChild.plcopen.xml:27,38`). The hazard is real; the attribution is wrong.
2. `Body/Graph/GraphReader.cs:358-360` — "CODESYS and TwinCAT both emit [param types]". True for FBD, **false for
   TwinCAT LD**.
3. `PlcOpen/PlcOpenDocument.cs:196` — "this same import already rejects a BOM". **No evidence for either vendor.**
   The only BOM-rejection evidence concerns workspace source files on a different path.
4. `Body/Graph/GraphReader.cs:15-19` — documents the `language` override as how the TwinCAT empty-LD case is
   handled. It is never fed a vendor language on the production path.
5. `ARCHITECTURE.md:135-136` cites `Graphical/PlcOpenDocument.InterfacePropertyAccessors` — **that member does not
   exist**; accessors come from `PlcOpenPouParser.Accessor`.
6. `Ide/TcPlcOpen.cs:14-21` — "NEEDS LIVE VERIFICATION" on a call the recorded fixtures were captured through. At
   least partly settled, never retracted, which makes §5.1's risk read larger than it is.

## What the STANDARD says (TC6 XML v2.01)

The normative schema is committed at `packages/volt-cli/docs/tc6_xml_v201.xsd` (PLCopen's own download). It
promotes several rows below from "measured on CODESYS" to "specified, and CODESYS conforms" — which matters
because a specified rule is one we may rely on for TwinCAT too, and a vendor quirk is not.

1. **`<body>` is an `xsd:choice` of exactly FIVE: `IL`, `ST`, `FBD`, `LD`, `SFC`** (`:415-444`). **CFC is not in
   the schema at all** — so its `addData` placement is not a CODESYS quirk, it is the only legal option. This also
   settles IL, which was the one inferred row in the locator table: **IL is a direct child.**
2. **`handleUnknown` is `preserve | discard | implementation`** (`:672-678`), and the schema documents the
   processor contract: preserve it, *dismiss it* ("because the data is invalid if not updated correctly"), or use
   the processor default. **CODESYS marks `projectstructure` and `objectid` as `discard`** — so the folder
   flattening we measured is *the standard behaving as specified*, not a defect to work around. The exporter is
   explicitly telling the importer to drop it.
3. **Methods, properties, accessors and interfaces do not exist in TC6 at all** — zero occurrences of `Method`,
   `Property`, `GetAccessor` or an interface `pouType`. `pouType` is `function | functionBlock | program` only
   (`:1751-1753`). The ENTIRE OOP member model is vendor extension, which is why both vendors carry it under the
   same `3s-software` namespace (TwinCAT's PLC engine is CODESYS-derived) and why the "document shape per kind"
   axis has to be a table rather than schema-driven.
4. **The standard has no concept of folders** — zero occurrences of "folder". Organisational placement is
   out-of-band by definition, which is exactly why it travels as `%FOLDER` + `IProjectTree.Move`.
5. `<pou>` allows `body` with **`maxOccurs="unbounded"`** (`:224`) — multiple bodies are legal. Volt assumes one;
   nothing has ever produced more, but the reader should not assume it cannot happen.
6. The typed `<interface>` (returnType / localVars / inputVars …) IS standard (`:117-122`) — so the two-copy
   declaration (typed block + `InterfaceAsPlainText`) is one standard element plus one vendor extension.

## The body LOCATOR table — where a body element actually lives

Measured on CODESYS 3.5.21.40 against hand-authored fixtures, not inferred. Placement was inferred once and the
inference was WRONG (SFC was assumed to sit with CFC; it does not), so every row here cites its fixture.

| language | placement | fixture |
|---|---|---|
| ST | direct `<body>` child | everywhere, e.g. `codesys-pou/FB_FolderChild.plcopen.xml` |
| FBD | direct | `codesys-pou/POU_SfcRoot_StFbdMethods.plcopen.xml` (`fbdmeth`) |
| LD | direct | `tc-ld/*.plcopen.xml` |
| **SFC** | **direct** | `codesys-pou/POU_SfcRoot_StFbdMethods.plcopen.xml` (root) |
| **CFC** | **`<body>/<addData>/<data name="…/cfc">`, AND a sibling empty `<ST>`** | `codesys-pou/FB_GraphicalChild.plcopen.xml` (`doSomething`) |
| IL | direct — **SPECIFIED** by the schema (`tc6_xml_v201.xsd:416`); no fixture, but no longer a guess |

**Support is a separate axis from placement, and IL sits on the unsupported side with CFC and SFC.** Volt
round-trips **ST and FBD/LD only**. IL appears in the model because TC6 defines it and the READER must be able to
recognise one — recognising is not supporting. It is registered as a `ReadOnlyCodec`, exactly like SFC: an IL body
materializes as the `(* @volt-graphical: IL *)` marker and a push leaves it untouched.

It did not always. IL had a bespoke codec that decoded to the **raw body text**, and `Materializer.BodyTextOf`
ended in "anything not FBD/LD/CFC/SFC is text" — so an IL POU materialized as an editable-looking file
indistinguishable from ST source, and a push then rewrote the engineer's IL body as ST. The guards could not stop
it either: `PouReader.GraphicalLanguageOf` and `PushService.GraphicalOnly` both **enumerated** `FBD/LD/CFC/SFC`,
so a language missing from the list was reported as "textual". Both now ask "is it ST?" (`NonStLanguageOf` /
`NonSt`) and the read-only set is read off the codec (`IsReadOnlyLanguage`), so the classification **fails closed**
— a language nobody has considered yet is refused rather than flattened.


The rule is the standard, not a vendor quirk: **PLCopen TC6 defines ST, IL, FBD, LD and SFC as body languages, so
each gets a real element whose NAME is the language. CFC is a CODESYS extension with no place in the schema, so it
goes in vendor `addData`** — and the schema still wants a body language present, which is why an empty `<ST>` sits
beside it. That decoy is what made a direct-children scan answer `"ST"` for a CFC body.

**Consequence for the body codec:** a codec owns its element's LOCATION, not just its name. ST patches the direct
child in place (byte-identity on no-op); FBD/LD/SFC replace the whole element (the name is the language, and the
language can change); CFC reads from `addData` and refuses to write.

**Kinds with NO body element at all:** interface, DUT (incl. enum, alias and union), GVL — measured. The locator
must tolerate an absent body rather than assume one.

A document legitimately mixes languages: `POU_SfcRoot_StFbdMethods` is one file carrying an SFC root, an ST method
and an FBD method.

## The ITEM SHAPE table — where the item element itself lives, and where its members go

The second per-kind axis, and the one that let every writable kind join the single-document write. Same source as
above: measured on CODESYS 3.5.21.40 (probes 13–16), every row with a committed fixture.

| kind | item element | members | body |
|---|---|---|---|
| program / function / functionBlock | `types/pous/pou` | `addData/data[…/method\|property]`, actions in `<actions>` | yes |
| **interface** | `addData/data[…/interface]/Interface` | **`<Methods>` / `<Properties>`** — plain containers, no `data` wrapper | **no** |
| DUT — struct, enum, **alias** | `types/dataTypes/dataType` | none | no |
| **DUT — union** | **`addData/data[…/union]/union`** | none | no |
| GVL | `addData/data[…/globalvars]/globalVars` | none | no |

The division is the SCHEMA's, not a vendor whim: **`pou` and `dataType` are TC6 elements** — and a struct, an enum
and an alias are all a `baseType`, which is why three DUT flavours share one element. **A union, an interface and a
global variable list have no TC6 equivalent at all**, so CODESYS puts each in its own vendor `addData` block —
exactly the treatment CFC gets in the body table above, for exactly the same reason.

Two things measured here after being inferred wrongly, both of which passed every offline test and failed live:

- **"A union is a DUT, so it is a `<dataType>`."** It is not; it is `<union>`. The push failed with *"document has
  no `<pou>`, `<Interface>`, `<dataType>` or `<globalVars>`"*. Fixture: `codesys-decl/VltProbeUnion.plcopen.xml`.
- **`<Property>` pluralises to `<Properties>`, not `<Propertys>`.** The importer does not reject an unrecognised
  container — it **silently drops the member inside it**, so the push reported success and the property never
  existed. That is the failure mode to expect from this importer generally: wrong shape ⇒ silence, not an error.

What the importer does NOT care about (measured, probe 15/16, so do not add ceremony for it): a spliced `<Method>`
lands with a bare `<interface/>` and no `returnType`; an interface `<Property>` lands with or without `<body>`
elements on its accessors. We still emit the vendor's own shape — no body on an interface accessor — because
emitting an element the format does not have there is a claim we cannot support, not because it is rejected.

## The extension point, deliberately NOT built

If a measurement ever shows TwinCAT needs a different WRITTEN shape, the seam is **one dialect parameter consumed
by `PouSplice.AddChild` and `PouSplice.SetAccessor`** — the only two members that CREATE vendor-shaped elements.
Everything else either reads tolerantly or writes into an element the vendor already put there.

It is named here and left unbuilt on purpose. `pou-writes-via-plcopen` was stopped or misdirected three separate
times by conclusions drawn from reading our own interfaces instead of the vendor — "PLCopen carries no folder
membership", "a merge preserves the child tree", "there is no move primitive", all false. Building a dialect
abstraction against an unmeasured TwinCAT would be the fourth. Measure first (§5 of that change); the
abstraction, if it is needed at all, is an afternoon.
