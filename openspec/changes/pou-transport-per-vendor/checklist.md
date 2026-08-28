# What a POU transport must do — the checklist, and both vendors scored against it

Every score below is **measured**, on the live IDEs, and cited. Where a cell is not measured it says so rather
than being filled in by inference — an unmeasured row is the thing that made the current transport look adequate
for months.

Legend: **✓** works · **✗** fails · **~** partial · **?** UNMEASURED

---

## A. Reading a POU

| # | Requirement | Why it matters | TC PLCopen *(today)* | TC `DocumentXml` | CS PLCopen *(today)* | CS `export_native` |
|---|---|---|---|---|---|---|
| R1 | **Declaration, verbatim** — alignment, blank lines, pragmas, per-variable comments, initial values | It is the engineer's source. A rendering is a diff against work nobody did | ✗ **0 of 2 live exports carry `InterfaceAsPlainText`; one declares 45 variables** | ✓ carries it | ✓ carries it (twice — A7), and it is **FLAG-CONTROLLED**: §CS-W14 | ~ GUID-typed |
| R2 | **ST body, verbatim** | Same | ✓ measured byte-identical to native CDATA, 7,316 chars | ✓ native CDATA | ✓ | ~ |
| R3 | **FBD/LD body** faithfully enough to render AND splice back | The whole graphical feature | ~ graph; regeneration is lossy | ✓ **MEASURED — see §NWL below. An expression tree, near 1:1 with `GraphModel`** | ~ same graph, same losses | ~ |
| R4 | **CFC/SFC/IL detectable as unsupported** | Must never be mangled into ST | ✓ marker | ✓ | ✓ | ✓ |
| R5 | Members enumerated (method/action/property) | | ✓ | ✓ proved | ✓ | ~ |
| R6 | **Member declarations, verbatim** | | ✗ **`VAR_INPUT` appears NOWHERE in a probe FB's export** | ✓ proved | ✓ | ~ |
| R7 | Member bodies | | ✓ | ✓ proved | ✓ | ~ |
| R8 | **Accessor declarations + bodies** | | ~ bodies yes; declarations only in the LOSSY typed form | ? nested `<Get>` proved on write, read unmeasured | ✓ | ~ |
| R9 | Member folder placement | Otherwise a push duplicates members at the POU root | ✓ tree walk | ✓ **`<Folder>` + `FolderPath=` ON the member — see §R9** | ✓ | ~ |
| R10 | **Network `Title` / `Label` / disabled** | A disabled network is running-program state | ✗ **none carried; a disabled network is OMITTED ENTIRELY** (`POU_PBD`: 2 native → 1 exported) | ✓ `OutCommented`, `Title`, `Label` | ✗ same PLCopen limit | ? |
| R11 | Identity across rename | | ✓ `objectid` | ✓ `Id` | ✓ flag-gated | ✓ GUID |
| R12 | Cost | ~1 read per POU per fetch | ~20 ms | **0.3–5 ms** | ~20 ms | ? |

## B. Writing a POU

| # | Requirement | TC PLCopen *(today)* | TC `DocumentXml` | CS PLCopen *(today)* |
|---|---|---|---|---|
| W1 | Declaration lands verbatim | ✗ *no block to write into* → **now solved off-transport, via the aspect** | ✓ | ✓ |
| W2 | ST body lands verbatim | ✓ | ✓ | ✓ |
| W3 | FBD/LD body lands without destroying what text cannot express | ~ carry + refuse (`lossless-push`) | ✓ **nothing is regenerated — see §W3** | ~ same |
| W4 | Unsupported body never overwritten | ✓ refused | ✓ never regenerated | ✓ |
| W5 | Members created / updated / removed | ✓ one document write | ✓ proved (spliced `<Method>` + `<Property>` landed) | ✓ |
| W6 | Member declarations land | ✗ *no block* → **solved via the aspect** | ✓ | ✓ |
| W7 | Member bodies land | ✓ | ✓ | ✓ |
| W8 | **Accessor declarations land** | ✗ **REFUSES** — `Declaration.Write` needs a block that does not exist | ✓ proved on write | ✓ |
| W9 | Member folders survive | ~ import FLATTENS them; Volt re-places from its own `%FOLDER` | ✓ **carried in the document** | ~ |
| W10 | Network metadata survives | ✗ cannot carry what the read never had | ✓ | ✗ |
| W11 | **In-place replace** | ✗ **import always relocates to the PLC-project root**; Volt moves it back (D4g) | ✓ set on the item itself | ✓ **MEASURED — parent `Application` before AND after. §CS-W14** |
| W12 | Atomic — refuse rather than half-apply | ✓ | ✓ **MEASURED — refuses whole, with a line/position diagnostic. §W3** | ✓ |
| W13 | Cost | ~20 ms export + import | **0.3–5 ms** | ~20 ms |
| W14 | **Untouched content not normalized** | ✗ **reorders `LineIds`, re-indents, ZEROES the POU `Id`, and REGENERATES the declaration from the typed interface** (`x : INT;` → `x: INT;`) | ✓ **MEASURED — byte-identical except the POU `Id`, which PLCopen zeroes too. §W14** | ✓ **MEASURED — content-identical; only the export TIMESTAMP differs. §CS-W14** |

