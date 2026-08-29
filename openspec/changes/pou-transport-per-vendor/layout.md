# The layout — measured, then planned

## Is the package count over-engineered? No. Measured.

| package | TFM | out | files | lines | can it merge? |
|---|---|---|---|---|---|
| `Volt.Contracts` | netstandard2.0 | lib | 16 | 715 | no — the DTOs, referenced by everything including the connector |
| `Volt.Wire` | netstandard2.0 | lib | 6 | 390 | no — the connector uses it WITHOUT the engine |
| `Volt.Engine` | netstandard2.0 | lib | 61 | **8,309** | no — but its CONTENTS are the problem, see below |
| `Volt.Engine.Host` | netstandard2.0 | lib | 2 | 185 | **no, and this one looks wrong until you check** |
| `Volt.Ide.Codesys` | **net48** | lib | 13 | 1,939 | no — CODESYS's plugin host is .NET Framework |
| `Volt.Ide.Twincat` | net8.0-windows | **Exe** | 13 | 1,930 | no — separate process |
| `Volt.Cli` | net8.0 | **Exe** | 16 | 2,404 | no |
| `Volt.Connector.Core` | net8.0 | lib | 13 | 1,393 | no — the test seam; `Connector.Tests` references it |
| `Volt.Connector` | net8.0-windows | **WinExe** | 10 | 1,722 | no |

**Four are forced by target framework or output type.** The netstandard2.0 core exists *because* net48 must
consume it — CODESYS's plugin host is .NET Framework, and that is not negotiable.

**`Volt.Engine.Host` is 185 lines and is the one that looks like waste.** It is not. It is `BridgePipeHost`: maps
each op to its Sync service, marshals every project-touching call onto the driver's single IDE thread, streams
progress, and is *the single error boundary*. It is the ONLY component that knows both the engine and the wire —
which is why `Volt.Engine` has **zero** references to `Volt.Wire`. 185 lines buying that separation is a good
trade; merging it would make the engine know about pipes, or the wire know about the engine.

**Verdict: merge nothing. The package graph is not the problem.**

---

## What IS over-engineered: the inside of `Volt.Engine`

61 files, 8,309 lines, and roughly a quarter of it is **one vendor's serialization** sitting in the package whose
whole claim is vendor-neutrality.

The split is objective — count `XElement`/`XDocument`/`XNamespace` references:

| file | lines | XML refs | verdict |
|---|---|---|---|
| `NetworkTextReader.cs` | 580 | **0** | Volt's own format |
| `NetworkTextWriter.cs` | 324 | **0** | Volt's own format |
| `GraphModel.cs` | 90 | **0** | Volt's neutral graph |
| `NetworkText.cs`, `FbdOperators.cs`, `GraphRoundTrip.cs` | 92 | **0** | Volt's |
| `GraphWriter.cs` | 507 | **57** | **PLCopen** |
| `GraphReader.cs` | 385 | **27** | **PLCopen** |
| `Source/*.cs` (`PouReader`, `PouSplice`, `PlcOpenDocument`, `Declaration`, `Namespaces`, `ProjectStructure`, `PouDocument`) | 1,203 | heavy | **PLCopen** |

≈ **2,100 lines of PLCopen inside the vendor-neutral package.** That is the design error, stated in numbers.

Two smaller misfilings fall out of the same look:

- **`ItemContent.cs` lives in `Source/`**, next to `PouReader` and `PouSplice`. It is the neutral CONTRACT type —
  the thing the whole refactor makes drivers speak. It belongs in `Item/`.
- **`Source/Body/Network/` is three levels deep** for what is one concept.

---

## Target layout

Revised after the NWL measurement (`nwl-object-model.md`). The earlier draft of this section sent PLCopen
**into the CODESYS package**. That is now wrong: CODESYS reads and writes graphical bodies as typed
`NWLObject` objects with no serialization at all, so PLCopen does not get a new home — **it loses its last
consumer and is deleted.** A folder that is on its way out should not be moved into a package that will then
have to delete it.

```
Volt.Engine/                 VENDOR- AND FORMAT-NEUTRAL. Knows no vendor's serialization.
  Ide/         ICodeStore (ItemContent in / out), IProjectTree, TreeNav, ItemLookup
  Item/        ItemKind, ItemRef, ItemContent          <- ItemContent moves here
  Library/     library signatures
  Format/      VOLT'S OWN FORMATS ONLY                 <- was Source/, renamed for intent
    St/          the canonical .fb layout (StReader, StWriter, CodeHelper, Descriptor)
    Network/     network text + GraphModel             <- was Source/Body/Network, flattened
    Body/        BodyMarker, Languages, BodyFormatGuard (language dispatch, no XML)
  Sync/        Materializer, PushService, FetchService, Versioning

  PlcOpen/     A VENDOR FORMAT, ON ITS WAY OUT        <- was scattered through Source/
               PlcOpenDocument, PouReader, PouSplice, PouDocument, Declaration, Namespaces,
               ProjectStructure, GraphReader, GraphWriter, BodyCodec, BodyElement, BodyGuard,
               BodySpliceGuard, InstanceTypes, NetworkCode, NetworkSplice, DIALECT.md

Volt.Ide.Codesys/
  Ide/ Driver/      as today, plus:
  Nwl/              the typed object-model adapter: NWLImplementationObject <-> GraphModel

Volt.Ide.Twincat/
  Nwl/              the same model, read from the .TcPOU <NWL> XmlArchive
```

