# Graphical body census — what regeneration destroys

Evidence for `proposal.md`. Every row is either measured against a recorded vendor export or marked
`[UNMEASURED: …]` with the action that closes it. Paths are relative to `packages/volt-cli`.

Method: `Volt.Engine` was built and the **real production path** — `NetworkCode.RenderBody(body)` →
`NetworkTextReader.Parse(vg)` → `GraphWriter.WriteBody(g, InstanceTypes.FromBody(body))` — was run over every
`<FBD>`/`<LD>` element in the fixture tree, censusing element and attribute counts before and after. This is the
same sequence `BodyCodec.NetworkCodec.Encode` executes (`src/Volt.Engine/Document/BodyCodec.cs:171-195`).

---

## 1. The corpus, and the fixed-point proof

**11 files under `test/` contain an `<FBD>` or `<LD>` body. 9 are recorded vendor exports; 2 are hand-authored and
are NOT ground truth** — `roundtrip/fbd_multinet_comment_mods.plcopen.xml` and `roundtrip/ld_ladder_rung.plcopen.xml`
open with a hand-written comment ("Committed hash-drift fixture…" / "Committed fixture: a real LD rung…") and carry
no `<fileHeader>`; the other nine carry `productName="CODESYS"` or
`companyName="Beckhoff Automation GmbH" productName="TwinCAT PLC Control"`.

| fixture | vendor | body |
|---|---|---|
| `fixtures/corpus/POU.plcopen.xml` | CODESYS (SP18 P3) | FBD |
| `fixtures/codesys-pou/VltFbd_FbdRoot.plcopen.xml` | CODESYS (SP21 P4) | FBD |
| `fixtures/codesys-pou/POU_SfcRoot_StFbdMethods.plcopen.xml` | CODESYS | FBD (empty) |
| `fixtures/tc-fbd/PLC_PRG.plcopen.xml` | TwinCAT | FBD |
| `fixtures/tc-fbd/PLC_PRG_jump_sr.plcopen.xml` | TwinCAT | FBD (in action `ACT_FBD`) |
| `fixtures/tc-fbd/fbd_en_eno.plcopen.xml` | TwinCAT (3.5.13.21) | FBD |
| `fixtures/tc-fbd/fbd_ton_embedded_output.plcopen.xml` | TwinCAT | FBD |
| `fixtures/tc-ld/ld_four_networks_shared_rails.plcopen.xml` | TwinCAT | LD |
| `fixtures/tc-ld/ld_ton_rung_two_networks.plcopen.xml` | TwinCAT | LD |
| `fixtures/roundtrip/fbd_multinet_comment_mods.plcopen.xml` | **hand-authored** | FBD |
| `fixtures/roundtrip/ld_ladder_rung.plcopen.xml` | **hand-authored** | LD |

`codesys-pou/FB_GraphicalChild.plcopen.xml`, `FB_ChildFolderStructure` and `FB_TwoDeclCopies` also carry graphical
XML, but it is **CFC**, nested at `<body>/<addData>/<data name=".../cfc">/<CFC>` — `IsDiagram`
(`src/Volt.Engine/Vocabulary/Languages.cs:38-39`), decoded to the `@volt-graphical` marker, never reaching
`GraphReader`. Out of scope; refused on push.

### The fixed point

Read→write run twice per body:

```
corpus/POU.plcopen.xml            vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
codesys-pou/VltFbd_FbdRoot        vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
codesys-pou/POU_SfcRoot_StFbd     vg0==vg1: False  xml1==xml2: True   origXml==xml1: False
tc-fbd/fbd_en_eno                 vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
tc-fbd/fbd_ton_embedded_output    vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
tc-fbd/PLC_PRG                    vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
tc-fbd/PLC_PRG_jump_sr            vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
tc-ld/ld_four_networks_shared     vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
tc-ld/ld_ton_rung_two_networks    vg0==vg1: True   xml1==xml2: True   origXml==xml1: False
```

**9 of 9: the write destroys, and the destruction is idempotent.** The single `vg0 != vg1` is an extra finding:
`POU_SfcRoot_StFbdMethods`'s FBD holds only a `vendorElement`, so after the write the body is literally `<FBD/>`
and the empty-body arm at `GraphReader.cs:65` renumbers it `NETWORK 1` → `NETWORK 0`. **A network index drifts when
a network empties** — a hazard for any scheme keyed on the index (see §5, and `tasks.md` 3.4).

---

## 2. The loss table

