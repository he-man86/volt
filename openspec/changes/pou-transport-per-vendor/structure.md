# Structure — package, folder, file. Planned to the file, built from scratch where it should be.

This is the level `layout.md` stopped at one layer above. It answers, per file: **NEW / DELETED / RETARGETED /
UNTOUCHED**, and for every "from scratch" it says what would otherwise be carried forward.

## The thing that decides everything below

`GraphModel` is not a neutral model. Its own summary:

> *"A faithful, position-free projection of a **PLCopenXML** FBD/LD body. Every node maps 1:1 to a **PLCopenXML
> element**; wiring is by `localId` / `refLocalId` / `formalParameter` **taken verbatim from the XML**."*

and the shape agrees:

| in the "neutral" model | what it actually is |
|---|---|
| `GraphConstants.NetworkStride = 10_000_000_000` | how **FBD** packs a network index into a `localId` |
| `Conn(long RefLocalId, string? FormalParameter)` | a PLCopen wire, by PLCopen id |
| `GraphNode(long LocalId, …)` | node identity **is** the PLCopen attribute |
| `OpaqueNode(…, string RawXml)` | **raw PLCopen XML held inside the model** |
| `Pin.Type` | from CODESYS's `inputparamtypes` **addData** |

Both adapters were going to target this. That would delete PLCopen and keep its data model — the legacy pattern
surviving the file that named it. **So the model is rebuilt from scratch**, shaped on what the two vendors
actually expose, which is the same NWL object model on both.

## What "from scratch" covers, and what it must NOT

Stated plainly, because the wrong answer here is expensive in both directions:

| | decision | why |
|---|---|---|
| the graphical model | **from scratch** | it is PLCopen's shape wearing a neutral name |
| both vendor adapters | **from scratch** | one has no code at all; the other's is a PLCopen exporter |
| `ICodeStore` | **from scratch** | `string ReadXml()` is the wall that excludes every non-PLCopen IDE |
| `PlcOpen/` (18 files, 3,187 lines) | **deleted** | zero consumers once the adapters land |
| **network text — the FORMAT** | **kept, unchanged** | it is a PRODUCT SURFACE: engineers' `.fb` files on disk, `volt-lsp-iec` parses it as a first-class sublanguage, and `docs/network-text.md` specifies it. Changing it is a breaking change to users' repos, and it is not what is wrong here |
| `NetworkTextReader` / `Writer` (904 lines) | **retargeted, not rewritten** | the FORMAT is right; only the model they bind to is wrong. Their fixtures are the regression net for the whole change |
| `Format/St/`, `.fb` layout, `Item/`, `Library/`, wire | **untouched** | nothing in this change reaches them |

**The distinction that matters:** *from scratch* is for code whose SHAPE is inherited from the transport being
deleted. It is not for code that encodes measured vendor behaviour or Volt's own published format — rewriting
`NetworkTextReader` would re-lose bugs the corpus took months to find, and the repo's own rule is that a test may
not be adapted to the code.

---

## The new model — `Volt.Engine/Format/Network/NetworkModel.cs`

Shaped on `INetwork` + `IBoxTree`, which is what **both** vendors expose (CODESYS live, TwinCAT serialized).
A network is a list of statement trees, not a bag of nodes wired by id.

```csharp
namespace Volt.Engine.Format.Network;

/// One POU body: a language and its networks. No document, no ids, no raw vendor text.
public sealed record NetworkBody(BodyLanguage Language, IReadOnlyList<Network> Networks);

/// Title/Label/Comment/Disabled are carried by BOTH vendors' INetwork - measured, not assumed.
public sealed record Network(
    string? Title, string? Label, string? Comment, bool Disabled,
    IReadOnlyList<Statement> Statements);

public abstract record Statement;
public sealed record Assign(Expr Target, Expr Value, Flags Flags)   : Statement;
public sealed record Jump(string Target, Expr? Condition)           : Statement;
public sealed record Return(Expr? Condition)                        : Statement;
public sealed record LabelAt(string Name)                           : Statement;

public abstract record Expr;
public sealed record Operand(string Text, string? Type, Flags Flags)              : Expr;
public sealed record Call(string TypeName, string? Instance,
                          IReadOnlyList<Argument> Arguments, CallKind Kind)       : Expr;

/// One input pin. Position is the tree edge; the formal name is only needed when the vendor names it.
public sealed record Argument(string? Formal, Expr Value, Flags Flags);

/// EXACTLY the vendor bit-field, minus the two that are statements here (Jump, Return).
public sealed record Flags(bool Negated, bool Set, bool Rising, bool Falling)
{
    public static readonly Flags None = new(false, false, false, false);
    public bool IsNone => !Negated && !Set && !Rising && !Falling;
}

public enum CallKind  { FunctionBlock, Function, Operator }
public enum BodyLanguage { Fbd, Ld }
```

