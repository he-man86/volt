# The layout — measured, then planned

## Is the package count over-engineered? No. Measured.

| package | TFM | out | files | lines | can it merge? |
|---|---|---|---|---|---|
| `Volt.Contracts` | netstandard2.0 | lib | 16 | 715 | no — the DTOs, referenced by everything including the connector |
| `Volt.Wire` | netstandard2.0 | lib | 6 | 390 | no — the connector uses it WITHOUT the engine |
| `Volt.Engine` | netstandard2.0 | lib | 61 | **8,309** | no — but its CONTENTS are the problem, see below |
| `Volt.Engine.Host` | netstandard2.0 | lib | 2 | 185 | **no, and this one looks wrong until you check** |
| `Volt.Cli.Ide.Codesys` | **net48** | lib | 13 | 1,939 | no — CODESYS's plugin host is .NET Framework |
| `Volt.Cli.Ide.Twincat` | net8.0-windows | **Exe** | 13 | 1,930 | no — separate process |
| `Volt.Cli` | net8.0 | **Exe** | 16 | 2,404 | no |
| `Volt.Cli.Connector.Core` | net8.0 | lib | 13 | 1,393 | no — the test seam; `Connector.Tests` references it |
| `Volt.Cli.Connector` | net8.0-windows | **WinExe** | 10 | 1,722 | no |

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

```
Volt.Engine/                 VENDOR- AND FORMAT-NEUTRAL. Knows no vendor's serialization.
  Ide/         ICodeStore (ItemContent in / out), IProjectTree, TreeNav, ItemLookup
  Item/        ItemKind, ItemRef, ItemContent          <- ItemContent moves here
  Library/     library signatures
  Format/      VOLT'S OWN formats only                 <- was Source/, renamed for intent
    St/          the canonical .fb layout (StReader, StWriter)
    Network/     network text + GraphModel             <- was Source/Body/Network, flattened
    Body/        BodyMarker, Languages, BodyElement    (language dispatch, no XML)
  Sync/        Materializer, PushService, FetchService, Versioning

Volt.Cli.Ide.Codesys/
  Format/PlcOpen/   PlcOpenDocument, PouReader, PouSplice, PouDocument, Declaration,
                    Namespaces, ProjectStructure, GraphReader, GraphWriter,
                    DIALECT-codesys.md
  Ide/ Driver/      as today

Volt.Cli.Ide.Twincat/
  Format/Native/    TcDocument reader/writer, BoxTree <-> GraphModel, DIALECT-twincat.md
  Ide/ Driver/      as today
```

`Source/` → `Format/` is a rename that carries the rule: **this folder holds formats VOLT defined.** A vendor's
format never appears in it. "Source" was ambiguous — it read as "source code" and quietly accommodated PLCopen.

## Files that SPLIT rather than move — the real work

These are not clean relocations, and pretending otherwise would under-estimate the change:

| file | why it splits |
|---|---|
| `InstanceTypes.cs` | `FromBody(XElement)` is PLCopen; `Of(declaration)` is a neutral text parse |
| `NetworkCode.cs` | orchestration is neutral; one XML touch is not |
| `NetworkSplice.cs` | the CARRY RULE is neutral, but it manipulates stored PLCopen elements |
| `BodyCodec.cs` | dispatch by language is neutral; it calls `PouSplice` and `GraphWriter` directly |
| `BodySpliceGuard.cs` | the refusal POLICY is neutral; the element inspection is PLCopen |

Under the new contract most of this resolves itself: the driver owns document→`ItemContent`, so the XML halves go
with it and the engine keeps the policy. But each one needs deciding, not moving.

## Order

1. **§2 — the contract.** `ICodeStore` speaks `ItemContent`. Both drivers still call the PLCopen code; the engine
   stops calling it. Nothing moves yet, so the diff is reviewable.
2. **§4 — the TwinCAT native converter.** TwinCAT stops calling PLCopen.
3. **§3 — relocate.** PLCopen into the CODESYS package; `ItemContent` into `Item/`; `Source/` → `Format/`;
   flatten `Body/Network`. Pure moves, because the couplings were cut in 1 and 2.
4. **The guard.** `bun run check` fails if `Volt.Engine` gains an `XElement`-over-vendor-XML dependency again.

Doing 3 first would break TwinCAT, which still needs PLCopen. Doing 1 last would mean moving code that still has
engine callers.
