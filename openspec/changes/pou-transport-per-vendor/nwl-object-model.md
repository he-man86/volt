# The 3S NWL object model — shared by BOTH vendors, and it removes PLCopen entirely

Found 2026-08-28, after the transport checklist was already written. **It supersedes the transport question
rather than answering it**, and it is a better answer than either option the checklist scored.

## The finding

`NWLObject.dll` is a **3S** assembly, and **both vendors ship it, identically**:

| | TwinCAT | CODESYS |
|---|---|---|
| path | `C:\TwinCAT\3.1\Components\Plc\Common\` | `C:\Program Files\CODESYS 3.5.21.40\CODESYS\Common\` |
| assembly | `NWLObject 3.5.13.0` | `NWLObject 3.5.13.0` |
| types | 74 | 74 |
| `IFlags` | `Negation, Set, Jump, Return, Rtrig, Ftrig` | **identical** |
| `NWLDisplayMode` | `LD, FBD, IL` | **identical** |
| body interfaces | `INWLItem, INetwork, INWLItemVisitor…` | **identical** |

**101 of TwinCAT's 128 PLC-Common DLLs are shared by name with CODESYS** (`NWLObject`, `CFCObject`,
`ActionObject`, `ApplicationObject`, …). The two products share a 3S core, and that core — not PLCopen — is the
thing both actually store.

## The typed route exists and Volt is already holding one end of it

```
_3S.CoDeSys.POUObject.IPOUObject            Implementation -> IImplementationObject
_3S.CoDeSys.NWLObject.INWLImplementationObject
                                            NetworkList -> INetwork[]
                                            GetNetwork  -> INetwork
_3S.CoDeSys.NWLObject.INWLItemVisitor       (a visitor, for traversal)
```

**`CodesysTypeMap` already classifies objects by `IPOUObject`**, and `CodesysObjectModel.ObjectInterfaceNames`
already reflects over them. The driver holds the object; the body is one cast away.

## Why this is better than anything the checklist scored

| | PLCopen (today) | native XML (planned) | **NWL object model** |
|---|---|---|---|
| CODESYS body | parse XML graph | — | **typed objects, no serialization at all** |
| TwinCAT body | parse XML graph | parse NWL tree | parse NWL tree — **same model** |
| shared code | a PLCopen layer in the ENGINE | none — two converters | **one model, defined by the vendors** |
| pin modifiers | `negated`/`edge` attributes | `Flags` bit-field | **`IFlags` booleans, named** |
| PLCopen | required | CODESYS only | **gone entirely** |

It answers both objections that started this: **PLCopen disappears completely**, and **complex XML is no longer
reconstructed in both directions** — not at all on CODESYS, and on TwinCAT only parsed, never rebuilt from a
lossy projection.

It also dissolves problems the plan was still carrying: `GraphModel` stops being "a projection of PLCopenXML"
and becomes a projection of the vendors' own model; `NetworkStride`/`localId` invention disappears; and
`TypeHandlingMode { Embedded, Declaration, PreferEmbedded, PreferDeclaration }` is the vendors' own name for the
FB-instance-type choice Volt currently makes by text-parsing a declaration.

## MEASURED — 2026-08-28, CODESYS 3.5.21.40 Patch 4 + TwinCAT 3.1 4024.74

Questions 1 and 2 are settled. The probe is the driver's own path:
`_3S.CoDeSys.Core.SystemInstances.ObjectMgr` → `GetObjectToRead(handle, guid).Object` →
`GetMember(iobj, "Implementation")` — the member `CodesysObjectModel` ALREADY calls for ST bodies.

### 1. Typed READ — PROVEN

A POU created with `language=fbd` and one with `language=ladder` both yield:

```
IObject        _3S.CoDeSys.POUObject.POUObject
Implementation _3S.CoDeSys.NWLObject.NWLImplementationObject
               INWLImplementationObject, INWLImplementationObject2
NetworkList -> _3S.CoDeSys.NWLObject.Network
               INetwork, INetwork2, INetwork3, INetwork4, INWLItem, INetworkWithIL
```

**The aspect type IS the language** — no language field is consulted. The same project's CFC POU returns
`CFCObject.CFCImplementationObject` (canvas: `Items`, `RoutingPaths`, no `NetworkList`), and its 271 ST POUs
return `STImplementationObject`. Dispatch is a cast, not a lookup.

Traversing a real imported FBD body (`VltFbd_FbdRoot.plcopen.xml`):

```
Network        Title='' Label='' Comment='' OutCommented=False NetworkItemCount=1
GetTree(0)  -> BoxTreeAssign    Id=6  Flags=-    .Outputs .RValue
                 BoxTreeOperand Id=3  Flags=-    .Operand
                   Operand      Id=4  OperandExpr='a'  Address=..  SymbolComment=..