---

## What the scoring says

**TwinCAT's PLCopen export fails 7 requirements outright** (R1, R6, R10, W1, W6, W8, W11, W14) and every crisis
this month is one of those rows. `DocumentXml` passes the ones that are measured, is ~10× cheaper, and was
rejected for a reason that appears nowhere in this table:

> *"Two native converters, one of them GUID-mapped, replacing one shared implementation, is the opposite of the
> deduplication…"*

That is implementation economy, not capability. It optimised for one shared converter and paid in fidelity on
both of the rows that later broke — the declaration and the disabled network.

**CODESYS is the opposite case, and PLCopen wins there on merit.** Its export carries `InterfaceAsPlainText` and
member declarations; its native identifies types by **GUID**, which would need a map maintained across CODESYS
versions. So CODESYS keeps PLCopen because it is better *for CODESYS*, not because it is shared.

**The architecture already permits the split.** `CLAUDE.md`: the parity boundary is the **pipe wire**, not the
driver — both vendors must serve byte-identical *responses*, and only irreducible vendor glue lives in an IDE
host. A per-vendor transport is sanctioned; sharing one was a convenience.

## The cost argument was weaker than it was presented

Recorded in the same census that rejected it, then discounted:

> *the tree shape may be **closer** to Volt's network text (itself an expression tree) than PLCopen's graph is —
> `GraphReader` spends much of its length lowering that graph into a tree*

So the second converter may be **simpler** than the one in use. That was never tested, because the decision had
already been made on cost.

---

## The four experiments that decide it

Every remaining **?** in the TwinCAT column is closable, and until they are closed this is a strong indication
rather than a conclusion. In priority order:

1. **R3 — can NWL round-trip an FBD and an LD body?** The whole question. Read `DocumentXml` for a known FBD POU
   and a known LD POU, convert to network text, and compare against what PLCopen produces today for the same
   POUs. If the tree lowers more directly than the graph does, the cost argument inverts completely.
2. **W14 — does `set_DocumentXml` normalize?** Set a document back unchanged and diff it. PLCopen's importer
   rewrites `LineIds`, zeroes the POU `Id` and reformats declarations; if the native setter does not, that closes
   the single largest source of churn.
3. **W3/W12 — is a partial write refusable?** A transport that cannot refuse cleanly is not usable regardless of
   fidelity.
4. **R9 — do in-POU member folders survive?** PLCopen's importer flattens them and Volt re-places from its own
   `%FOLDER`. If the native document keeps them, that machinery disappears.

## What does NOT change

- **CODESYS stays on PLCopen.** Measured, on merit.
- **The wire does not change.** Both vendors keep serving byte-identical responses; this is entirely below the
  parity boundary.
- **CFC/SFC/IL stay unsupported.**
- **The `lossless-push` invariant still applies** — it is about not losing what a projection cannot express, and
  that is true of any transport. A better transport shrinks the non-expressible set; it does not remove the need
  to be honest about what remains.

---

## §NWL — experiment 1, measured 2026-08-28

The decisive cell. A recorded LD fixture (`tc-ld/ld_ton_rung_two_networks.plcopen.xml`) was imported into a live
project and the SAME POU's native document read back, so both encodings describe one body rather than two
anecdotes. 14,849 chars.

