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

## What is NOT yet established — do not commit on this page alone

1. **Can Volt's in-proc CODESYS driver actually cast and traverse?** It is net48 loaded inside CODESYS and
   already reflects over plugin assemblies, so this is plausible, not proved. **Prove it by reading one
   graphical POU's `NetworkList` and rendering network text from typed objects.**
2. **Can it WRITE through the same objects?** `INetwork`'s mutability is unmeasured. If writes must still go
   through a serialization, half the benefit remains but the claim shrinks.
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

**Settle (1) and (2) before writing any converter.** They are small: one in-proc read, one in-proc write.
