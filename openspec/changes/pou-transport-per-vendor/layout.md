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

---

# Vendor independence — the property this must guarantee

**Requirement: changing one vendor's transport must be a change to THAT vendor's package and nothing else.** If
PLCopen turns out to be wrong for CODESYS in a year, that must be a CODESYS-package change — not a refactor.

## The rule that delivers it

Dependencies point **one way only**:

```
Volt.Engine   ──referenced by──▶   Volt.Cli.Ide.Codesys
      ▲                            Volt.Cli.Ide.Twincat
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

**There is a known instance of exactly this, already:** TwinCAT's native document carries per-network `Title`,
`Label` and `OutCommented`. `GraphModel` has nowhere to put them, because PLCopen never carried them. So adopting
that transport forces a one-time model extension (`tasks.md` §4.3). That is the honest cost of the property, and
it is bounded: it happens when Volt's model gains a capability, not when a vendor changes how it serializes.

## How it is enforced, not merely intended

- [ ] **`Volt.Engine` must not name a vendor format.** No `plcopen`, no TC6 namespace, no `addData`, no `NWL`,
      no `BoxTree`. A source scan in `bun run check`, failing the build — the same shape as
      `RequiredAddDataGuardTests`, which was written after an optional vendor extension became a hard dependency
      and took out a whole IDE.
- [ ] **`Volt.Engine` must not reference either driver project.** Trivially checkable from the csproj graph, and
      it is true today — keep it true.
- [ ] **No vendor identity in engine control flow.** No `if (vendor == …)`, no `switch` on vendor, no capability
      flag consulted by the engine. If the engine has to ask *which IDE this is*, the contract is wrong.
- [ ] **The swap test, stated as a question a reviewer can answer:** *"To move CODESYS off PLCopen, which files
      change?"* The answer must be **only files under `Volt.Cli.Ide.Codesys/`** — unless the new transport
      carries something Volt's model cannot yet express, which is the bounded exception above and must be called
      out explicitly rather than absorbed.

## What this deliberately does NOT do

It does not create a shared format package. PLCopen currently sits in the engine *because* two vendors happened
to use it — which is precisely how it became a neutral-layer dependency. Once TwinCAT is native, PLCopen has one
consumer and belongs in that consumer. **If two vendors ever genuinely share a format, a shared package becomes
justified at that point** — on evidence, not in anticipation.