**The declaration is verbatim, including the engineer's irregular spacing** — a tab, a leading space and a
two-space indent all preserved inside `<Declaration><![CDATA[…]]>`:

```
PROGRAM ladder
VAR
	outpur: BOOL;
	 enable, done : BOOL;
  elapsed : TIME;
```

**Per-network metadata is present and named**: `Title`, `Label`, `OutCommented`, `Comment` on every `Network`.
That is checklist R10, which PLCopen fails outright.

**The body is an EXPRESSION TREE, not a graph.** Every node type in the document:

```
Network · BoxTreeAssign · BoxTreeBox · BoxTreeOperand · Operand · Operator · OutputItemList · ParamList · Flags
```

One rung, with the `Flags` noise stripped:

```
BoxTreeAssign
  OutputItems -> Operand "outpur"  (Type "BOOL")
  RValue      -> BoxTreeBox  BoxType "AND"
                   Instance -> Operand (IsInstance true)
                   …ParamList
```

That is `outpur := (… AND …)` — **Volt's network text, already in the vendor's storage**. The mapping to
`GraphModel` is close to 1:1: `BoxTreeAssign`→`OutVar`, `BoxTreeBox`→`Block`, `Operand`→`InVar`,
`ParamList`→`Pin`s.

### Three consequences that change the cost argument

1. **There are NO contacts, coils or power rails in an LD body.** `DefaultViewMode` is `"Ld"` — the ladder is a
   *view*; the storage is already the lowered boolean form. So `splice-graphical-body` §2.1 — *"an LD contact is
   demoted to a floating data box and its power-rail wire is destroyed"*, the one loss a ladder engineer would
   SEE — **cannot occur in this transport**, because there is no contact to demote. `GraphReader.LowerLadder`
   exists only to undo a lowering the vendor already did for us.
2. **Operands carry their TYPE inline** (`Type "BOOL"`, `IsInstance`). Volt currently recovers FB instance types
   from `InstanceTypes.FromBody` plus a TEXT PARSE of the declaration, described in its own source as "an
   approximation forever". The native document makes that guess unnecessary.
3. **The census was right the first time and then talked itself out of it.** It recorded that the tree "may be
   closer to Volt's network text than PLCopen's graph is — `GraphReader` spends much of its length lowering that
   graph into a tree", and discounted it. Measured: it is closer, and the lowering is redundant work.

**Verdict on R3: PASS, and the second converter is likely SMALLER than the one in use** — it drops ladder
lowering and instance-type inference rather than adding to them.

### Still unmeasured, and still able to sink this

- **W14** — does `set_DocumentXml` normalize what it is given? PLCopen's importer rewrites `LineIds`, zeroes the
  POU `Id` and reformats declarations. If the native setter does the same, its fidelity advantage narrows.
- **W3 / W12** — can a partial write be refused cleanly?
- **R9** — do in-POU member folders survive the native document?

### Method notes, so this is reproducible

- TwinCAT language codes, read off live items: **ST=1, SFC=3, FBD=4, CFC=5, LD=6**.
- `DocumentXml` is available on a POU but returns **0 chars** on folders, libraries, task references and on a POU's
  ACTION child (an action exposes `ImplementationXml` instead).
- A project can hold several items of the same name — `PLC_PRG` existed three times here (root, `POUs/`, and a
  `PlcTask/` reference). A name-based walk finds the wrong one and reads 0 chars, which reads as "the API does
  not work". It does.

---

## §W14 — experiment 2, measured 2026-08-28

Does `set_DocumentXml` normalize what it is given? Two parts, on the live LD POU from §NWL.

**A. Identity — set the document back UNCHANGED, read it again.**

| | |
|---|---|
| length | 15,175 → **15,175** chars |
| lines | 329 → **329** |
| differing lines | **1** |

```
before: <POU Name="ladder" Id="{b80953f3-4668-40f3-89c5-d9f5e377b01e}" SpecialFunc="None">
after : <POU Name="ladder" Id="{00000000-0000-0000-0000-000000000000}" SpecialFunc="None">
```

**B. Isolation — change exactly one operand name.** The rename landed, length went 15,175 → 15,178 (the three
added characters), and the only other difference was the same `Id` zeroing. Nothing else moved.

