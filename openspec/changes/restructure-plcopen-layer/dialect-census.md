# CODESYS ⇄ TwinCAT PLCopen dialect census

The evidence base for `restructure-plcopen-layer`. Every entry cites code, a recorded fixture, or is marked
**UNMEASURED**. Paths are relative to `packages/volt-cli/`.

*recorded* = a real vendor export committed as a fixture. *live-claimed* = asserted in a doc-comment or an
openspec task as measured against a running IDE, with no artefact in the repo. *synthetic* = hand-authored XML
(`fixtures/roundtrip/*` are synthetic — their own headers say so).

## The headline

**The single-document POU write has only ever been measured on CODESYS**, and the code says so in three places:
`src/Volt.Engine/Ide/ICodeStore.cs:30-39`, `src/Volt.Engine/Ide/DriverBase.cs:24-27` (defaults false),
`src/Volt.Cli.Ide.Codesys/Driver/CodesysDriver.Code.cs:55` (true). TwinCAT falls through to the per-child path at
`src/Volt.Engine/Sync/PushService.cs:372-377`.

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
| A5 | `objectid` addData: TwinCAT always; CODESYS flag-gated + also as an attribute on the member | `tc-fbd/PLC_PRG.plcopen.xml:212-214`; `FB_ChildFolderStructure.plcopen.xml:35` |
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
| B4 | **LD-as-FBD read** — a TwinCAT empty LD body exports inside `<FBD>`; the COM language is authoritative. **Currently NOT handled on the production read path** — the override is dead | `PlcOpenReader.cs:15-19`; `Materializer.cs:123-131` passes the element's own name |
| B5 | **CFC body placement** — CODESYS nests it under `<body>/<addData>/<data name="…/cfc">`, not as a direct child. **Not handled at all** | see Defects below |
| B6 | **Import mode** — CODESYS merges in place (`Replace`, no delete); TwinCAT ADDS and FAILS on a name collision, so it must delete first | `CodesysDriver.Code.cs:37-52` vs `TcPlcOpen.cs:38-51`. **The deepest genuine divergence in the path** |
| B7 | `CreateChild` semantics — TwinCAT rejects String vInfo on a FUNCTION, rejects `"ST"` on interfaces, wants the return type as vInfo for interface members, rejects `"LD"`; CODESYS ignores the language entirely | `TcObjectModel.cs:319-340`; `test/e2e/vendor-notes.test.ts:4-7` |

### C — vendor limits (6)

| # | Limit |
|---|---|
| C1 | TwinCAT `PlcOpenExport` has **no flags** — the export shape is not tunable |
| C2 | TwinCAT answers **`E_FAIL` for every DUT and GVL** export (measured live) — `Materializer.cs:52-58` |
| C3 | TwinCAT's importer drops `negated` on an `<inVariable>`, so negation is encoded as `NOT x` in the expression text for BOTH vendors — `PlcOpenWriter.cs:108-115` |
| C4 | TwinCAT's importer **crashes** on leaf fan-out ("Index was outside the bounds of the array"); refused globally in Core — `GraphicalCode.cs:70-86` |
| C5 | TwinCAT has **no move primitive** — `BeckhoffDriver.Tree.cs:126-134` throws. (See D4: nobody has actually looked.) |
| C6 | TwinCAT `CreateChild` cannot create `"LD"` — created as FBD |

### D — UNMEASURED (16)

**On TwinCAT:**

