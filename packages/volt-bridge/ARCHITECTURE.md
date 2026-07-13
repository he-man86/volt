# Volt.Bridge — implementation architecture

A **bridge** exposes one live PLC IDE (CODESYS or TwinCAT) to the `volt` CLI over a small localhost HTTP wire.
Both vendors serve **byte-identical responses** for the same project even though they reach their IDEs in
completely different ways — because everything shareable lives in one Core and the parity boundary is the HTTP
wire, not the driver.

## Three projects

```
src/Volt.Bridge.Core        netstandard2.0   shared engine — no vendor references
src/Volt.Bridge.Codesys     net48 library    CODESYS bridge  — loaded IN-PROCESS by the IDE (reflection)
src/Volt.Bridge.Beckhoff    net8 exe         TwinCAT bridge  — STANDALONE, attaches to XAE over COM
src/Volt.Bridge.Connector   net8 exe         tray supervisor — spawns/watches the bridges (not a bridge itself)
```

**The golden rule:** everything that can be shared lives in `Core`; only irreducible vendor glue lives in a
bridge. `Core` targets `netstandard2.0` specifically so it loads inside the net48 in-proc CODESYS host *and* the
net8 standalone Beckhoff exe unchanged.

## How a request flows

Every endpoint is the same shape — `Wire/BridgeHttpServer` receives, `Sync/*` services do the work over the
`Ide/IIdeDriver` contract, `Workspace`/`Graphical` turn IDE items into canonical text:

```
volt CLI ──HTTP──▶ BridgeHttpServer (Wire/)
                     │  routes path+method; rejects any browser Origin; single error boundary (throws → HTTP)
                     ▼
                   RunOp ── marshals onto the IDE's required thread; threads an onP() progress callback
                     ▼
                   Fetch / Push / Build / Refs  (Sync/)      ── the endpoint logic
                     │
        Workspace/ (ST text) + Graphical/ (VG text)          ── item ⇄ canonical workspace text
                     │
                   IIdeDriver  (Ide/ contract)               ── the ONE seam a vendor implements
                     ▼
        CodesysDriver / BeckhoffDriver  →  live IDE
```

Endpoints (see `openapi.yaml`, served live at `GET /openapi.yaml` + `/swagger`):
`GET /health`, `GET /refs`, `POST /fetch`, `POST /push`, `POST /build`, `POST /init`, plus `POST /shutdown` and
`GET /debug`. There is **no** `/events`/SSE and no `/wait-change` — change-detection is client-polled.

## Core — the shared engine (`src/Volt.Bridge.Core`)

A strict layer stack; each layer depends only on the ones above it. Read top-down: contract first, leaves last.