### What this settles

`set_DocumentXml` normalizes **exactly one thing: it zeroes the POU `Id`.** Set against PLCopen's importer, which
reorders `<LineIds>`, re-indents the implementation, zeroes the `Id` *and* regenerates the declaration from the
typed `<interface>`:

| perturbation | PLCopen import | native set |
|---|---|---|
| declaration reformatted (`x : INT;` → `x: INT;`) | ✗ yes | **✓ no** |
| `<LineIds>` reordered | ✗ yes | **✓ no** |
| implementation re-indented | ✗ yes | **✓ no** |
| POU `Id` zeroed | ✗ yes | ✗ yes — **same as today, not a regression** |
| item relocated to project root | ✗ yes (W11) | **✓ no** |

The one remaining perturbation is **already what happens today**, so it is not a differentiator — and Volt's
protocol invariant is that **the item NAME is the identity**, not the vendor GUID, so nothing in Volt reads it.
(It is the churn already visible in every e2e run: fixture `.TcPOU` files come back with a fresh `Id`.)

**The consequence is bigger than the row.** A native body survives a write **byte-for-byte**. That is exactly the
property `lossless-push` was trying to manufacture with element-level carry and a runtime loss check — here it
comes free, because nothing is regenerated. Storing a TwinCAT body verbatim and setting it back is lossless by
construction rather than by verification.

**Verdict on W14: PASS.**

---

## §FBD — experiment 1b + 2b, measured 2026-08-28

§NWL measured an **LD** body. "FBD shares the encoding" was an inference until an FBD body was read, so R3 was
demonstrated on one language, not two. Measured now on the recorded `fbd_en_eno` fixture imported live —
21,689 chars, `DefaultViewMode = Fbd`.

**Structure — same encoding, different node arrangement.**

| | LD (`ladder`) | FBD (`fbd`) |
|---|---|---|
| `NWL` / `XmlArchive` | ✓ | ✓ |
| `BoxTreeAssign` | 3 | **0** |
| `BoxTreeBox` | 3 | 4 |
| `BoxTreeOperand` | 3 | 6 |
| `Operator` / `ParamList` | 3 / 5 | 4 / 7 |
| `Title` / `Label` / `OutCommented` | ✓ | ✓ |
| **`contact` / `coil` / `PowerRail`** | **0 / 0 / 0** | **0 / 0 / 0** |

An FBD box carries its own sinks and sources instead of hanging off a separate assign node:

```
BoxTreeDemux                       <- the EN/ENO wrapper
  Input -> BoxTreeBox  BoxType "AND"
    Instance    -> Operand
    OutputItems -> Operand "out"
    InputItems  -> BoxTreeOperand -> Operand "TRUE"
```

So the converter must handle several `BoxTree*` kinds — `BoxTreeAssign` (a plain assignment), `BoxTreeBox` with
`OutputItems` (a box with sinks), `BoxTreeDemux` (EN/ENO). **State honestly: that is more than one shape.** But
every one is a LOCAL tree — no `refLocalId` edges to resolve, no id chasing, no ladder lowering. Ordinary work,
not a research problem.

**W14 on FBD — identical to LD.** 21,689 → **21,689** chars, 470 → **470** lines, exactly **one** line different:

```
before: <POU Name="fbd" Id="{4e6c9813-1176-44df-992d-21fed912771c}" …>
after : <POU Name="fbd" Id="{00000000-0000-0000-0000-000000000000}" …>
```

**R3 and W14 are now closed for BOTH graphical languages.**

### Method notes — two more traps, both of which read as "the API is broken"

- **`PlcOpenImport` settles ASYNCHRONOUSLY.** After it returns, the imported item is invisible in the *same* COM
  session — even after re-acquiring the PLC-project handle — while a fresh process sees it immediately. DIALECT
  D4d covers handles to the *replaced* item; this is the parent's child enumeration, and it is wider.
- A `PlcOpenExport`/`Import` round-trip through a recorded fixture is a fine way to stage a body for probing, but
  the probe must run in a **separate invocation** from the import.

---

## §W3 / §W12 — experiment 4: is a bad write refused cleanly?