Verdicts against the full push loop. **KEPT** = survives with meaning intact · **REGEN** = re-derived, semantics
equivalent, identity and byte-form not preserved · **LOST** = present and dropped · **INVISIBLE** = never read ·
**GUARDED** = not lost; the push is refused instead. `n/9` counts recorded exports only.

### Elements

| element | n/9 | verdict | evidence |
|---|---|---|---|
| `position` | 9/9 (90 occ) | **INVISIBLE, and synthesized on write** | `GraphReader.cs:12` ("Positions are discarded"); no `"position"` case exists in the file. `GraphWriter.cs:202` writes `x=0, y=row*40`. **All 90 stored values are `x="0" y="0"`** — see §7 |
| `vendorElement` | 9/9 (13 occ) | **LOST** (FBD) / **REGEN, emptied** (LD `networktitle`) | FBD: `OpaqueNode` at `GraphReader.cs:284`, deliberately unspellable in text (`NetworkTextWriter.cs:230-236`). LD: consumed as a network delimiter (`GraphReader.cs:78-79`), regenerated with an EMPTY `<alternativeText>` (`GraphWriter.cs:329-336`) |
| ↳ `data name=".../fbd/implementationattributes"` | **7/9** | **LOST** | present in all 7 recorded **FBD** bodies (3 CODESYS + 4 TwinCAT), absent from both LD bodies — it is FBD-specific, as its namespace path says. `corpus/POU.plcopen.xml:66`, `codesys-pou/VltFbd_FbdRoot.plcopen.xml:60`, `tc-fbd/PLC_PRG.plcopen.xml:55`, `tc-fbd/fbd_en_eno.plcopen.xml:53`. Payload: `<attribute name="BoxInputFlagsSupported" value="true"/>` (`corpus/POU.plcopen.xml:68`) |
| `comment` + `content` | 2/9 (6 boxes) | **LOST when the text is empty; text-only when not** | text scraped and all boxes in a network merged (`GraphReader.cs:41-42`), zero-length filtered; written only when non-empty (`GraphWriter.cs:58,258`). **All 6 recorded boxes are empty and all 6 are deleted**: `tc-ld/ld_four_networks_shared_rails.plcopen.xml:33,66,99,132`; `tc-ld/ld_ton_rung_two_networks.plcopen.xml:61,102`. `localId`, `height`, `width` and the N→1 merge are lost even when text survives |
| `contact` | 2/9 (7) | **REGEN, and DEMOTED where it feeds a data pin** | lowered to a boolean `InVar` (`GraphReader.cs:138-145`); re-emitted as a contact only via `EmitPower` (`GraphWriter.cs:401-409`), as a box via `EmitData` (`GraphWriter.cs:443-450`). Measured `contact 3→2` and `connection 7→6` on `tc-ld/ld_ton_rung_two_networks.plcopen.xml:119` — `<contact localId="9">enable</contact>` fed from the rail (`refLocalId="0"`) into `TON.IN` returns as `<inVariable>enable</inVariable>`, rail wire gone. Admitted at `GraphWriter.cs:342` |
| `data .../inputparamtypes`, `.../outputparamtypes` | 5/9 (13+13) | **LOST (payload)** | read into `Pin.Type` (`GraphReader.cs:372-379`); `NetworkTextReader` never sets it, so `JoinTypes` returns null and `GraphWriter.cs:159-160` emits self-closing. `corpus/POU.plcopen.xml:111,148,182` `BOOL` → empty. On TwinCAT **LD** the vendor omits these entirely (DIALECT A16) and the writer *adds* them |
| `data .../fbdcalltype` + `CallType` | 6/9 (14) | REGEN (re-derived from the text form) | `GraphReader.cs:357-363` / `GraphWriter.cs:158`; values matched on every fixture |
| `data .../fbdelementtype` + `ElementType` | 2/9 (6) | REGEN | `GraphWriter.cs:334-336` |
| `data .../stcode` + `STCode` | **0/9** | KEPT by code, unexercised | `GraphReader.cs:306-312`, VG `EXECUTE…END_EXECUTE` (`NetworkTextReader.cs:490`), `GraphWriter.cs:162` |
| `block` | 6/9 (14) | KEPT | `GraphReader.cs:288-301` / `GraphWriter.cs:123-163` |
| `outputVariables/variable` | 6/9 (14) | **REGEN, narrowed** | read as a pin-NAME list only (`GraphReader.cs:295-297`); rebuilt from `NetworkTextReader`'s stub (`:258,283,330`) ∪ pins a connection references (`GraphWriter.cs:145-151`). **An output pin nothing consumes is dropped** — `[UNMEASURED]`, no fixture has one |
| `inputVariables/variable` | 6/9 (49) | KEPT | `GraphReader.cs:292-294` / `GraphWriter.cs:139-142` |
| `inOutVariables` (empty) | 6/9 (14) | REGEN | `GraphWriter.cs:143` always emits an empty one |
| `inVariable`, `outVariable`, `expression` | 7/9, 5/9, 7/9 | KEPT | `GraphReader.cs:279,344-354`, `:329` / `GraphWriter.cs:109-121` |
| `expression` inside `connectionPointOut` (embedded output) | 2/9 | KEPT | `GraphReader.cs:104-112` / `GraphWriter.cs:459-461`; verified on `tc-ld/ld_ton_rung_two_networks` (`elapsed` on `TON.ET`) |
| `connection`, `connectionPointIn/Out` | 8/9 (55) | REGEN (retargeted to fresh ids) | `GraphReader.cs:322-327` / `GraphWriter.cs:491-504` |
| `coil` | 2/9 (6) | REGEN | `GraphReader.cs:147-153` / `GraphWriter.cs:275-277` |
| `leftPowerRail` / `rightPowerRail` | 2/9 | REGEN as ONE body-scoped pair, ids `0` / `2147483646` | `GraphReader.cs:189-192` / `GraphWriter.cs:235,244-248,322-323` |
| `label` / `jump` | 1/9 | KEPT | `GraphReader.cs:281-282` / `GraphWriter.cs:165-171` |
| `return` | 0/9 | KEPT by code, unexercised | `GraphReader.cs:283` / `GraphWriter.cs:172-174` |
| `documentation` | **0/9** | **INVISIBLE** | schema-legal on every graphical element; no `"documentation"` case in `GraphReader.cs`/`GraphWriter.cs` |
| `error`, `connector`, `continuation`, `actionBlock`, `inOutVariable` | **0/9** | **GUARDED** | absent from `SafeToDrop` (`GraphSplice.cs:140-142`) → refusal at `:71-79`. See §6 |
| `relPosition`, `<connection><position>` (wire routing) | **0/9** | INVISIBLE | schema-legal; `relPosition` occurs only inside the CFC fixtures (`codesys-pou/FB_GraphicalChild.plcopen.xml:79`) |