`Source/` -> `Format/` is a rename that carries the rule: **this folder holds formats VOLT defined.** A vendor's
format never appears in it. "Source" was ambiguous — it read as "source code" and quietly accommodated PLCopen.

### Why `PlcOpen/` is a separate top-level folder and not deleted in this step

It still has two consumers (both drivers, and five lines of `Sync/`). Gathering it into one folder is what makes
the removal a **deletion of a directory** later rather than an archaeology exercise, and it buys the invariant
immediately:

> **`Volt.Engine/Format/` contains zero references to `XElement`, `XDocument`, `XNamespace` or `XAttribute`.**

That is checkable today, on the very first commit of the refactor, which is the point of doing the folder work
before the contract work rather than after.

Placement is **measured, not judged** — every file was counted:

| goes to `Format/` | vendor-XML refs | goes to `PlcOpen/` | vendor-XML refs |
|---|---|---|---|
| `NetworkTextReader` | 0 | `GraphWriter` | 82 |
| `NetworkTextWriter` | 0 | `PouSplice` | 28 |
| `StReader` | 0 | `GraphReader` | 27 |
| `GraphModel` | 0 | `BodyCodec` | 16 |
| `NetworkText`, `FbdOperators` | 0 | `ProjectStructure`, `PouReader`, `Declaration` | 13 / 10 / 9 |
| `StWriter`, `CodeHelper`, `Descriptor` | 0 | `PlcOpenDocument` | 7 |
| `BodyMarker`, `Languages` | 0 | `BodySpliceGuard`, `NetworkSplice`, `BodyElement` | 4 / 4 / 2 |
| — | | `GraphRoundTrip`, `BodyFormatGuard` | **0**, see below |

### Two files the XML count placed WRONG, and what that says about the method

`GraphRoundTrip` and `BodyFormatGuard` both score **zero** vendor-XML references and both belong in `PlcOpen/`.
The count missed them because they do not touch XML *themselves* — they delegate:

- `GraphRoundTrip` is, in its own words, "the body's journey through the **PLCopen** transport":
  `GraphReader.ReadBody(GraphWriter.WriteBody(graph))`. Zero `XElement`, entirely PLCopen.
- `BodyFormatGuard.RequireChildFormatWritable` takes a `PouReader.ParsedPou` and dispatches through `BodyCodec`.

Both were caught by the compiler within minutes, because putting them in `Format/` is what forced
`using Volt.Engine.PlcOpen;` into that folder — and a `Format/` file needing PLCopen is the invariant failing out
loud. **The lesson is worth keeping: a token count measures what a file MENTIONS, and a layout rule is about what
a file DEPENDS ON.** The count is a good first pass and a bad adjudicator; the build is the adjudicator.

The invariant that came out of it is stronger than the one planned:

> **`Volt.Engine/Format/` contains zero vendor-XML references AND does not reference `Volt.Engine.PlcOpen` at
> all.** Five of the six `using Volt.Engine.PlcOpen;` lines that the mechanical rename put into `Format/` were
> simply unused and were deleted; the sixth was `BodyFormatGuard`, which moved.

`ItemContent.cs` moves to `Item/`: its single `XElement` mention is **in a comment**, and it is the neutral
CONTRACT type the whole refactor makes drivers speak. `Source/DIALECT.md` moves to `PlcOpen/DIALECT.md` —
which is the path `CLAUDE.md` has been claiming all along, so this also closes a doc-vs-reality drift.

## Files that SPLIT rather than move — the real work, and it is §2's, not this step's

These carry a neutral half and a PLCopen half. They go to `PlcOpen/` **whole**, because that is where their
compiled dependency is today; §2 pulls the neutral half back out:

| file | the neutral half that comes back | the half that dies with PLCopen |
|---|---|---|
| `InstanceTypes` | `Of(declaration)` — a text parse | `FromBody(XElement)` |
| `NetworkCode` | the orchestration | one XML touch |
| `NetworkSplice` | the CARRY RULE | it manipulates stored PLCopen elements |
| `BodyCodec` | dispatch by language | it calls `PouSplice` / `GraphWriter` directly |
| `BodySpliceGuard` | the refusal POLICY | the element inspection |
| `BodyGuard` | the write decision | its `XElement body` parameter |

Under the new contract most of this resolves itself: the driver owns document -> `ItemContent`, so the XML halves
go with the driver and the engine keeps the policy. **Do not split them during the folder move** — a move that
also changes behaviour is not reviewable as a move.

## Order

Revised, because the NWL finding changes which step unblocks which.

1. **The folder move (this step).** Pure relocation + namespace rename, no behaviour change. Buys the
   `Format/` = zero-vendor-XML invariant and puts every doomed file in one directory.