A transport that cannot refuse is unusable regardless of fidelity. Four documents set onto a live FBD POU
(baseline 21,692 chars), checking both the outcome and whether the POU survived:

| set | outcome | POU afterwards |
|---|---|---|
| truncated XML | **THREW** — *"elements not closed: o, l2, o, l2, … Line 236, position 20"* | **intact** |
| not XML at all | **THREW** — *"Data at the root level is invalid. Line 1, position 1"* | **intact** |
| empty string | **THREW** — *"Cannot set empty document"* | **intact** |
| valid XML, unknown `BoxType` | accepted | changed (21,703) |

`set_DocumentXml` **validates and is atomic**: a malformed document is refused whole, with a line and position,
and the POU is byte-identical afterwards. That is a stronger guarantee than the PLCopen import offers.

The fourth row is **correct behaviour, not a gap.** An unknown operator is structurally valid XML and a SEMANTIC
error — the compiler's job, not the transport's. Volt's standing rule is that it does not judge code correctness;
`volt build` reports it. PLCopen accepts it too.

**W3 is passed for a different reason than the others**: with a native transport nothing is regenerated, so there
is no "what text cannot express" to destroy in the first place.

## §R9 — experiment 3: do in-POU member folders survive?

Built directly rather than imported — the PLCopen import of the foldered fixture reported success and produced
nothing, which is its own data point. An FB with a folder `Inner` containing a method `Compute`:

```xml
<Folder Name="Inner" Id="{f83c01cc-…}" />
<Method Name="Compute" Id="{141c8bfc-…}" FolderPath="Inner">
  <Declaration><![CDATA[METHOD Compute : INT
VAR_INPUT
	d : INT;
END_VAR]]></Declaration>
```

The folder is **structural in the document**: a `<Folder>` element, plus `FolderPath=` on the member. PLCopen's
importer flattens in-POU folders, which is why `RestoreChildFolders` exists and re-places every member after
every write, from Volt's own `%FOLDER` directive. **On a native transport that machinery is unnecessary.**

`[UNMEASURED: the method's `<ST>` came back EMPTY in the document immediately after `ImplementationText` was
set. Either the property write had not settled, or `DocumentXml` and the text properties are not coherent within
one COM session. Not central to R9, but it must be understood before the native document is used for writes —
close it by setting the text, re-acquiring, and re-reading.]`

---

# Verdict

**All four deciding cells are closed, and `DocumentXml` passed every one**, including R3, which could have sunk
the proposal. TwinCAT's PLCopen export fails seven requirements; its native document fails none that were
measured.

The recommendation is therefore **`DocumentXml` for TwinCAT, PLCopen for CODESYS** — asymmetric, each chosen on
its own merits, with the parity boundary staying where the architecture already puts it: the wire.

**One caveat carried forward, not hidden:** the write path is proved for setting whole documents and for
refusing bad ones, but the coherence question in §R9 is open, and a *member-level* write through the native
document has been proved only by the earlier splice experiment (a `<Method>` and a `<Property>` set back
successfully). That is enough to decide the direction; it is not yet enough to implement against.

---

## §CS - CODESYS held to the same standard, measured 2026-08-28

`export_native` was rejected on one 3,166-byte sample. TwinCAT's native got four experiments; this is CODESYS's.
**R3 disqualifies it, so the remaining three were not run - and that early exit is deliberate, not an omission.**

### The corpus first, because it reframes the graphical question

A real customer project (`Pro2193-94-95-96`), **1,314 objects**, classified by type:

| n | decl | impl | what it is |
|---|---|---|---|
| 326 | 326 | 326 | methods |
| 249 | 249 | **248** | POUs |
| 225 | 0 | 0 | folders |
| 96 | 96 | 0 | DUTs |
| 19 | 19 | 0 | property accessors (`Get`, `Get`, ...) |
| 7 | **0** | 7 | **actions - no declaration, implementation only** |

The action row independently confirms "an action has no declaration". And of 249 POUs, **248 have a textual
implementation**: there is exactly **ONE graphical POU in 1,314 objects**.

### R3 - the native archive is a generic object dump, not a document

`SetErrorFB`, that one graphical POU: **90,434 bytes** - six times TwinCAT's *entire* LD POU (14,849).