### Attributes

| attribute | n/9 | verdict | evidence |
|---|---|---|---|
| `position/@x`, `@y` | 9/9 (90 each) | **INVISIBLE, and rewritten** | all stored values `0`; Volt writes `y = 0,40,80,…` (`GraphWriter.cs:202`) |
| `@localId` | 9/9 | **REGEN — identity NOT stable** | re-minted `order*10^10+1` upward (`NetworkTextReader.cs:72`, `_nextId++` at `:148,153`); LD ids re-minted at *read* time too (`GraphReader.cs:51`). Measured on `corpus/POU`: AND block `10000000003 → 10000000002`; `out2` `10000000006 → 10000000007` |
| `@executionOrderId` | 0/9 in FBD/LD | **LOST on push, SILENTLY** | read `GraphReader.cs:275`, written `GraphWriter.cs:187` — but all 15 node constructions in `NetworkTextReader` pass `null` (`:222,230,258,283,287,297,303,304,309,311,330,359,384,393,490`), `NetworkTextWriter` has no spelling for it, and `ValidateExisting` never inspects it. **NOT a CFC-only attribute**: `docs/tc6_xml_v201.xsd:1220,1250,1279,1309,1333,1352,1370` declares it on the shared `block`/`inVariable`/`outVariable`/`inOutVariable`/`label`/`jump`/`return` elements FBD and LD are built from, and `packages/volt-lsp-iec/docs/codesys-reference/15-ld-elements.md:121` makes it execution semantics ("last-write-wins … the order is determined by `executionOrderId` of the coils"), `14-fbd-elements.md:66,77` likewise for EN/ENO. Its absence from the corpus is a coverage gap, not evidence of safety |
| `@globalId` | 0/9 | INVISIBLE | schema-legal on every graphical element and connection point |
| `@height`, `@width` | 2/9 (`comment` only, all `"0"`) | REGEN as `0` | `GraphWriter.cs:68,260` hardcodes both |
| `block/@typeName`, `@instanceName` | 6/9, 4/9 | KEPT | `GraphReader.cs:298-299` / `GraphWriter.cs:124-137` (fails loud rather than writing `""`) |
| `variable/@formalParameter` | 6/9 (49) | KEPT | `GraphReader.cs:293,296` / `GraphWriter.cs:141,150` |
| `connection/@refLocalId`, `@formalParameter` | 8/9, 6/9 | REGEN (retargeted) / re-derived | `GraphReader.cs:326` / `GraphWriter.cs:496-500` |
| `@negated`, `@edge`, `@storage` (pin / contact / coil) | 3/9, 2/9, 2/9 | KEPT | `GraphReader.cs:333-335` / `GraphWriter.cs:194-198,486-488` |
| `inVariable/@negated` | **0/9** | KEPT-as-text | re-encoded as `NOT x` because TwinCAT's importer drops it (DIALECT C3, `DIALECT.md:114`). Exercised by **no fixture on either vendor** (DIALECT D14) |
| `@negated`/`@edge`/`@storage` on a block **OUTPUT** pin | 0/9 | **GUARDED** | `GraphSplice.cs:98-99,146-152` |
| `data/@name`, `@handleUnknown` | 9/9 (53) | REGEN, matches (`handleUnknown="implementation"`) | `GraphWriter.cs:179-183` |
| `attribute/@name`, `@value` | 7/9 | **LOST** with the `vendorElement` | |
| network `Label`, `Disabled` | 0/9 | **INVISIBLE both directions** | `GraphReader.cs:62` hardcodes `new GraphNetwork(index, null, comment, false, nodes)`, while `NetworkTextWriter.cs:44-46` renders both and `NetworkTextReader` parses both. The repo's only graphical `[UNMEASURED:]` marker is `NetworkTextWriter.cs:47-54` |

