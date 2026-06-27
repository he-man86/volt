# Volt.Bridge architecture

A bridge exposes one live PLC IDE (CODESYS or TwinCAT/Beckhoff) to the Volt CLI over a small
HTTP wire. There are three projects:

```
Volt.Bridge.Core        netstandard2.0   shared logic — no vendor references
Volt.Bridge.Codesys     net48 (library)  CODESYS bridge   — loaded in-process by the IDE
Volt.Bridge.Beckhoff    net8 (exe)       TwinCAT bridge   — standalone, attaches over COM
```

The golden rule: **everything that can be shared lives in Core; only irreducible vendor glue
lives in a bridge.** The parity boundary is the HTTP wire, not the driver — so the two bridges
serve byte-identical responses for the same project even though they reach their IDEs in totally
different ways.

---

## Core — the shared engine

Core is a strict stack: each layer depends only on the ones above it. Read it top-down — the
contract first, the leaves last.

```
Ide/        the contract        ◄── vendor bridges implement this, and only this
  │
Wire/       HTTP transport      ── serves the contract over HttpListener + JSON
  │
Sync/       endpoint services   ── fetch / push / build / refs / raw
  │
Workspace/  source materialize  ── item  ⇄  canonical .st text
Graphical/  graphical materialize ─ PlcOpen XML  ⇄  VG text
```

| Folder | Responsibility | Key files |
|---|---|---|
| **`Ide/`** | **The contract.** The single seam a vendor bridge implements: `IIdeDriver` = `IIdeSession` (connect / health / build) + `IProjectTree` (walk + CRUD) + `ICodeStore` (read/write textual ST and graphical PlcOpen XML). `DriverBase` gives the shared degraded-state machine; `ItemRef` is the opaque per-vendor item handle that hides native objects from Core. | `IIdeDriver`, `IIdeSession`, `IProjectTree`, `ICodeStore`, `IInstanceProvider`, `DriverBase`, `ItemRef`, `ProjectItem` |
| **`Wire/`** | **HTTP transport.** `BridgeHttpServer` wires the standard endpoints to the Sync services, marshals every project-touching call onto the IDE's required thread, and is the single error boundary (throws → HTTP). The rest are pure JSON DTOs. Identical for both bridges. | `BridgeHttpServer`, `HealthResponse`, `RefsFetch`, `PushModels`, `BuildModels` |
| **`Sync/`** | **Endpoint services.** One class per endpoint: `Fetch` / `Push` / `Build` / `Refs` / `Raw`. `Hasher` + `Versioning` give one content-version per item so the same project hashes identically on either vendor. | `FetchService`, `PushService`, `BuildService`, `RefsService`, `RawService`, `Hasher`, `Versioning` |
| **`Workspace/`** | **Source materialization.** `Materializer` turns a project item into canonical workspace text; `SourceText/` splits/assembles `.st` (`StSplitter` ⇄ `StAssembler`, sharing `CodeHelper`). `ItemKind` is the vendor-neutral item-type table. | `Materializer`, `ItemKind`, `WorkspaceItem`, `SourceText/StSplitter`, `SourceText/StAssembler`, `SourceText/CodeHelper` |
| **`Graphical/`** | **Graphical materialization.** PlcOpen XML ⇄ `GraphModel` ⇄ VG text. `GraphicalCode` is the gate (FBD/LD → editable VG; CFC/SFC → read-only). `PlcOpenReader/Writer` and `Vg/VgParser`/`Vg/VgWriter` are the two ends; `FbdOperators` is the shared operator table. | `GraphicalCode`, `VgBody`, `GraphModel`, `FbdOperators`, `PlcOpenDocument`, `PlcOpenReader`, `PlcOpenWriter`, `Vg/VgParser`, `Vg/VgWriter` |

Top-level `BridgeException` (the error type the wire boundary catches) and `Polyfills`
(`init`-setter shim for netstandard2.0) are leaf utilities used everywhere.

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `/refs` `items`/`kinds`/`folders`, `/fetch`
`knownItems`, every push op, `structureVersion` (hash of sorted *names*), and the workspace's
"one item per file" layout. This is deliberate and load-bearing across the bridge, `volt-git`
(the git-native CLI) and `volt-vscode`.

Consequence: two items with the **same name** collapse in the version map (last-write-wins). This
is a non-issue for **source** items (POUs/DUTs/GVLs/interfaces) — IEC guarantees their names are
unique within a PLC project. It *can* happen for **opaque non-source** items (e.g. CODESYS surfaces
one `Library Manager` per device/application), which the AI never edits. Keying by `folder+name`
would fix it but is a breaking redesign of the core identity across all three packages — not worth
it for opaque-metadata-only collisions, so the bare-name key stands. **Do not add a "duplicate name"
guard that throws** — a real project legitimately repeats these names, and throwing breaks `/refs`.

