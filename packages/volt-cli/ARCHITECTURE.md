# Volt.Cli — implementation architecture

A **bridge** exposes one live PLC IDE (CODESYS or TwinCAT) to the `volt` CLI over a local **named pipe**.
Both vendors serve **byte-identical responses** for the same project even though they reach their IDEs in
completely different ways — because everything shareable lives in one Core and the parity boundary is the pipe
wire, not the driver.

## The projects (bridge side)

```
src/Volt.Cli.Transport   netstandard2.0   the pipe wire (PipeServer/Client/frames) — decouples the tray from
                                          the engine + vendor code
src/Volt.Engine        netstandard2.0   shared engine (no vendor refs) + Wire/BridgePipeHost (serves it)
src/Volt.Cli.Ide.Codesys     net48 library    CODESYS bridge — driver + PipeHost, loaded IN-PROCESS by the IDE
src/Volt.Cli.Ide.Twincat    net8 exe         TwinCAT bridge — driver + worker, STANDALONE, attaches to XAE over COM
src/Volt.Cli.Connector.Core  net8 library     the connector's UI-free connection model (DetectedProject /
                                          IProjectSource / ConnectionManager + the pipe-backed source) — unit-tested
src/Volt.Cli.Connector   net8 exe         tray supervisor + Volt-branded window over the model. Spawns the
                                          ExternalAttach workers; CODESYS is user-activated in-proc (never launched)
```

(The `volt` CLI — `src/Volt.Cli`, the pipe *client* — is documented in `README.md`.)

**The golden rule:** everything that can be shared lives in `Core`; only irreducible vendor glue lives in a
bridge. `Core` targets `netstandard2.0` specifically so it loads inside the net48 in-proc CODESYS host *and* the
net8 standalone TwinCAT exe unchanged.

## How a request flows

Every op is the same shape — `Core/Wire/BridgePipeHost` receives one request per connection, `Sync/*`
services do the work over the `Ide/IIdeDriver` contract, `Workspace`/`Graphical` turn IDE items into canonical
text:

```
volt CLI ──pipe──▶ BridgePipeHost (Core/Wire)
                     │  reads one {op,body} frame; single error boundary (throws → error frame)
                     ▼
                   RunOp ── marshals onto the IDE's required thread; threads an onP() progress callback
                     ▼
                   Fetch / Push / Build / Refs  (Sync/)      ── the op logic
                     │
        Workspace/ (ST text) + Graphical/ (VG text)          ── item ⇄ canonical workspace text
                     │
                   IIdeDriver  (Ide/ contract)               ── the ONE seam a vendor implements
                     ▼
        CodesysDriver / BeckhoffDriver  →  live IDE
```

Ops: `health`, `refs`, `fetch`, `push`, `build`, `init`, plus `connect`/`disconnect` and `debug`. Each connection
carries one request and its streamed frames. There is **no** events/SSE and no wait-change — change-detection is
client-polled. (`connect`/`disconnect` are the wire verbs the control-plane `/connect`, `/disconnect` routes map to —
same name across both layers.)

**`health` is the ONE ambient poll — and it must never marshal onto the IDE thread.** The IDE has exactly ONE work
thread (CODESYS's primary thread; TwinCAT's STA) and it is genuinely single-threaded — a `fetch`/`push`/`build`
holds it for the op's whole duration. `health` is what the connector polls every ~4s (plus every control-plane
`/status`). It is served from a **cached snapshot** refreshed off the request path by the driver's single-flight
background probe (`TriggerAsyncProbe` → on-thread `SnapshotHealth`). Connections are served concurrently
(`PipeServer`), so `health` returns immediately even while a long op holds the IDE thread. This once was a *separate*
`instances` op that **marshalled** onto the IDE thread — so during a long op it queued behind it, the connector's
refresh stalled, and a busy IDE read as a **lost connection**. Folding discovery into the cache-served `health` fixed
that by construction. Guarded by `PipeTransportTests.Health_poll_answers_from_cache_while_the_one_IDE_thread_is_busy_with_a_long_op`.