*Census artifact to discount:* `CallType@xmlns`, `InputParamTypes@xmlns`, `fbdattributes@xmlns` and `xhtml@xmlns`
appear to drop to zero in the raw delta. That is an XLinq object-model artifact — `GraphWriter.VendorData`
(`:179-183`) builds no-namespace elements that still **serialize** as `xmlns=""`. Verified in the regenerated dump
(`<CallType xmlns="">operator</CallType>`). Not a loss.

---

## 3. Element coverage against the TC6 schema

`docs/tc6_xml_v201.xsd`: `<FBD>` (`:418-425`) = `commonObjects` ∪ `fbdObjects`; `<LD>` (`:426-434`) adds
`ldObjects`. Groups at `:847`, `:1120`, `:1376`.

- `commonObjects` (6): `comment` `:852`, `error` `:866`, `connector` `:883`, `continuation` `:905`,
  `actionBlock` `:930`, `vendorElement` `:1009`
- `fbdObjects` (7): `block` `:1125`, `inVariable` `:1228`, `outVariable` `:1257`, `inOutVariable` `:1286`,
  `label` `:1319`, `jump` `:1337`, `return` `:1356`
- `ldObjects` (4): `leftPowerRail` `:1381`, `rightPowerRail` `:1411`, `coil` `:1433`, `contact` `:1460`

**FBD has 13 legal element children, LD has 17.** `SafeToDrop` (`GraphSplice.cs:140-142`) names 12, so today's gate
permits deleting 8 of the 13 legal in FBD and 12 of the 17 legal in LD. The five it refuses are exactly `error`,
`connector`, `continuation`, `actionBlock`, `inOutVariable`.

Occurrences as a **direct child** of an `<FBD>`/`<LD>` element, over all 34 non-build `*.xml` under `test/`
(depth-tracking scan, not a flat grep; `bin/`/`obj/` excluded — counting those inflates every figure ~3×):

| element | occ | files | note |
|---|---|---|---|
| `inVariable` | 31 | 8 | |
| `block` | 16 | 7 | |
| `outVariable` | 14 | 6 | |
| **`vendorElement`** | **13** | **9** | 7 `implementationattributes` + 6 `networktitle` |
| `contact` | 9 | 3 | |
| `comment` | 7 | 3 | |
| `coil` | 7 | 3 | |
| `leftPowerRail` / `rightPowerRail` | 3 / 2 | 3 / 2 | |
| `label` / `jump` | 1 / 1 | 1 | |
| `return` | 0 | 0 | supported, unexercised |
| `error` / `connector` / `continuation` / `actionBlock` / `inOutVariable` | **0** | 0 | theoretical in this corpus |

**The `connector` trap.** A flat grep finds 8 `<connector>` elements. Six are inside CODESYS `<CFC>` bodies
(`codesys-pou/FB_GraphicalChild.plcopen.xml:55,68`, `FB_ChildFolderStructure.plcopen.xml:55,68`,
`FB_TwoDeclCopies.plcopen.xml:78,91`) and never reach `GraphReader`. The other two are hand-written FBD bodies in
tests (`FbdCoverageTests.cs:72`, `GraphSpliceTests.cs:70`) which **do** reach `GraphReader` — it is total and turns
a connector into an `OpaqueNode` (asserted at `FbdCoverageTests.cs:98`), and the refusal is raised on the WRITE
leg, not by the reader. Zero connectors in a recorded FBD/LD body.