### What is deliberately absent, and why each absence is the point

| gone | it existed because |
|---|---|
| `LocalId` on every node | PLCopen identifies elements by `localId`. Nothing else ever needed it |
| `Conn(RefLocalId, Formal)` | a PLCopen wire. In a tree the edge IS the containment |
| `NetworkStride = 10^10` | FBD's `localId` packing. Not a fact about logic |
| `OpaqueNode(RawXml)` | keeping the reader TOTAL over the PLCopen XSD by carrying XML it could not model |
| `ExecOrder` on every node | PLCopen `executionOrderId`. The vendors order by tree position; CODESYS exposes `ICFCOrderedImplementationObject` only for **CFC**, which is unsupported |
| `OutputPins` / `OutputTypes` list | positional PLCopen `outputVariables` scaffolding |

**`OpaqueNode` deserves its own line, because deleting it looks like a regression and is not.** It exists so a
body could be REGENERATED from a projection without losing elements the projection cannot express. Nothing is
regenerated any more: CODESYS mutates the live objects in place and TwinCAT rewrites only the networks that
changed. An unmodelled item is not carried — **it is never touched.** That is `lossless-push` closing by
construction rather than by machinery, and it is the single largest reason this transport is worth the work.

`Flags` mirrors `IFlags { Negation, Set, Jump, Return, Rtrig, Ftrig }`, measured identical on both vendors, with
`Jump`/`Return` promoted to statements because that is what they are. `StorageMod.Reset` is NOT in the vendor
bit-field; if a reset coil turns out to be `Set=false` on a coil item, it is a `Flags` field, not an enum — to be
settled against a real LD fixture before the model is frozen.

---

## `Volt.Engine` — file by file

### `Ide/ICodeStore.cs` — REWRITTEN

```csharp
public interface ICodeStore
{
    ItemContent ReadContent(ItemRef item);
    void        WriteContent(ItemRef item, ItemContent content);
    string      ReadManifest(ItemRef item, string kind);
}
```

`ReadXml` / `WriteXml` / `BodyLanguage` / `ReadDeclaration` / `WriteText` are **removed, not deprecated** (§5b.2).
`BodyLanguage` disappears as a contract member because the language now arrives *inside* `ItemContent` — the
driver knows it from the aspect type or the archive header, and a second round-trip to ask "what language is
this" was always the transport leaking upward.

### `Item/ItemContent.cs` — EXTENDED (2 fields, from `REVIEW.md`)

```csharp
public sealed record ItemContent(
    string Kind,
    string Declaration,
    BodyLanguage? Language,   // NEW - null = textual. Was inferred by sniffing the document
    string? Body,
    List<Member> Members);
```

The review's second open item — write INTENT (distinguishing "no body supplied" from "clear this body") — is
already carried correctly by `Accessor`'s *presence-is-the-object* rule and by `null` vs `""` on `Body`, and
`bridge-empty-body-clear-parity` is the incident that fixed it. **No third field.** Restate the rule in the
record's doc so the next reader does not re-derive it.

### `Format/Network/` — the format kept, the model replaced

| file | | |
|---|---|---|
| `NetworkModel.cs` | **NEW** | replaces `GraphModel.cs` |
| `GraphModel.cs` | **DELETED** | the PLCopen projection |
| `NetworkTextReader.cs` (580) | **RETARGETED** | parse -> `NetworkBody`. The grammar does not change |
| `NetworkTextWriter.cs` (324) | **RETARGETED** | render `NetworkBody`. `DISABLED` now round-trips, because `Network.Disabled` finally survives the transport |
| `NetworkText.cs`, `FbdOperators.cs` | **KEPT** | format-level, model-independent |

### `Format/Body/` — KEPT (`BodyMarker`, `Languages`), already zero-XML

### `PlcOpen/` — DELETED ENTIRELY (18 files, 3,187 lines)

`PlcOpenDocument` `PouReader` `PouSplice` `PouDocument` `Declaration` `Namespaces` `ProjectStructure`
`GraphReader` `GraphWriter` `GraphRoundTrip` `BodyCodec` `BodyElement` `BodyGuard` `BodySpliceGuard`
`BodyFormatGuard` `InstanceTypes` `NetworkCode` `NetworkSplice` + `DIALECT.md` (split per vendor).