> **`health` is a FLAT array of self-describing project rows and nothing else** — no nesting, no root fields
> (`HealthResponse.Projects: ProjectEntry[]`). Each row = one connectable project (a leaf; CODESYS/TwinCAT projects
> have no children): `{ vendor, version, project, status, serving, dirty }`. Everything is per-row because
> the connector concatenates *every* bridge's array into the ONE cross-vendor list it shows (`ConnectorView.Projects`)
> — so the wire row and the UI row are the same shape, and the connector just concatenates (no transform). `serving`
> marks the one row the bridge is attached to (host clears all while paused); `status` (`healthy`/`degraded`) is the
> IDE's channel health. The reverse direction is `connect { project }` — the row's *address is its NAME*: a project is
> identified by vendor+name, and `select` re-resolves it on whichever live instance has it open (no instance handle —
> two same-named projects open at once collapse, the accepted limit the workspace binding already has). C#-only
> computed helpers (`ProjectName`/`Platform`/`Connected` off the serving row) keep CLI call-sites terse; they are
> `[JsonIgnore]`, never on the wire. See `ProjectEntry.cs` / `HealthResponse.cs`.

## Core — the shared engine (`src/Volt.Engine`)

A strict layer stack; each layer depends only on the ones above it. Read top-down: contract first, leaves last.

| Layer | Does | Key types |
|---|---|---|
| **`Ide/`** | **The contract** a vendor bridge implements — and *only* this. `IIdeDriver` = `IIdeSession` (connect/health/build) + `IProjectTree` (walk + CRUD) + `ICodeStore` (read/write textual ST and graphical PlcOpen XML). `DriverBase` provides the shared degraded-state machine + single-flight health probe. `ItemRef` is the opaque per-vendor handle that keeps native objects out of Core; `ProjectItem` carries name/folder/`ExcludeFromBuild`. | `IIdeDriver`, `IIdeSession`, `IProjectTree`, `ICodeStore`, `DriverBase`, `ItemRef`, `ProjectItem` |
| **`Wire/`** | **The wire DTOs** — plain JSON request/response shapes (`RefsFetch`, `PushModels`, `BuildModels`, `HealthResponse`). The transport itself is `Volt.Cli.Transport` (the named pipe) driven by `Wire/BridgePipeHost`, which maps each op to its Sync service, marshals every project-touching call onto the IDE's required thread, streams progress, and is the single error boundary. Identical on both bridges. | `RefsFetch`, `PushModels`, `BuildModels`, `HealthResponse` |
| **`Sync/`** | **One service per op** — `FetchService` (`fetch` + `init`), `PushService`, `BuildService`, `RefsService`, `DebugService` (`debug`). `Hasher` + `Versioning` give each item one content version so the same project hashes identically on either vendor. | `FetchService`, `PushService`, `BuildService`, `RefsService`, `DebugService`, `Hasher`, `Versioning` |
| **`Workspace/`** | **Source materialization** — `Materializer` turns a project item into canonical workspace text; `SourceText/` splits/assembles ST (`StSplitter` ⇄ `StAssembler`, sharing `CodeHelper`). `ItemKind` is the vendor-neutral item-type table (see `docs/ITEM_KINDS.md`). | `Materializer`, `ItemKind`, `SourceText/StSplitter`, `SourceText/StAssembler` |
| **`Graphical/`** | **Graphical materialization** — PlcOpen XML ⇄ `GraphModel` ⇄ VG text (see `docs/vg-language.md`). `GraphicalCode` is the gate: FBD/LD → editable VG; CFC/SFC → read-only. `PlcOpenReader`/`Writer` and `Vg/VgParser`/`Vg/VgWriter` are the two ends. | `GraphicalCode`, `GraphModel`, `PlcOpenReader`, `PlcOpenWriter`, `Vg/VgParser`, `Vg/VgWriter` |
| **`Library/`** | Referenced-library manifests + signatures — `LibraryManifest` (the canonical `.library` body + hash basis), `LibSignature`/`LibSignatureRenderer` (verbose-fetch signatures under the Library Manager). | `LibraryManifest`, `LibSignature`, `LibSignatureRenderer` |
| **`Diagnostics/`** | `VoltLog` — a zero-dependency durable logger (timestamped/leveled/source-tagged) to `%LOCALAPPDATA%\Volt\logs`, daily files pruned after 14 days. netstandard2.0 with no framework dep so it loads in the net48 in-proc host too. | `VoltLog` |

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `refs` `items`/`kinds`/`folders`, `fetch` `knownItems`, every push
op, `structureVersion` (hash of sorted *names*), and the one-item-per-file workspace layout. Load-bearing across
`volt-cli` and `volt-vscode`. Two items with the **same name** collapse in the version map
(last-write-wins) — a non-issue for source items (IEC guarantees unique names) and only reachable for opaque
non-source items the AI never edits (e.g. one `Library Manager` per application). Keying by `folder+name` would
fix it but is a breaking redesign not worth it for opaque-metadata collisions. **Do not add a "duplicate name"
guard that throws** — real projects legitimately repeat these names, and throwing breaks `refs`.