**Reader totality, precisely.** `GraphReader.cs` contains no `throw` at all, so it does not throw on an unmodelled
element. But it is not true that everything outside the switch becomes an `OpaqueNode`: `<comment>` is filtered out
at `GraphReader.cs:43` *before* either switch and folded into `GraphNetwork.Comment` as plain text
(`CommentText`, `:267`, keeps only `XText` descendants); and the FBD default (`:284`) preserves the original
`localId` while the LD-lowering default (`:212`) mints a fresh one. The residual throw surface is the attribute
casts on malformed values, which is why the class doc says "never throws **on valid input**".

---

## 4. Vendor asymmetries — real, and none of them vendor-branchable

`test/Volt.Engine.Tests/VendorParityGuardTests.cs:20-59` fails the build if `twincat|codesys|beckhoff` appears in
executable code anywhere under `src/Volt.Engine/` (comments exempt). Every difference below must be discriminated
**structurally**, exactly as `GraphReader.SplitNetworks` (`GraphReader.cs:76-98`) already does.

| # | fact | evidence | what the splice must do |
|---|---|---|---|
| 1 | **LD delimits networks with `vendorElement`+`ElementType=networktitle`; FBD does not, and strides `localId` by 10^10 instead.** localId buckets: `corpus/POU` {1}, `VltFbd_FbdRoot` {1}, `tc-fbd/PLC_PRG` {1,2,3}, `PLC_PRG_jump_sr` {1,2,4,5,6}; both `tc-ld/*` have **all** ids in bucket 0 | `ld_four_networks_shared_rails.plcopen.xml:46,79,112,145`; `GraphReader.cs:78-79,86-97`; `GraphConstants.NetworkStride` `Model/GraphModel.cs:11` | key on the marker when present, else the stride — the discriminator is the LANGUAGE, not the vendor |
| 2 | **LD networks index from 0, FBD from the stride (normally 1)** | `GraphReader.cs:95` vs `:87`; `NetworkTextWriter.cs:44` writes the real index | never renumber a network |
| 3 | **One shared rail pair brackets the whole LD body** — `leftPowerRail localId="0"`, `rightPowerRail localId="2147483646"` — and every contact in every network wires back to id `0` | `ld_four_networks_shared_rails.plcopen.xml:29,165`; `GraphWriter.cs:235,244-248,322-323`. Per-network rails made TwinCAT drop networks | rails are BODY-scoped; a carried LD network references id `0`, so the pair travels with the body |
| 4 | **The gap gate is structurally inert on LD.** `GraphSplice.cs:81-92` divides by the stride; every LD id lands in bucket 0, so `indices.Count > 1` never fires on a four-network ladder | as cited | do not assume the gate protects LD at all |
| 5 | **A TwinCAT LD body can be exported inside `<FBD>`** — `CreateChild` cannot create `"LD"` and seeds FBD (DIALECT C6, B4) | `GraphSplice.cs:47-51` replaces the whole wrapper for this reason | a language change replaces the wrapper and carries nothing forward |
| 6 | **LD blocks carry no param-type addData; FBD blocks do** (DIALECT A16) — `tc-ld/ld_ton_rung_two_networks.plcopen.xml:157-161` holds only `fbdcalltype`, yet `GraphWriter.cs:156-160` emits both param-type blocks whenever `CallType` is non-empty | as cited; measured `data 3→5` on that fixture | a carried network keeps the vendor's own shape for free |
| 7 | **TwinCAT's import invalidates every handle to the replaced item** (DIALECT D4d); CODESYS's merge does not | `DIALECT.md:131`-region; `TcPlcOpen.cs:33-34,57-66` | any work continuing through the same handle after a body write fails on one vendor only |
| 8 | **CODESYS's merge REMOVES children absent from the document** (`ConflictResolve.Replace`, no delete) | `src/Volt.Ide.Codesys/Driver/CodesysDriver.Code.cs:35-48` | argues FOR splicing: a document left otherwise untouched is correct by construction |
| 9 | **TwinCAT resolves POU members only from `<ProjectStructure>`** even though both vendors mark that block `handleUnknown="discard"` (DIALECT D4h) | as cited | same: never rebuild the document, edit it |
| 10 | **TwinCAT's importer drops `negated` on an `<inVariable>`**, so negation is text-encoded as `NOT x` for BOTH vendors (DIALECT C3) | `GraphWriter.cs:109-116`; `GraphReader.cs:339-354` | a carried `negated="true"` on an `inVariable` would be lost on the next TwinCAT import — the splice must apply the same text-encoding rule the writer does |
| 11 | **TwinCAT's importer CRASHES on leaf fan-out** ("Index was outside the bounds of the array"), refused globally (DIALECT C4) | `Graph/NetworkCode.cs:41-57` | the guard is global; re-validate the WHOLE spliced body, carried halves included |
| 12 | **Neither vendor has a partial-body import.** `ICodeStore.cs:31-35` is `ReadXml` / `WriteXml` — whole document only | as cited | "splice" means editing the export's bytes and re-importing it whole |