```xml
<ExportFile><StructuredView Guid="{d9b2b2cc-...}">
<Single xml:space="preserve" Type="{3daac5e4-...}" Method="IArchivable">
  <Null Name="Profile" />
  <List2 Name="EntryList">
    <Single Name="IsRoot" Type="bool">True</Single>
```

`Method="IArchivable"` - a **.NET object-graph serializer dump**. Measured on that one file: **30 distinct type
GUIDs**, 75 property names, and among them `Bounds`, `CanvasHeight`, `CanvasWidth`, `AutoSizeCanvas` - it
serializes the **editor's canvas geometry**. It is the editor's state, not a description of the logic.

| | TC `DocumentXml` | CS `export_native` |
|---|---|---|
| size, one graphical POU | 14,849 | **90,434** |
| shape | expression **tree** | object **graph** (`DestPinId`, `ConnectionId`, `EnEno`) |
| vocabulary | `BoxTreeAssign`, `Operand`, `Title` | **`Single` / `List2` + type GUIDs** |
| network metadata | `Title`, `Label`, `OutCommented` | **none appear** |
| editor geometry | absent | present (`Bounds`, `Canvas*`) |

### Verdict: CODESYS keeps PLCopen

Now for measured reasons rather than a glance: the native is larger, GUID-typed, carries no network metadata (so
R10 does **not** improve there either), and is editor state rather than a document. PLCopen is a documented
standard with domain vocabulary and is genuinely the better transport *for this vendor*.

The asymmetry stands on evidence from both sides: **`DocumentXml` for TwinCAT, PLCopen for CODESYS.**

### On identifiers - no GUID enters the product

Worth stating, because the GUIDs above could be misread as a design dependency. **They are not.** Volt already
classifies objects by OFFICIAL identifiers on both vendors:

- **CODESYS: named interfaces** - `IPOUObject`, `IPOUMethodObject`, `IPropertyAccessorObject`, `IGVLObject`,
  `IActionObject` (`CodesysTypeMap`).
- **TwinCAT: the native `TREEITEMTYPE` enum** - 601 folder, 604 FB, 609 method, named after the official
  constants. (With the recorded caveat that Beckhoff renumbered 622/624/625 into the 650s, so the code follows
  the live build over the published doc.)

The type GUIDs appeared only in the PROBE, because IronPython's `dir()` does not enumerate dispatched members and
`k.type` was the quickest one-off classifier. Rejecting the native transport means they never enter the design.
The only GUID the driver touches is an object's own instance handle, which CODESYS's API requires
(`GetObjectToRead(handle, guid)`) - a calling convention, not a type scheme.

### What was NOT measured, and why that is acceptable

W14, W12 and R9 were not run against the CODESYS native: R3 already disqualifies it, and measuring the write
behaviour of a transport that cannot be read spends the budget in the wrong place. If it is ever revisited, those
three must be run first, exactly as they were for TwinCAT.

### Consequence for `lossless-push`

It does **not** disappear. CODESYS keeps PLCopen, keeps regenerating a body from network text, and keeps every
loss that change exists to stop - plus R10, which no CODESYS transport fixes. It becomes **CODESYS-only**, and
the engine keeps network text, `GraphModel` and the carry/refuse invariant for it. Only TwinCAT sheds them.

**One datum to carry into that:** one graphical POU in 1,314 objects. Size the work against how rare it is.

---

## §CS-W14 — the transport CODESYS is KEEPING, measured 2026-08-28

W14 and W11 sat at `~` for CODESYS. That was the wrong place to leave them: CODESYS **keeps** PLCopen, so how its
importer behaves is a live product concern, not a footnote about a rejected transport. Measured with **Volt's own
calls**, not the convenience defaults.

### The plaintext declaration block is FLAG-CONTROLLED on CODESYS

`export_xml(objects, "", recursive, false, ⟨flag⟩)`:

| 5th argument | size | `InterfaceAsPlainText` |
|---|---|---|
| **`true`** — what Volt passes | 1,445 | **2** (the A7 "twice") |
| `false` | 1,125 | **0** |