---

## A bridge — three parts

Both bridges have the **same shape**, so the role pairs line up at a glance:

```
Host.cs / Program.cs   entrypoint   — boots the shared BridgeHttpServer
Driver/                contract     — implements Core's IIdeDriver (split by facet)
Ide/                   vendor glue  — the low-level layer that talks to the live IDE
```

- **Entrypoint** (root) is the one file you open first.
- **`Driver/`** is *what is built on top of Core* — the `IIdeDriver` implementation, split into
  the session file + `.Tree` (IProjectTree) + `.Code` (ICodeStore) partials.
- **`Ide/`** is the vendor-specific helpers the Driver sits on. Note the deliberate naming:
  **Core/`Ide` is the contract; a bridge's `Ide` is the live-IDE access behind that contract;
  the bridge's `Driver` is the bridge between them.**

### Role-pair table

Both bridges share one shape: the `Driver/` facets are **thin facades** that hold no vendor
state — they delegate every genuine IDE touch to a single access **gateway** and every cross-thread
call to a **dispatcher**, both in `Ide/`. The facade/gateway/dispatcher names line up across vendors:

| Role | CODESYS | Beckhoff | Notes |
|---|---|---|---|
| Entrypoint | `Host.cs` | `Program.cs` | CODESYS: `Host.Start()` called in-proc by the IDE's IronPython script command. Beckhoff: standalone exe; spawns its STA thread, starts degraded and attaches when TwinCAT appears. |
| Driver — session | `Driver/CodesysDriver.cs` | `Driver/BeckhoffDriver.cs` | facade: connect / health / build, all delegating to the gateway. |
| Driver — tree | `Driver/CodesysDriver.Tree.cs` | `Driver/BeckhoffDriver.Tree.cs` | the walk/lookup/CRUD *algorithm* over gateway primitives. CODESYS classifies by object-model interface names; Beckhoff by native `ItemType`. |
| Driver — code | `Driver/CodesysDriver.Code.cs` | `Driver/BeckhoffDriver.Code.cs` | transport orchestration (restore-on-failed-import) over gateway primitives; textual + PlcOpen XML. |
| Access gateway | `Ide/CodesysObjectModel.cs` (+ `CodesysTypeMap.cs`, `Reflection.cs`) | `Ide/TcObjectModel.cs` (+ `RotInstances.cs`, `TcPlcOpen.cs`, `TcPouReader.cs`) | holds ALL vendor state + the only `reflection`/`dynamic` in the bridge. CODESYS: reflection-only object model (no compile-time refs → loads in any 3.5.x). Beckhoff: late-bound `dynamic` COM, ROT instance discovery, file-based PlcOpen round-trip. |
| Thread dispatcher | `Ide/CodesysDispatcher.cs` | `Ide/StaDispatcher.cs` (+ `ComMessageFilter.cs`) | scripting/COM objects are thread-affine; the wire runs on background threads. CODESYS delegates to the IDE's `InvokeInPrimaryThread`; Beckhoff owns + pumps its STA thread via a `BlockingCollection`. |
| Health probe | `DriverBase.RunProbeOnce` (Core) | `DriverBase.RunProbeOnce` (Core) | the single-flight guard + background run is shared; only the probe *body* (CODESYS: name/dirty; Beckhoff: re-attach + liveness) differs. |

### Load-bearing asymmetries (not drift — don't "unify" these)

- **Hosting.** CODESYS = net48 library loaded *in-process* by reflection; Beckhoff = net8 exe
  *attaching* to a separate XAE over COM. This dictates the whole `Ide/` layer of each.
- **PlcOpen transport.** CODESYS round-trips XML *in memory* via the object model; Beckhoff's
  COM API is file-based, so `TcPlcOpen` round-trips through a temp file.
- **`TcPouReader` has no CODESYS counterpart.** TwinCAT stores graphical bodies in a vendor
  NWL archive whose language must be parsed out locally; CODESYS gets the same answer from
  shared `Core.Graphical`. The parser is irreducibly TwinCAT-specific, so it stays in Beckhoff.
- **Beckhoff's tree walk keeps per-node `try/catch`** (skip a child that faults mid-walk) where
  CODESYS's doesn't — cross-process COM throws far more readily than the in-proc object model.
  That defensive catching is part of the walk algorithm; don't strip it for symmetry.

Ports: CODESYS `8556`, Beckhoff `8555` (both overridable via `VOLT_BRIDGE_PORT`).