### Wire / materialization invariants (each cites its Core symbol)

- **Dead code is RETURNED; reachability is the LSP's job.** All source is returned over `refs`/`fetch`
  **including** dead/uncalled POUs — reachability is analyzed downstream, not a wire field. (Exclude-from-build
  filtering was scoped — an object the IDE won't compile has no compiler ground truth — but is NOT implemented:
  excluded objects are currently returned like any other source. If added, wire it into the tree walk, not a
  `/debug` probe.)
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
- **The wire is a local named pipe, never a network socket** — there is no listening port and no browser-reachable
  surface, so a web page can't drive `push` (the HTTP-era cross-origin guard is moot).

## A bridge — three parts (`Codesys` / `Beckhoff`)

Both bridges share one shape, so the roles line up. The `Driver/` facets are **thin facades** holding no vendor
state — they delegate every real IDE touch to a single **gateway** and every cross-thread call to a **dispatcher**,
both in `Ide/`.

```
PipeHost.cs / Program.cs   entrypoint   — boots the shared BridgePipeHost on the vendor pipe
Driver/                    contract     — implements Core's IIdeDriver, split by facet (.Tree / .Code partials)
Ide/                       vendor glue  — the gateway + dispatcher that talk to the live IDE
```

Note the deliberate naming: **Core `Ide/` is the contract; a bridge's `Ide/` is the live-IDE access behind it;
the bridge's `Driver/` is the bridge between them.**

| Role | CODESYS | Beckhoff | Notes |
|---|---|---|---|
| Entrypoint | `PipeHost.cs` | `Program.cs` | CODESYS: `PipeHost.Start()` called in-proc by the IDE's IronPython script command. Beckhoff: standalone exe; spawns its STA thread, starts degraded, attaches when TwinCAT appears. |
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

Pipes — the topology is now SYMMETRIC (one pipe per running IDE, keyed by pid); the remaining asymmetry is
LIFECYCLE (who owns the host), and mirrors InIdeLoad vs ExternalAttach — **do not unify the lifecycle**:
- **Both vendors = one host per running IDE, one pipe EACH: `volt.bridge.<vendor>.<pid>`.** No single bridge for
  either — every IDE serves its own pipe so multiple coexist without colliding. Clients find them all by enumerating
  the pipe namespace (`PipeDiscovery` → `Volt.Cli.Transport`). The connector fans out over the discovered pipes with
  ONE `PerPipeProjectSource` per vendor; the CLI resolves the one serving the **bound project** by name
  (`BridgeResolver`) and REFUSES on 0/ambiguous rather than target the wrong IDE.