```

Everything network text needs is typed and present: the operand symbol (`OperandExpr`), per-item `Id`, and
`Flags` exposing the six named booleans. `INetwork` also carries `Accept(INWLItemVisitor)` — a renderer is a
visitor, not a parser.

### 2. Typed WRITE — PROVEN

`GetObjectToModify(handle, guid)` → mutate → `SetObject(meta, true, null)`, and the re-read confirms:

```
network[0].Label   ''  ->  'VLT_PROBE'      >>> TYPED WRITE: WORKS
```

The full mutation surface is on `INetwork`: `SetTree(i, IBoxTree)`, `InsertTree`, `AppendTree`,
`RemoveNetworkItem(i)`, `GetItemById(Int64)`, plus `Normalize()`. **No serialization in either direction for
CODESYS.**

### 3. TwinCAT — the model is the same, the ACCESS is not

Two measurements, and they point opposite ways:

**The storage IS the NWL graph.** `POU_PBD.TcPOU` (TwinCAT's FBD fixture) contains `<Implementation><NWL>`
wrapping `<XmlArchive>` / `<TypeList>` / `<o>` / `<v>` — a serialized object graph, not a schema. TwinCAT's
native document is this model, persisted.

**The engineering is not in the shell.** With the fixture solution loaded in TcXaeShell, the PLC tree walked
(`TIPC^Untitled2^Untitled2 Project`, 10 children), `ProduceXml()` called on both the project and a POU, and
three documents open, the count of loaded modules under `C:\TwinCAT\3.1\Components\Plc\` was **0**. That is
live-checked, not assumed — the same enumeration shows `clr.dll`, `mscorlib.ni.dll`, `TwinCAT XAE Base.dll` and
`TwinCAT System Manager.dll`. A sweep of every process on the machine found `NWLObject` / `_3S` loaded
**nowhere**. TwinCAT ships the assembly (`Components\Plc\Common\NWLObject.dll`, plugin `3.5.13.30`), but the
tree and `ProduceXml` are served by the native System Manager without it.

No automation route reaches the PLC editor either: `File.OpenFile` on a `.TcPOU` opens the XML text editor, and
the TwinCAT project reports `ProjectItems.Count = 0`, so DTE cannot open a POU with its own editor factory.

**Conclusion: CODESYS gets live typed objects; TwinCAT gets the same model, serialized in its own document.**
Point 3 below predicted this and is confirmed — but for a sharper reason than "out-of-process": the object model
is not resident in TwinCAT's shell at all, so an in-proc Volt component there would have nothing to attach to.
That is not a small VSIX away.

### What this changes in the plan

- **PLCopen leaves both packages.** CODESYS never serializes; TwinCAT reads and writes its own NWL archive. The
  engine's ~2,100 PLCopen lines lose their last consumer.
- **`GraphModel` must carry `Title`, `Label`, `Comment`, `OutCommented`.** `layout.md` called this a one-time
  extension forced by *TwinCAT's* native document, and flagged it as the honest cost of vendor independence.
  Measured: CODESYS's `INetwork` carries the identical four. It is not a vendor leak — **it is the shared model,
  and PLCopen was the thing losing it.**
- **FBD / LD / IL are one model in three views.** `INetwork` exposes `ActivateFBD`, `ActivateIL`,
  `CanConvertToIL`, `GetILLine`, `ILActive`, `ILValid`, matching `NWLDisplayMode { LD, FBD, IL }`. `GraphReader`
  lowering LD into the same node graph as FBD was right. IL being "unsupported" is a Volt POLICY about a view,
  not a separate body format — worth restating in DIALECT that way.

## What is NOT yet established — do not commit on this page alone

1. ~~Can the in-proc CODESYS driver cast and traverse?~~ **SETTLED — yes.** See MEASURED above.
2. ~~Can it WRITE through the same objects?~~ **SETTLED — yes**, `SetObject` commits the mutation.
3. **TwinCAT stays out-of-process.** `VoltBridgeTwincat.exe` talks COM and cannot load an in-proc .NET object
   model, so it gets `DocumentXml` — the same model, serialized. **The asymmetry does not vanish; it moves from
   "different formats" to "same model, two access paths"**, which is a much better place for it.
4. **Version coupling.** Both installs happen to ship `3.5.13.0` today. Two vendors on one 3S core will not
   always be in lockstep, and the model is an internal assembly with no compatibility commitment — the same
   durability question raised against CODESYS's GUID-typed native, and it must be asked here too.
5. **Non-POU kinds and CFC/SFC** are untouched by this finding.

## Consequence for the existing plan

`pou-transport-per-vendor` scored PLCopen against a native SERIALIZATION. This is a third option it never
considered — the vendors' shared OBJECT MODEL. Nothing in the checklist is wrong, but its conclusion
("DocumentXml for TwinCAT, PLCopen for CODESYS") is answering a narrower question than the one now open.

~~Settle (1) and (2) before writing any converter.~~ **Both settled 2026-08-28 — see MEASURED.** What
remains open before a converter is written is (4) version coupling and (5) the non-POU kinds; neither blocks
the CODESYS side.