Four carry a neutral half that must come back BEFORE the folder is deleted, or the deletion loses a rule:

| neutral half | lands as |
|---|---|
| `BodySpliceGuard` — the refusal POLICY | `Format/Body/UnsupportedBodyGuard.cs` |
| `BodyFormatGuard` — "decide from the IDE's LIVE language, never the incoming text" | folds into the same file |
| `InstanceTypes.Of(declaration)` — a text parse | `Format/St/InstanceTypes.cs` |
| `NetworkSplice` — the CARRY RULE | **does not come back.** Nothing is regenerated; there is nothing to carry |

### `Sync/` — 5 lines change

`Materializer` (2) and `PushService` (3) stop calling `PouDocument`/`PouSplice` and call
`ReadContent`/`WriteContent`. `RestoreChildFolders` is **deleted** (§5b.4): CODESYS keeps in-POU folders because
nothing re-imports the POU, and TwinCAT's archive carries `FolderPath`.

---

## `Volt.Ide.Codesys` — file by file

```
PipeHost.cs                        UNTOUCHED
Driver/CodesysDriver.cs            UNTOUCHED   (session/lifecycle)
Driver/CodesysDriver.Tree.cs       UNTOUCHED   (IProjectTree)
Driver/CodesysDriver.Code.cs       DELETED  -> Driver/CodesysDriver.Content.cs   NEW
Ide/CodesysObjectModel.cs          KEPT     (+ the aspect accessors already there)
Ide/CodesysObjectModel.PlcOpen.cs  DELETED  (209 lines: export_xml/import_xml/ConflictResolve)
Ide/CodesysObjectModel.Reflection.cs  KEPT  - the reflection helpers the adapter needs
Ide/CodesysTypeMap.cs              KEPT     - already classifies by named interfaces
Ide/CodesysObjectModel.{Build,Descriptors,Libraries}.cs   UNTOUCHED
Content/CodesysContentReader.cs    NEW  - IObject -> ItemContent (decl + body + members, per aspect)
Content/CodesysContentWriter.cs    NEW  - ItemContent -> aspects, in place
Network/NwlInterop.cs              NEW  - THE ONLY place that names an NWLObject member
Network/CodesysNetworkReader.cs    NEW  - INWLImplementationObject -> NetworkBody, via INWLItemVisitor
Network/CodesysNetworkWriter.cs    NEW  - NetworkBody -> SetTree/AppendTree/RemoveNetworkItem
DIALECT.md                         NEW  - the CODESYS half of the engine's DIALECT.md
```

**`NwlInterop.cs` is a deliberate chokepoint** (task 4a.5). `NWLObject` is an internal 3S assembly with no
compatibility commitment — `3.5.13.0` on CODESYS, `3.5.13.30` on TwinCAT. Every member access goes through one
file that throws with the OBSERVED assembly version in the message when a member is missing. Never a silent
degrade — the repo's zero-fallback rule applied to a dependency Volt does not own.

Language detection becomes a **cast**: `NWLImplementationObject` -> FBD/LD, `STImplementationObject` -> textual,
`CFCImplementationObject`/SFC -> marker. This deletes the `BodyLanguage` export-and-sniff round trip.

## `Volt.Ide.Twincat` — file by file

```
Program.cs, Ide/{ComMessageFilter,RotInstances,StaDispatcher}.cs   UNTOUCHED
Driver/BeckhoffDriver.cs, .Tree.cs                                 UNTOUCHED
Driver/BeckhoffDriver.Code.cs      DELETED -> Driver/BeckhoffDriver.Content.cs  NEW
Ide/TcPlcOpen.cs        (72)       DELETED  - the PLCopen export/import over a temp file
Ide/TcPouReader.cs      (44)       DELETED  - language sniffed out of the archive by hand
Ide/TcItemArchive.cs   (216)       RETARGETED - keeps the .TcPOU document handling, drops PLCopen
Ide/TcObjectModel*.cs              KEPT
Content/TcContentReader.cs         NEW  - DocumentXml -> ItemContent
Content/TcContentWriter.cs         NEW  - ItemContent -> DocumentXml (whole-document set)
Network/TcArchive.cs               NEW  - the <XmlArchive> object-graph codec (TypeList / <o> / <v>)
Network/TcNetworkReader.cs         NEW  - archive -> NetworkBody
Network/TcNetworkWriter.cs         NEW  - NetworkBody -> archive
DIALECT.md                         NEW  - the TwinCAT half
```