**The largest coverage gap: there is NO recorded CODESYS LD export anywhere in the repo** (DIALECT D11,
re-verified — `grep -rl "<LD>"` over `test/` yields only `tc-ld/*` and the hand-authored `roundtrip/ld_ladder_rung`).
`GraphWriter` emits TwinCAT's shared-rail form to CODESYS on the strength of FBD parity, and `GraphWriter.cs:229-234`
claims live CODESYS verification with no artifact. Also absent from every recorded CODESYS export: a multi-network
FBD, a `jump`/`label`, an EN/ENO box, an embedded output, and any `<comment>` at all (DIALECT D15).

---

## 5. Why node-level matching cannot be made reliable

| measurement | result |
|---|---|
| model nodes landing under a localId that denotes the same node on both sides, **at zero edits** | **15 of 99 (15.2%)**; for all 4 LD fixtures, **0** |
| nodes uniquely 1:1-matched by `(kind, identifying text)` | **68 of 86 (79.1%)**; real-vendor fixtures only **55 of 73 (75.3%)** |
| ↳ `inVariable` **literals** colliding | **12 of 21 (57.1%)** |
| ↳ anonymous operator/function blocks colliding | **2 of 12 (16.7%)** |
| ↳ named FB instances, `outVariable`s, contacts, coils, labels, jumps colliding | **0%** |
| nodes uniquely matched by a neighbourhood fingerprint (own key + producer keys + consumer keys) | **54 of 86 (62.8%)** — WORSE |
| model nodes with **no statement of their own** (tokens inside one expression) | **49 of 86 (57.0%)** |
| model nodes with **no stored XML element at all** | **7 of 86 (8.1%)** |

Three structural facts behind those numbers:

1. **Literal collisions are forced by the design.** `NetworkCode.Validate`'s leaf fan-out guard
   (`NetworkCode.cs:41-57`) *requires* every read of a value to have its own leaf, because TwinCAT's importer
   crashes on a shared one (DIALECT C4). A network reading `FALSE` twice must contain two identical
   `inVariable` elements. Every measured collision comes from a real vendor export — `corpus/POU` net 1
   (`FALSE`×2, `AND#`×2), `tc-fbd/PLC_PRG` net 2 (`TRUE`×2), `PLC_PRG_jump_sr` net 2 (`TRUE`×2),
   `fbd_en_eno` net 1 (`FALSE`×2, `1`×2, `2`×2).
2. **The fingerprint is worse because it is built on a lossy projection.** `fbd_ton_embedded_output` drops to 0
   matches because `Block type='TON' inst='t1'` comes back as `Block type='' inst='t1'` — network text carries no
   `typeName`, which is exactly why `InstanceTypes` exists.
3. **57% of nodes have no anchor point.** `corpus/POU` has 8 XML nodes and 4 lines of VG:
   `LET g1 := ((FALSE AND TRUE) AND FALSE);` is five nodes on one line. Inlining a single-consumer producer is the
   rule that makes the text readable (`docs/network-text.md:187-192`).

**What IS stable: the network index.** `NetworkTextReader.cs:66-72` preserves `NETWORK <n>` verbatim from the
engineer's text, and an insert at the top of a network was measured to shift all 8 following nodes **in that
network only** — the following network's ids were untouched. Damage is contained to the edited network.
Caveat: §1's `POU_SfcRoot_StFbdMethods` finding — a network that EMPTIES renumbers.

**The one working precedent in the codebase** for content-keyed carry-forward is `InstanceTypes.FromBody`
(`src/Volt.Engine/Graph/InstanceTypes.cs:29-40`, used at `BodyCodec.cs:185`): it harvests `instanceName → typeName`
out of the body being replaced, falling back to a declaration text-parse only for boxes new in this push. Its key
is `instanceName` — the key class measured at 0% collisions — and `BodyCodec.cs:180-184` states the right ordering
principle in place: the stored body is authoritative because the IDE wrote those attributes, so nothing is inferred.