| # | Never verified |
|---|---|
| D1 | The entire single-document POU write — does `PlcOpenImport` accept a spliced document at all? |
| D2 | Do children survive TwinCAT's delete-then-import round trip? |
| D3 | Which representation drives a declaration on import — plaintext, typed `<interface>`, or neither? |
| D4 | Is there a move equivalent? Without one, child folders cannot be restored after an import |
| D5 | **TwinCAT's POU member shape.** `<Method>`, `<Property>`, `<GetAccessor>`, `<SetAccessor>`: **zero occurrences across all six recorded TwinCAT fixtures.** `AddChild` builds to the CODESYS shape and has never met a TwinCAT import |
| D6 | Accessor ordering (Set-before-Get) — evidenced on CODESYS only |
| D7 | Does TwinCAT nest a CFC body under `<body>/<addData>` the way CODESYS does? No TwinCAT CFC/SFC fixture exists |
| D8 | Does TwinCAT's import discard `projectstructure`/`objectid` the way CODESYS's does? |
| D9 | The `PlcOpenExport` selection grammar — still flagged "NEEDS LIVE VERIFICATION" in the source that uses it |
| D10 | Late-bound dispatch reachability of `PlcOpenExport`/`PlcOpenImport` — the note is partly contradicted by the fact that the `tc-*` fixtures were captured through exactly that call, but has never been retracted |

**On CODESYS (the mirror gap, less often noticed):**

| # | Never verified |
|---|---|
| D11 | **The entire LD export/import shape.** No CODESYS LD capture exists anywhere; `PlcOpenWriter` emits TwinCAT's shared-rail form (left rail id 0, right rail 2147483646, regenerated `networktitle` markers) to CODESYS. `PlcOpenWriter.cs:219` claims live CODESYS verification with nothing to show for it |
| D12 | EN/ENO pin naming — `VgParser.cs:228-232` hardcodes TwinCAT's `EN`/`In2…`/`Out2`/`ENO` and writes it into CODESYS |
| D13 | Embedded output assignment on write — the LD writer always embeds a non-primary output in its pin, a rule derived entirely from live TwinCAT |
| D14 | `negated` on `<inVariable>` — the C3 workaround is exercised by **no fixture on either vendor** |
| D15 | The FBD `<comment>` shape — "CODESYS rejects bare text" (`PlcOpenWriter.cs:69`); no recorded CODESYS export contains a `<comment>` at all |
| D16 | Whether **either** IDE accepts a `<Property>` written without `<interface><returnType>` |

## Structural conclusion

**The read path is genuinely a union and should stay one.** The two real read gaps (B4, B5) are *missing
tolerance*, not missing vendor branches.

**The write path is not a union and does not claim to be.** Its one deep divergence (B6) already lives below the
vendor seam in two `WriteXml` implementations. `WritesPouAsOneDocument` is an explicit, self-documenting staging
flag whose deletion is gated on measurements that have not been taken.

So the structure copes with two dialects through **evidence, not indirection**: one tolerant reader, vendor
difference confined to the driver, and a two-vendor fixture matrix that turns a divergence into a failing test
instead of a live surprise. D5 is the highest-value gap to close.

## Part 9 — false comments found (Convention 8: a false comment is a defect)

1. `Graphical/PlcOpenDocument.cs:585-587` attributes `<actions>`-before-`<body>` to TwinCAT. **CODESYS does it too**
   (`FB_FolderChild.plcopen.xml:27,38`). The hazard is real; the attribution is wrong.
2. `Graphical/PlcOpenReader.cs:358-360` — "CODESYS and TwinCAT both emit [param types]". True for FBD, **false for
   TwinCAT LD**.
3. `Graphical/PlcOpenDocument.cs:196` — "this same import already rejects a BOM". **No evidence for either vendor.**
   The only BOM-rejection evidence concerns workspace source files on a different path.
4. `Graphical/PlcOpenReader.cs:15-19` — documents the `language` override as how the TwinCAT empty-LD case is
   handled. It is never fed a vendor language on the production path.
5. `ARCHITECTURE.md:135-136` cites `Graphical/PlcOpenDocument.InterfacePropertyAccessors` — **that member does not
   exist**; accessors come from `PlcOpenPouParser.Accessor`.
6. `Ide/TcPlcOpen.cs:14-21` — "NEEDS LIVE VERIFICATION" on a call the recorded fixtures were captured through. At
   least partly settled, never retracted, which makes §5.1's risk read larger than it is.