`TcArchive` is the one genuinely new piece of decoding work in the whole change: a typed object graph serialized
as `<o>`/`<v>` against a `TypeList`. It is **not** a schema parser — it reconstructs the same objects CODESYS
hands over live, which is why both `*NetworkReader`s produce the identical `NetworkBody` and why the wire stays
byte-identical (gate 6.3).

## Symmetry as a review tool

Both packages end up with the same four folders — `Driver/`, `Ide/`, `Content/`, `Network/` — and the same file
roles. A reviewer can ask *"where is TwinCAT's `Network/*Writer`?"* and get an answer. That symmetry is a
CONSEQUENCE of both vendors exposing one model, not a template imposed on them: the asymmetry that remains
(`TcArchive` exists, CODESYS needs no counterpart) is exactly the measured difference — one serializes, one does
not.

---

## Tests

### Deleted with the transport (2,393 lines)

`PouReaderTests` (274) `PouSpliceTests` (611) `PlcOpenWriterTests` (250) `PouDocumentTests` (183)
`ProjectStructureTests` (192) `PlcOpenTcFixtureTests` (146) `TestPlcOpen` (73) `NetworkSpliceTests` (134)
`BodyCodecTests` (163) `BodySpliceGuardTests` (367).

**No compatibility shim to keep them alive** (§5b.6). A test for a deleted transport is not coverage.

### Kept, and they are the safety net

The network-text suites (1,084 lines: `NetworkText*`, `Fbd*`, `Ladder*`) assert the FORMAT, which is not
changing. They are retargeted at the constructor level only. **If a network-text test needs its EXPECTATIONS
edited, that is a signal the format changed and the change is wrong** — the repo's rule that a test may only
change when its premise is wrong on grounds independent of code behaviour.

### New

| test | what it pins |
|---|---|
| `Codesys/NetworkAdapterTests` | typed objects -> `NetworkBody`, against recorded CODESYS fixtures |
| `Twincat/ArchiveCodecTests` | `<XmlArchive>` -> objects -> archive, byte-identical |
| `Twincat/NetworkAdapterTests` | archive -> `NetworkBody` |
| `ParityTests` | **the same fixture POU yields an EQUAL `NetworkBody` on both vendors** — the wire invariant, testable offline for the first time |
| `NwlVersionGuardTests` | a missing `NWLObject` member throws naming the observed version |

`ParityTests` is new capability, not a port: today parity is only checkable by running two live IDEs.

### Fixtures

Per vendor, newly recorded (§5b.6): `fixtures/codesys-nwl/`, `fixtures/tc-nwl/`. The existing
`fixtures/roundtrip/*.plcopen.xml` are **deleted with their tests**; `fixtures/tc-fbd/*.plcopen.xml` likewise.
Recording is a probe run against a live IDE, the same shape as `scripts/probe-nwl-objectmodel.py`.

---

## Budget (§5b.7 — line count must go DOWN)

| | deleted | added |
|---|---|---|
| `Volt.Engine/PlcOpen/` | 3,187 | — |
| `GraphModel.cs` | 90 | `NetworkModel.cs` ~120 |
| CODESYS `PlcOpen.cs` + `Code.cs` | 289 | `Content/*` + `Network/*` ~600 |
| TwinCAT `TcPlcOpen` + `TcPouReader` + `Code.cs` | 239 | `Content/*` + `Network/*` + `TcArchive` ~800 |
| engine neutral halves returning | — | ~200 |
| tests | 2,393 | ~900 |
| **total** | **~6,200** | **~2,600** |

Net **≈ −3,600**. If the real number comes out positive, §5b.7 says the close-out records that the claim was
wrong rather than quietly restating the goal.

## Sequence

1. `NetworkModel.cs` + retarget `NetworkTextReader`/`Writer`. **Green on the existing network-text suites with
   PLCopen still in place** — the model change is provable before any transport moves.
2. `ICodeStore` -> `ItemContent`; both drivers implement it over their CURRENT transports. Still green.
3. CODESYS `Network/` + `Content/`, gated on §1b.10 (node construction). Delete `CodesysObjectModel.PlcOpen.cs`.
4. TwinCAT `TcArchive` + `Network/` + `Content/`. Delete `TcPlcOpen`, `TcPouReader`.
5. Delete `Volt.Engine/PlcOpen/`, split `DIALECT.md`, add the `bun run check` guard.

Step 1 is the load-bearing one: it de-risks the whole change by proving the new model carries every body the
corpus has, while the old transport is still there to fall back on. **Nothing is deleted until its replacement
is green.**