| Layer | Does | Key types |
|---|---|---|
| **`Ide/`** | **The contract** a vendor bridge implements — and *only* this. `IIdeDriver` = `IIdeSession` (connect/health/build) + `IProjectTree` (walk + CRUD) + `ICodeStore` (read/write textual ST and graphical PlcOpen XML). `DriverBase` provides the shared degraded-state machine + single-flight health probe. `ItemRef` is the opaque per-vendor handle that keeps native objects out of Core; `ProjectItem` carries name/folder/`ExcludeFromBuild`. | `IIdeDriver`, `IIdeSession`, `IProjectTree`, `ICodeStore`, `DriverBase`, `ItemRef`, `ProjectItem` |
| **`Wire/`** | **HTTP transport.** `BridgeHttpServer` (an `HttpListener` loop) maps each endpoint to its Sync service, marshals every project-touching call onto the IDE's required thread, streams progress, is the single error boundary, and rejects cross-origin requests. Everything else here is plain JSON DTOs. Identical on both bridges. | `BridgeHttpServer`, `RefsFetch`, `PushModels`, `BuildModels`, `HealthResponse` |
| **`Sync/`** | **One service per endpoint** — `FetchService` (`/fetch` + `/init`), `PushService`, `BuildService`, `RefsService`, `DebugService` (`/debug`; also folds in the retired `/raw`). `Hasher` + `Versioning` give each item one content version so the same project hashes identically on either vendor. | `FetchService`, `PushService`, `BuildService`, `RefsService`, `DebugService`, `Hasher`, `Versioning` |
| **`Workspace/`** | **Source materialization** — `Materializer` turns a project item into canonical workspace text; `SourceText/` splits/assembles ST (`StSplitter` ⇄ `StAssembler`, sharing `CodeHelper`). `ItemKind` is the vendor-neutral item-type table (see `ITEM_KINDS.md`). | `Materializer`, `ItemKind`, `SourceText/StSplitter`, `SourceText/StAssembler` |
| **`Graphical/`** | **Graphical materialization** — PlcOpen XML ⇄ `GraphModel` ⇄ VG text (see `docs/vg-language.md`). `GraphicalCode` is the gate: FBD/LD → editable VG; CFC/SFC → read-only. `PlcOpenReader`/`Writer` and `Vg/VgParser`/`Vg/VgWriter` are the two ends. | `GraphicalCode`, `GraphModel`, `PlcOpenReader`, `PlcOpenWriter`, `Vg/VgParser`, `Vg/VgWriter` |
| **`Library/`** | Referenced-library manifests + signatures — `LibraryManifest` (the canonical `.library` body + hash basis), `LibSignature`/`LibSignatureRenderer` (verbose-fetch signatures under the Library Manager). | `LibraryManifest`, `LibSignature`, `LibSignatureRenderer` |
| **`Diagnostics/`** | `VoltLog` — a zero-dependency durable logger (timestamped/leveled/source-tagged) to `%LOCALAPPDATA%\Volt\logs`, daily files pruned after 14 days. netstandard2.0 with no framework dep so it loads in the net48 in-proc host too. | `VoltLog` |

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `/refs` `items`/`kinds`/`folders`, `/fetch` `knownItems`, every push
op, `structureVersion` (hash of sorted *names*), and the one-item-per-file workspace layout. Load-bearing across
the bridge, `volt-git`, and `volt-vscode`. Two items with the **same name** collapse in the version map
(last-write-wins) — a non-issue for source items (IEC guarantees unique names) and only reachable for opaque
non-source items the AI never edits (e.g. one `Library Manager` per application). Keying by `folder+name` would
fix it but is a breaking redesign not worth it for opaque-metadata collisions. **Do not add a "duplicate name"
guard that throws** — real projects legitimately repeat these names, and throwing breaks `/refs`.

### Wire / materialization invariants (each cites its Core symbol)

- **Exclude-from-build is OMITTED; dead code is RETURNED.** Objects the IDE won't compile
  (`ProjectItem.ExcludeFromBuild`, folder-inherited) are dropped from `/refs`/`/fetch` entirely — no compiler
  ground truth. Everything else is ordinary source **including** dead/uncalled POUs; reachability is the LSP's
  job, not a wire field.
- **CFC/SFC are read-only; only FBD/LD round-trip as editable VG** (`Graphical/GraphicalCode`). A read-only body
  materializes empty with an `(* @volt-graphical: <LANG> *)` marker and is refused on push.
- **Execute boxes round-trip as VG `EXECUTE … END_EXECUTE`** holding their ST verbatim (`Graphical/Vg/VgParser`,
  `PlcOpenReader.ReadStCode`) — never a bare call that drops the ST.
- **Container managers are folders, never items** (`Workspace/ItemKind.IsContainerManager`) — no
  `<Manager>.<kind>` stub of their own.
- **Property accessor shape round-trips byte-identically** — GET-only / SET-only / GET+SET preserved on both
  bridges (`Graphical/PlcOpenDocument.InterfacePropertyAccessors`).
- **Referenced-library signatures materialize under the Library Manager** — one canonical `.library` manifest per
  library (`Library/LibraryManifest`); `verbose` fetch (`FetchRequest.Verbose`) adds each element's declaration-only
  signature as a read-only item, excluded from `structureVersion`. TwinCAT (out-of-process) can't extract → empty
  set (a documented parity gap).
- **Round-trips are lossless** — push→fetch returns byte-identical `sourceText`/`folder`/`name`; an **emptied body
  is cleared, not silently retained**. A vendor divergence is a parity defect.
- **Skipped/errored items are logged, never silently dropped** (`Diagnostics/VoltLog`) with `name` + reason.
- **Both HTTP planes reject any browser `Origin`** — the data plane and the connector control plane are localhost
  first-party only; a web page can't drive `/push`.

## A bridge — three parts (`Codesys` / `Beckhoff`)