---

## 6. Refused, not lost — do not let the splice "fix" these into a regression

`ValidateExisting` (`GraphSplice.cs:67-118`) refuses rather than damages. Three corrections to how this is usually
described:

- It inspects the **stored** body's direct children, not the pushed one. Network text cannot express `error`,
  `connector`, `continuation`, `actionBlock` or `inOutVariable`, so a pushed body never contains one.
- It is **replace-only**. `BodyCodec.cs:191` returns before the gate when there is no existing graphical body, so a
  first write (and a rename, which is remove+add) inserts unvalidated.
- The exception **does not escape**: `Sync/PushService.cs:69-78` catches it and returns a
  `PushResponse.RejectedResult` carrying the message.

| refused today | evidence | occurrences in recorded exports |
|---|---|---|
| an element outside `SafeToDrop` | `GraphSplice.cs:71-79,140-142` | 0 |
| a gap in the network numbering | `GraphSplice.cs:81-92` | **1** — the body of the action `ACT_FBD` inside `tc-fbd/PLC_PRG_jump_sr.plcopen.xml`, indices `{1,2,4,5,6}`. The parent POU `PLC_PRG` has an `<ST>` body and is unaffected |
| a populated `<inOutVariables>` | `GraphSplice.cs:96-97` | 0 |
| a modifier on a block output pin | `GraphSplice.cs:98-99,146-152` | 0 |
| an FBD pin wired from multiple sources (LD exempt — it is an OR convergence) | `GraphSplice.cs:100-103` | 0 |
| a stateless function with >1 output and no `EN` | `GraphSplice.cs:104-113` | 0 |

Any of these inside a network the engineer **edited** must still be refused, with the same message. Narrowing the
gate's scope to the changed networks is the change; softening what it refuses is not.

---

## 7. Non-losses — things that look like loss and are not

- **`<position>`.** Every one of the 90 recorded positions on both vendors is `x="0" y="0"`. PLCopen FBD/LD export
  carries no diagram layout, so nothing is destroyed; `GraphWriter.cs:202`'s `y = row*40` is churn *added*. A splice
  removes the churn — it does not restore a diagram. (CFC is different: `codesys-pou/FB_GraphicalChild.plcopen.xml:64`
  carries real coordinates `x="25" y="5"`.)
- **Pull.** Unmodelled elements are not "erased from the repo" on pull — the repo text is generated fresh from the
  export, so they are simply never materialized. The destructive event is the **push**.
- **`handleUnknown="implementation"`, `comment/@height`, `comment/@width`.** Regenerated to values that match what
  both vendors emit (`GraphWriter.cs:68,183,260`).

---

## 8. UNMEASURED register

Every one is a first-class artifact. The action closing each is, unless stated otherwise, *perform the action in
the IDE, export, record the fixture*.