2. **§2 — the contract.** `ICodeStore` speaks `ItemContent`. Both drivers still call `PlcOpen/`; the engine
   stops. Sync's coupling is **five lines** (`Materializer` 2, `PushService` 3), measured — this is a smaller
   step than it reads.
3. **§4a — the CODESYS NWL adapter**, gated on the node-construction experiment (`tasks.md` §1.8). CODESYS stops
   calling PLCopen.
4. **§4b — the TwinCAT NWL archive adapter.** TwinCAT stops calling PLCopen.
5. **Delete `PlcOpen/`.** It has no consumers left. `bun run check` gains the guard so it cannot return.

Steps 3 and 4 are independent of each other and both depend on 2. The old ordering put the folder move last,
which meant carrying the design error through every intermediate commit for no benefit; it is the one step that
is safe to do first precisely *because* it changes no behaviour.

---

# Vendor independence — the property this must guarantee

**Requirement: changing one vendor's transport must be a change to THAT vendor's package and nothing else.** If
PLCopen turns out to be wrong for CODESYS in a year, that must be a CODESYS-package change — not a refactor.

## The rule that delivers it

Dependencies point **one way only**:

```
Volt.Engine   ──referenced by──▶   Volt.Ide.Codesys
      ▲                            Volt.Ide.Twincat
      └── never references either, and never references any vendor's format
```

A driver implements `ICodeStore` / `IProjectTree` and answers in Volt's own types. The engine never learns which
transport produced the answer, so it cannot depend on one. **That is the whole mechanism** — there is no vendor
switch, no strategy registry, no per-vendor branch to keep in step.

## The exact surface a driver may touch

Everything a transport swap could need is here, and nothing else:

| type | owner | why a driver needs it |
|---|---|---|
| `ItemContent` | engine | what a POU IS: kind, declaration, body, members, folders |
| `GraphModel` | engine | the neutral graphical model a graphical body maps to |
| `ItemRef`, `ItemKind` | engine | identity and classification |
| `ICodeStore`, `IProjectTree` | engine | the contract itself |

**Two of those are shared MODELS, and they are the only places a leak could occur.** Be honest about it:

- If a new transport carries **less** than these express, it simply fills fewer fields. Fully isolated — swap it
  freely.
- If it carries **more**, the model may need a field. That is an engine change — but it is a change to **Volt's
  own model**, made ONCE, not a vendor leak and not repeated per swap.

**There was a known instance of exactly this — and measuring it inverted the conclusion.** The claim here was
that TwinCAT's native document carries per-network `Title`, `Label` and `OutCommented`, `GraphModel` has nowhere
to put them, and adopting that transport therefore forces a one-time model extension as the honest cost of
vendor independence.

Measured (`nwl-object-model.md` §1): CODESYS's `INetwork` carries the **identical four**, plus `Comment`. So this
was never a TwinCAT extra and never a cost of the swap. **Both vendors' object models carry it and PLCopen was
the thing dropping it** — the field that looked like a vendor leak was Volt's model being one field short of
what both IDEs already have.

The rule survives, but the example does not illustrate it. A truer statement of the bound: an extension is
warranted when Volt's model cannot express what the IDEs agree on, and that is discovered by measuring both
vendors — not by taking the first vendor's document as the definition of "extra".

## How it is enforced, not merely intended

- [ ] **`Volt.Engine` must not name a vendor format.** No `plcopen`, no TC6 namespace, no `addData`, no `NWL`,
      no `BoxTree`. A source scan in `bun run check`, failing the build — the same shape as
      `RequiredAddDataGuardTests`, which was written after an optional vendor extension became a hard dependency
      and took out a whole IDE.
- [ ] **`Volt.Engine` must not reference either driver project.** Trivially checkable from the csproj graph, and
      it is true today — keep it true.
- [ ] **No vendor identity in engine control flow.** No `if (vendor == …)`, no `switch` on vendor, no capability
      flag consulted by the engine. If the engine has to ask *which IDE this is*, the contract is wrong.
- [ ] **The swap test, stated as a question a reviewer can answer:** *"To move CODESYS off its transport, which
      files change?"* The answer must be **only files under `Volt.Ide.Codesys/`** — unless the new transport
      carries something Volt's model cannot yet express, which is the bounded exception above and must be called
      out explicitly rather than absorbed.

## What this deliberately does NOT do

It does not create a shared format package. PLCopen currently sits in the engine *because* two vendors happened
to use it — which is precisely how it became a neutral-layer dependency. Once both vendors are on their own
object-model adapters, PLCopen has **no** consumer and is deleted rather than rehoused.

**The evidence test named here has now actually fired, and the answer is still no.** Both vendors do share
something real — the 3S NWL object model, same assembly, same `IFlags`, same `INetwork`. That is exactly the
"two vendors genuinely share" condition. It still does not justify a shared format package, for a reason worth
stating precisely: what they share is a **MODEL**, and Volt already has a home for a shared model — `GraphModel`
in the engine. Only one of them shares a **SERIALIZATION** of it (TwinCAT's `<NWL>` archive); CODESYS hands over
live objects and serializes nothing. A package holding a format that one vendor never encodes would be a shared
package built for one consumer.