This reframes the whole declaration crisis. On CODESYS the verbatim block is **opt-in, and Volt opts in**. On
TwinCAT it is not controllable at all — `PlcOpenExport(bstrFile, bstrSelection)` takes no options and
`PlcOpenExport2` adds only `bSubTree` — so when that vendor stopped emitting it there was no flag to turn back on.
Same missing block; entirely different cause. **A first probe using the default flag reported
`InterfaceAsPlainText x0` on a CODESYS POU** — which would have looked like the TwinCAT regression happening on
CODESYS too. It was the flag, not the vendor.

### W14 — export → import unchanged → export again

| | |
|---|---|
| size | 1,445 → **1,445** chars |
| lines | 47 → **47** |
| differing lines | **1** |

```
before: …creationDateTime="2026-08-28T11:51:29.8031941" />
after : …creationDateTime="2026-08-28T11:51:30.4132032" />
```

An export **timestamp** in `<fileHeader>` — not content. **No `LineIds` reordering, no re-indentation, no
declaration regeneration.**

### W11 — the import does NOT relocate

`PLC_PRG` parent `Application` **before and after**. TwinCAT's import always deposits the item at the
PLC-project root and Volt has to move it back (D4g); CODESYS's does not.

### So the two PLCopen implementations differ sharply on WRITE

| perturbation | TwinCAT import | CODESYS import |
|---|---|---|
| declaration reformatted | ✗ yes | **✓ no** |
| `<LineIds>` reordered | ✗ yes | **✓ no** |
| implementation re-indented | ✗ yes | **✓ no** |
| item relocated to project root | ✗ yes | **✓ no** |
| POU `Id` zeroed | ✗ yes | ✓ no |

**"PLCopen" is not one behaviour.** TwinCAT's importer perturbs five things; CODESYS's perturbs none. That is a
further argument for choosing per vendor rather than per format — and it means the transport CODESYS keeps is in
much better shape than the one it shares a name with.

### Method note

`import_xml` is called on the PARENT node and takes the XML **string**, not a path:
`parent.import_xml(⟨ConflictResolve⟩, xml, false)`. From IronPython only the numeric `0` was accepted —
`'Replace'` raised *"expected IImportReporter, got str"* (wrong overload) and `1` raised *"Cannot convert numeric
value 1 to ConflictResolve. The value must be zero."* Volt resolves the member by NAME through reflection, which
is the durable form; the numeric literal is a probe convenience only.

---

## §R3-bis — pin modifiers are a numeric bit-field, decoded 2026-08-28

Review challenged §NWL's R3 PASS: the native LD document shows no `contact`/`coil`/`PowerRail`, which could mean
*"the ladder is a view"* (my reading) or *"the native does not carry the rendering, and PLCopen does"* (the
opposite). The original experiment could not distinguish them, and I had **stripped `Flags` unread**.

Re-measured by **differential decoding** — change exactly one PLCopen attribute, re-import, diff the native.
Fixture: `tc-fbd/PLC_PRG_jump_sr.plcopen.xml`, a recorded live TwinCAT export carrying `negated="true"` ×1 and
`edge="rising"` ×1.

| change | native effect | lines changed of 572 |
|---|---|---|
| `negated="true"` → `"false"` | `<v n="Flags">` **1 → 0** | 3 (POU `Id`, `Flags`, `Fixed`) |
| `edge="rising"` → `"none"` | `<v n="Flags">` **16 → 0** | **1** |

**Control:** a PLCopen re-export of the same POU still reports `negated="true" ×1`, `edge="rising" ×1` — the
modifiers are genuinely stored and genuinely survive the import, so the native's silence was not the import
dropping them.

**Decode so far:** `Flags` bit value **1 = negated**, **16 = rising edge**, **4 = a third modifier** (undecoded;
the fixture is `jump_sr`, so plausibly SET/RESET storage).

**R3 = PASS**, on a mechanism rather than an inference. The converter must decode `Flags`; a `GraphModel`
mapping that ignores it would silently drop negation and edge detection — the exact class of loss this whole
programme exists to prevent.

**Method note, and it is the important part.** Twice I searched the native for `Negat`/`Invert`/`Edge`/`Set`/
`Reset` and concluded from absence that the semantics were absent. Both times the answer was in `Flags`, encoded
by VALUE. **An absence found by grepping for a NAME is not evidence about a format that may encode numerically.**
The reliable technique is differential: toggle one input, diff the output, read the mechanism off the delta.