Both bridges share one shape, so the roles line up. The `Driver/` facets are **thin facades** holding no vendor
state — they delegate every real IDE touch to a single **gateway** and every cross-thread call to a **dispatcher**,
both in `Ide/`.

```
Host.cs / Program.cs   entrypoint   — boots the shared BridgeHttpServer
Driver/                contract     — implements Core's IIdeDriver, split by facet (.Tree / .Code partials)
Ide/                   vendor glue  — the gateway + dispatcher that talk to the live IDE
```

Note the deliberate naming: **Core `Ide/` is the contract; a bridge's `Ide/` is the live-IDE access behind it;
the bridge's `Driver/` is the bridge between them.**

| Role | CODESYS | Beckhoff | Notes |
|---|---|---|---|
| Entrypoint | `Host.cs` | `Program.cs` | CODESYS: `Host.Start()` called in-proc by the IDE's IronPython script command. Beckhoff: standalone exe; spawns its STA thread, starts degraded, attaches when TwinCAT appears. |
| Driver — session | `Driver/CodesysDriver.cs` | `Driver/BeckhoffDriver.cs` | facade: connect / health / build. |
| Driver — tree | `Driver/CodesysDriver.Tree.cs` | `Driver/BeckhoffDriver.Tree.cs` | walk/lookup/CRUD algorithm. CODESYS classifies by object-model interface names; Beckhoff by native `ItemType`. |
| Driver — code | `Driver/CodesysDriver.Code.cs` | `Driver/BeckhoffDriver.Code.cs` | transport orchestration (restore-on-failed-import); textual + PlcOpen XML. |
| Access gateway | `Ide/CodesysObjectModel.cs` (+ `CodesysTypeMap.cs`, `Reflection.cs`) | `Ide/TcObjectModel.cs` (+ `RotInstances.cs`, `TcPlcOpen.cs`, `TcPouReader.cs`) | holds ALL vendor state + the only `reflection`/`dynamic` in the bridge. |
| Thread dispatcher | `Ide/CodesysDispatcher.cs` | `Ide/StaDispatcher.cs` (+ `ComMessageFilter.cs`) | CODESYS delegates to the IDE's `InvokeInPrimaryThread`; Beckhoff owns + pumps an STA thread via a `BlockingCollection`. |

### Load-bearing asymmetries — don't "unify" these

These are irreducible differences between how the two IDEs are reached, **not** drift to be refactored away:

- **Hosting.** CODESYS = net48 library loaded *in-process* by reflection (no compile-time refs → loads in any
  3.5.x); Beckhoff = net8 exe *attaching* to a separate XAE over COM. This dictates each `Ide/` layer.
- **PlcOpen transport.** CODESYS round-trips XML *in memory* via the object model; Beckhoff's COM API is
  file-based, so `TcPlcOpen` round-trips through a temp file.
- **`TcPouReader` has no CODESYS counterpart.** TwinCAT stores graphical bodies in a vendor NWL archive whose
  language must be parsed out locally; CODESYS gets the same answer from shared `Core.Graphical`. The parser is
  irreducibly TwinCAT-specific, so it stays in Beckhoff.
- **Beckhoff's tree walk keeps per-node `try/catch`** (skip a child that faults mid-walk) where CODESYS's doesn't
  — cross-process COM throws far more readily than the in-proc object model. That defensive catching is part of
  the walk; don't strip it for symmetry.

Ports: CODESYS **8556**, Beckhoff **8555** (both overridable via `VOLT_BRIDGE_PORT`).

## Build, run, test

See `README.md` for commands. In short: `dotnet build` per project (or `bun run build:all`); the C# unit tests
(`test/Volt.Bridge.Tests/`) and the TS e2e tests (`test/e2e/`) both run offline against a fake/headless IDE; the
headless CODESYS dev loop is `scripts/codesys-bridge.ps1`, the Beckhoff one `scripts/bridge.ps1`.

## Related docs

- `openapi.yaml` — the live wire contract (served + e2e-verified).
- `ITEM_KINDS.md` / `item-kinds.json` — the vendor-neutral item-type table.
- `docs/vg-language.md`, `docs/vg-diagnostics.md` — the VG graphical sublanguage.
- `docs/debugging-a-bridge-session.md` — debugging a live bridge.