| # | question | why it matters | how to close |
|---|---|---|---|
| U1 | **Does either vendor emit `executionOrderId` on an FBD or LD element?** 0 of 9 recorded exports; but the XSD declares it on the shared FBD/LD elements (`tc6_xml_v201.xsd:1220,1250,1279,1309,1333,1352,1370`) and the CODESYS reference makes it coil-ordering semantics (`15-ld-elements.md:121`) | it is **execution semantics**, and today it is silently zeroed | build an FBD network with an explicit execution order, and an LD rung with two coils on one variable, in EACH IDE; export |
| U2 | **Does either IDE preserve the localIds Volt pushes, or renumber them on import?** `GraphWriter.cs:243` asserts renumbering with no fixture, no `[UNMEASURED:]` marker and no DIALECT row | decides whether a carried-forward id survives one push/pull cycle — load-bearing for this whole change | push a known body to a live CODESYS and a live TwinCAT, re-export, compare localIds |
| U3 | **What XML carries a DISABLED network, and a network TITLE?** Zero fixtures; the `networktitle` `<alternativeText>` is empty in all 6 recorded captures | `GraphReader.cs:62` drops both in both directions (`NetworkTextWriter.cs:47-54`) | disable a network and title a network in each IDE; export |
| U4 | **What does `BoxInputFlagsSupported="true"` control, and does destroying it change anything the engineer sees?** | it is the highest-frequency measured loss (7 of 9 exports) with entirely unknown consequence | push a body with it removed to each live IDE; observe |
| U5 | **Does a NON-EMPTY `<comment>` survive a real vendor round-trip?** No recorded export on EITHER vendor contains one; the only non-empty comment in the tree is hand-authored (DIALECT D15) | the comment fix in `tasks.md` 1.2 has no vendor ground truth to check against | type a comment into a network in each IDE; export |
| U6 | **Does a spliced — id- and attribute-preserving — graphical body import cleanly, or does the importer normalize it?** Every live verification to date (`GraphWriter.cs:229-243`, `test/e2e/graphical/*`) exercised the REGENERATED body | this is the change's central assumption | push a spliced body to live CODESYS and live TwinCAT; re-export and diff |
| U7 | **What does a real CODESYS LD export look like?** No CODESYS LD capture exists anywhere (DIALECT D11) | `GraphWriter` emits TwinCAT's shared-rail form to CODESYS with no artifact | create a 2-network ladder in CODESYS; export |
| U8 | **Does a block output pin with no consumer occur in real projects?** `GraphWriter.cs:145-151` would drop it; no fixture has one | would silently remove a visible pin from a box | inspect a production project; or construct one and export |
| U9 | **Can two `<comment>` boxes occupy one network?** `GraphReader.cs:41` merges them unconditionally; no fixture exercises it | the merge is a code fact, not a measured loss | place two comment boxes in one network; export |
| U10 | **Is the LD contact→box demotion functionally harmless on a live PLC, or does losing the rail wire change the rung?** Measured as an XML shape change only | decides the severity of `tasks.md` 1.1 | build and run the rung before and after on each vendor |
| U11 | **Does `<inVariable negated="true">` round-trip on either vendor?** Exercised by no fixture on either side (DIALECT D14) | the `NOT x` text workaround is applied to both vendors on a TwinCAT-only measurement | negate an input variable in each IDE; export |
| U12 | **Does the `stcode` / Execute-box path work?** `GraphReader.ReadStCode` and `GraphWriter`'s `<STCode>` re-emit are exercised by zero recorded fixtures | dead-until-proven code on the push path | place an Execute box in each IDE; export |
| U13 | **Does either vendor emit `<documentation>`, `@globalId`, `@height`/`@width` on a non-comment element, `<relPosition>` in an FBD/LD connection point, or a `<connection><position>` routing path?** All schema-legal, all 0 occurrences | all INVISIBLE today; a splice preserves them for free on carried networks, so this only bounds the residual risk on regenerated ones | inspect exports from a larger production project |
| U14 | **Where does the actual FBD/LD diagram layout live, given PLCopen exports (0,0)?** TwinCAT's native `.TcPOU` NWL archive (`test/TwinCAT_Testproject/.../TCFBD.TcPOU`) carries `DefaultViewMode`, `NetworkListComment`, per-network `Comment`/`Title`/`Label`/`OutCommented` and `Id` that PLCopen does not — but no populated NWL capture with real boxes exists in the repo, and CODESYS's equivalent store was never examined | bounds what a splice can ever protect, and may answer U3 | move a box in each IDE, save, and diff the native project store |
| U15 | **Do real field projects contain `connector`/`continuation`/`actionBlock`/`inOutVariable` inside an FBD or LD body?** 0 fixtures, no live probe | decides whether §6's refusals are theoretical or routine | census a production project corpus |
| U16 | **How do the §5 collision rates scale on real networks?** The largest network in the corpus has 10 node-elements; the median is 4. Literal collisions grow superlinearly with network size, so 57.1% is a **floor**, not an estimate | bounds whether statement granularity is ever worth attempting | export networks from the 4-project corpus and re-run the collision script |
| U17 | **Can each lowered LD node be traced to exactly one stored `contact`/`coil`/`block`?** The two synthesized `AND` blocks (`GraphReader.cs:242-249`) suggest some lowered nodes are many-to-one or zero-to-one | gates statement granularity on LD entirely | attempt the mapping over both `tc-ld/*` fixtures |
| U18 | **Can `NETWORK_NOT_CANONICAL` (`NetworkCode.cs:59-67`) be made anchor-preserving without weakening it?** Not attempted | only relevant if the text-anchor option in `proposal.md` §4 is ever revived | design + test |
| U19 | **Does TwinCAT's import discard `objectid` the way CODESYS's does?** (DIALECT D8; D4h answered the `ProjectStructure` half — it does NOT — without D8 being updated) | affects what a spliced document may safely leave in place | probe both importers |
| U20 | **Can a body-level `<addData>` or `<documentation>` sibling coexist with an FBD/LD body?** Three fixtures have a `<body>/<addData>` child, but all three are the CFC-nesting case with no FBD/LD sibling | the splice preserves such siblings by construction, but that is untested | construct or find one; export |