- **CODESYS host = in-proc, dies with the IDE (no supervision).** Loaded into each IDE by user activation.
- **TwinCAT host = an external per-XAE worker the connector spawns/reaps.** TwinCAT automation is out-of-process COM,
  so a worker owns ONE XAE window, attaches by its stable **process id** (`--xae-pid`, not the ephemeral ROT
  moniker), and serves `volt.bridge.twincat.<pid>`. The connector's `TwincatSupervisor` keeps exactly one worker per
  live XAE — it discovers XAE pids by running the worker's `--list-xae-pids` one-shot (COM in a short-lived child, so
  the always-on tray never holds a COM apartment), spawns/reaps on the diff, and debounces a transient probe miss.
  This lifecycle cost — spawn/reap a separate process — is the whole price of TwinCAT being ExternalAttach; CODESYS
  gets it for free because its host is in-proc.

Above the connector everything is vendor-neutral: a flat project list, and each project serves iff a live client
**session declares interest** in it (the `connector-session-model` — `ConnectionManager` reconciles bind/unbind from
the union of interests; there is no single "active connection"). The per-instance-pipe machinery + the TwinCAT
supervisor live entirely below `IProjectSource`.

**The rule that separates the two — and it is now enforced, not just intended:** *any per-vendor difference that
Volt (the CLI/connector) can OBSERVE is a bug.* The load-bearing asymmetries above are strictly about how each IDE
is REACHED — they live below the `IIdeDriver` seam (and the pipe topology below `IProjectSource`). The wire
behavior and error codes are identical across vendors by construction:
- **Parity-critical decisions live in Core, once.** A choice a pipe client can observe — a `connect` post-condition,
  the not-connected precondition on project-ops, an error mapping — is decided in `Wire/BridgePipeHost`, delegating
  only irreducible primitives (attach, tree-walk, code r/w) to the driver. The drivers can't diverge these; they
  don't own them. (E.g. a `connect` that can't attach the project, and any project-op on a not-connected bridge,
  both refuse with the shared `PLC_DISCONNECTED` on either vendor — the check is in Core, not per driver.)
- **One error channel:** only `BridgeException`/`BridgeErrorCodes` cross the wire; a driver must not leak a
  vendor-specific exception type as an expected condition.
- **Enforced by a guard:** `VendorParityGuardTests` fails the build if a vendor string literal appears in Core code
  (`Volt.Engine`). Comments may still explain a vendor's PLCopen dialect — the shared transform handles it — but no
  `vendor == "twincat"` branch may live above the pipe.

The fuller programme (shrinking `IIdeDriver` to primitives, a conformance suite over both drivers) is tracked in
`openspec/changes/bridge-vendor-parity-by-construction`.

**Disconnect gates the bridge, it does not shut anything down.** `disconnect` makes `BridgePipeHost` refuse every
sync op with `PLC_DISCONNECTED` (only `health`/`connect`/`disconnect` keep answering — `health` carries the project
list too, so it is how the UI shows the state and finds the way back); the next `connect` resumes it. The gate must
live here, not in the connector, because the CLI opens the pipe directly and never consults the connector — so the
connector's selection can never gate `volt push`. One flag on the host, so the whole bridge is gated: on TwinCAT that
means that XAE's per-pipe worker, which serves its one selected project. In-memory by design — a host or connector
restart resets it to serving. `VOLT_PIPE` overrides the pipe directly (dev,
tests, and `volt init` — which has no binding yet — via the shell). The workspace binding stores the vendor +
project name; `pull`/`push` resolve the live pipe at op-time.

## Build, run, test

See `README.md` for commands. In short: `dotnet build Volt.Cli.sln`; the C# unit tests
(`test/Volt.Engine.Tests/`) run offline against a fake IDE, and the TS e2e tests (`test/e2e/`) drive a live
bridge over the pipe; the headless CODESYS dev loop is `scripts/codesys-pipe.ps1` (the TwinCAT worker is spawned
by the connector).

## Related docs

- `docs/ITEM_KINDS.md` — the vendor-neutral item-type coverage map (`Workspace/ItemKind` is the source of truth).
- `docs/vg-language.md`, `docs/vg-diagnostics.md` — the VG graphical sublanguage.
- `docs/debugging-a-bridge-session.md` — debugging a live bridge.
