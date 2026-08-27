# Volt.Cli — implementation architecture

A **bridge** exposes one live PLC IDE (CODESYS or TwinCAT) to the `volt` CLI over a local **named pipe**.
Both vendors serve **byte-identical responses** for the same project even though they reach their IDEs in
completely different ways — because everything shareable lives in one Core and the parity boundary is the pipe
wire, not the driver.

## The projects

Nine assemblies. The shape is forced by two hard constraints, not by taste: the CODESYS bridge is a **net48**
DLL loaded *in-process* by the IDE, the TwinCAT bridge is a **net8.0-windows** exe driving COM — so everything
they share must be `netstandard2.0`; and the tray connector **may not reference the engine**, so whatever it
needs has to sit below it.

```
src/Volt.Contracts        netstandard2.0  THE WIRE CONTRACT — the one assembly every other assembly can see.
                                          The closed vocabularies (Ops / BridgeErrorCodes / HealthStatus /
                                          Vendors), the request/response DTOs, and VoltLog. NO ProjectReference,
                                          ever — that is what makes it visible to everyone, connector included.
src/Volt.Wire             netstandard2.0  The named pipe itself: PipeServer/PipeClient/frames/PipeNames/
                                          PipeDiscovery. Knows how to carry bytes; knows nothing about projects.
src/Volt.Engine           netstandard2.0  The domain — the whole shareable engine, and NO transport.
src/Volt.Engine.Host      netstandard2.0  BridgePipeHost: the ONE place a wire op maps to a service and gets
                                          marshalled onto the IDE thread. Its own assembly precisely so Engine
                                          references no transport.
src/Volt.Cli.Ide.Codesys  net48 library   CODESYS bridge — driver + pipe host, loaded IN-PROCESS by the IDE.
src/Volt.Cli.Ide.Twincat  net8 exe        TwinCAT bridge — driver + worker, STANDALONE, attaches to XAE over COM.
src/Volt.Cli              net8 exe        the `volt` CLI — the pipe CLIENT (see README.md).
src/Volt.Cli.Connector.Core  net8 library the connector's UI-free model (DetectedProject / IProjectSource /
                                          ConnectionManager) AND the TwinCAT worker fleet. Here, not in the tray,
                                          because none of it needs WinForms — and in a net8.0-windows assembly
                                          the policy that actually runs was untestable.
src/Volt.Cli.Connector    net8 exe        tray + window over that model. Owns the WinForms shell, the user-facing
                                          lifecycle and the auto-update/install agent. CODESYS is user-activated
                                          in-proc (never launched).
```

### Why Contracts and Wire are separate, and why Host exists

All three were carved out of one `Volt.Cli.Transport`, and the reasons are worth keeping because each was paid
for once already:

- **The contract had no home.** The vocabularies and two DTOs sat in the pipe library while every other DTO sat in
  the Engine — split by REACHABILITY, not concept. The connector may not reference the Engine and still has to
  read `health`, so whatever the connector needed drifted downward and the rest stayed up. The cost was
  measurable: `Severity` landed above the vocabulary guard's reach and ended up with zero symbolic uses and six
  literal spellings, and `connect`/`disconnect` had no response type at all.
- **The domain referenced a named-pipe server** solely because the dispatcher lived inside it — so the CODESYS
  in-proc DLL and every test dragged a pipe server along with the domain model. `Volt.Engine.Host` is that
  dispatcher, downstream of both Contracts and Wire.
- **`Volt.Wire` cannot see `BridgeException`** (Engine is above it), which is why `ICodedError` exists. That is a
  real assembly-graph seam, not a speculative one.

The connector-cannot-see-the-Engine boundary is a deliberate product property, so it is enforced by the reference
graph rather than by convention.

**The golden rule:** everything that can be shared lives in `Core`; only irreducible vendor glue lives in a
bridge. `Core` targets `netstandard2.0` specifically so it loads inside the net48 in-proc CODESYS host *and* the
net8 standalone TwinCAT exe unchanged.

## How a request flows

Every op is the same shape — `Core/Wire/BridgePipeHost` receives one request per connection, `Sync/*`
services do the work over the `Ide/IIdeDriver` contract, `Item`/`Source` turn IDE items into
canonical text:

```
volt CLI ──pipe──▶ BridgePipeHost (Core/Wire)
                     │  reads one {op,body} frame; single error boundary (throws → error frame)
                     ▼
                   RunOp ── marshals onto the IDE's required thread; threads an onP() progress callback
                     ▼
                   Fetch / Push / Build / Refs  (Sync/)      ── the op logic
                     │
     Model/ (one content model) + Text/ (canonical ST) ── item ⇄ canonical workspace text
        + Document/ (the POU document, codecs keyed by language) + Graph/ (FBD/LD)
                     │
                   IIdeDriver  (Ide/ contract)               ── the ONE seam a vendor implements
                     ▼
        CodesysDriver / BeckhoffDriver  →  live IDE
```

Ops: `health`, `refs`, `fetch`, `push`, `build`, `init`, plus `connect`/`disconnect`. Each connection
carries one request and its streamed frames. There is **no** events/SSE and no wait-change — change-detection is
client-polled. (`connect`/`disconnect` are the bridge `select`/`deselect` wire verbs the connector's reconciler drives
to bind/unbind a project — nothing to do with the removed HTTP connect/disconnect; the control plane is session-only.)

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

A strict layer stack; each layer depends only on the ones below it in the dependency order. **Folders are named
for their SUBJECT, and a body language's implementation lives under the body** — not for the dependency level a
file happens to sit at, which is what `Vocabulary/` and `Model/` used to mean and why `GraphModel` ended up filed
away from the only code that uses it.

| Folder | Does | Key types |
|---|---|---|
| **`Ide/`** | **The contract a vendor bridge implements — and only this.** `IIdeDriver` = `IIdeSession` (attach/health/build) + `IProjectTree` (walk + CRUD + `Move`) + `ICodeStore` (the document, plus the textual aspects declaration-only kinds need). `DriverBase` owns the shared degraded-state machine, the single-flight health probe **and the whole health response** — `BuildHealthResponse` used to be abstract, which put a WIRE-VISIBLE shape behind the vendor seam and let the two drivers diverge unseen (they had). `TreeNav` and `ItemLookup` navigate a driver's tree; they live here, not with `Item/`, because they take an `IIdeDriver`. | `IIdeDriver`, `IIdeSession`, `IProjectTree`, `ICodeStore`, `DriverBase`, `TreeNav`, `ItemLookup` |
| **`Item/`** | **What an item IS and where it sits.** `ItemKind` is the vendor-neutral item-type table (`docs/ITEM_KINDS.md`); `FolderPath` is tree-path arithmetic; `ItemRef` is the opaque per-vendor handle that keeps native objects out of the domain; `WalkResult` distinguishes a complete walk from one that skipped a subtree. | `ItemKind`, `FolderPath`, `ItemRef`, `ProjectItem`, `WalkResult` |
| **`Source/`** | **The item as ONE PLCopen document** — declaration, body, members, accessors, read and written through the same representation. `PouReader` reads; `PouSplice` writes by EDITING the item's own export (never regenerating, so attributes, pragmas, object ids and vendor `addData` survive); `PouDocument` is the one splice entry point; `Declaration` is the ONE declaration rule for every member position (root, child, accessor — they used to be four, and the accessor's was the one A7 describes as writing to the copy the IDE does not read); `ProjectStructure` keeps the document's own structure block honest — TwinCAT's importer creates a POU child ONLY if it is declared there. Vendor dialect facts: `Source/DIALECT.md`. | `PouReader`, `PouSplice`, `PouDocument`, `Declaration`, `ProjectStructure`, `PlcOpenDocument`, `ItemContent` |
| **`Source/Body/`** | **A body has a LANGUAGE; a language has a CODEC.** `BodyCodec` dispatches by language (ST is identity, FBD/LD pivot on the graph, CFC/SFC/IL are UNSUPPORTED — a marker on read, a refusal on write); `BodyElement` is the one scan that finds a body element, direct or nested, for the reader and the codecs alike; `BodyGuard` is the ONE gate every body write passes, wherever the body sits; `BodySpliceGuard` refuses to overwrite a stored body carrying something network text cannot represent. **There is no "graphical vs textual" fork above this layer**; that boolean was the source of three silent data-loss bugs. | `BodyCodec`, `BodyElement`, `BodyGuard`, `BodySpliceGuard`, `Languages`, `BodyMarker` |
| **`Source/Body/St/`** | **The canonical workspace ST format, both halves together.** `StWriter` renders an `ItemContent`; `StReader` parses it back. `Descriptor` renders the canonical text for NON-source items. An INVERSE PAIR over one record — `write(read(write(x))) == write(x)` is a law that could not even be TYPED while the halves spoke different records. The only written spec of a format with TWO implementations in two languages (`volt-lsp-iec` re-parses it). | `StWriter`, `StReader`, `Descriptor`, `CodeHelper` |
| **`Source/Body/Network/`** | **FBD and LD — one pipeline, because they are one implementation.** **A push rewrites only the networks whose TEXT CHANGED** (`NetworkSplice`): the stored body renders back to byte-for-byte what a pull wrote, so any network matching that keeps its stored XML — ids, vendor `addData`, comment boxes and all. Carrying requires byte equality, so wrong-carry is impossible by construction; a network the engineer edited regenerates exactly as before. The capability gate is scoped to what is actually discarded — narrower in SCOPE, unchanged in what it refuses. `GraphReader.LowerLadder` lowers a ladder's contacts and coils into the same boolean node graph an FBD network uses, so they share the model, the text format and everything below the two arms that read and write the XML. `GraphReader`/`GraphWriter` convert graph ⇄ PLCopen body XML; `NetworkTextReader`/`NetworkTextWriter` convert graph ⇄ network text; `NetworkCode` is the well-formedness gate; `InstanceTypes` recovers FB instance types network text omits. Called `Network`, not `Diagram`: `Languages.IsDiagram` is CFC and SFC, the bodies Volt CANNOT express as text. | `GraphReader`, `GraphWriter`, `NetworkText*`, `NetworkCode`, `GraphModel` |
| **`Library/`** | Referenced-library manifests + signatures — `LibraryManifest` (the canonical `.library` body and hash basis, shared so the two vendors cannot drift on those bytes), `LibSignatureRenderer`, `LibraryLayout`, `LibraryFetch`, `LibSignature`. | `LibraryManifest`, `LibSignatureRenderer`, `LibSignature` |
| **`Sync/`** | **One service per op** — `RefsService`, `FetchService` (`fetch` + `init`), `PushService`, `BuildService`. `Materializer` turns a project item into an `ItemContent` and hands it to `StWriter`; it routes POUs/interfaces through the document and declaration-only kinds (DUT/GVL) through the declaration aspect — a COST decision (~1 ms against ~20 ms per item, on a walk every `volt status` pays), NOT a capability one: both vendors export a DUT fine (DIALECT C2a). The WRITE has no such split; every kind travels as one document. `Hasher` + `Versioning` give each item one content version, so the same project hashes identically on either vendor. `OpGuard` is the shared precondition; `ProjectSnapshot` is the version walk `refs` answers with. | `FetchService`, `PushService`, `BuildService`, `RefsService`, `Hasher`, `Versioning`, `Materializer` |

`BridgeException` and `Polyfills` sit at the root because their namespace is the root: `BridgeException` is the
wire's error type and every layer throws it, so it is reachable without a `using` by design.

The stack is acyclic and checked. `Item/` depends on nothing; `Source/` may depend on `Source/Body/`, which may
depend on its language folders, never the reverse; `Ide/` sits above the content layers; `Sync/` composes them.
That direction is a property of the code, not of the folder names — the names only have to make it legible.

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
- **Content travels as ONE PLCopen document; STRUCTURE travels on the scripting API.** This is the axis the code
  is filed on, and it holds in BOTH directions. On read, `Sync/Materializer` gets a POU's declaration, body,
  methods, actions, properties and accessors out of a single export — but needs a separate COM tree walk
  (`BuildFolderMap`) for its child folders. On write, `Sync/PushService` imports a single spliced document — and
  then needs `IProjectTree.Move` (`RestoreChildFolders`) for exactly the same reason. The reason is the same both
  times: **PLCopen carries no folder membership the import will honour.** CODESYS's export CAN describe it
  (`bExportFolderStructure` emits a `projectstructure` block) but emits it `handleUnknown="discard"`, and the
  import does precisely that — measured. Rename is the other structural verb PLCopen cannot express, so it stays
  on `IProjectTree.Rename`, where the IDE rewrites call-sites.
- **CFC, SFC and IL are UNSUPPORTED; only ST, FBD and LD round-trip** (`Graph/NetworkCode`). An unsupported body
  materializes as the `(* @volt-graphical: <LANG> *)` marker — carrying none of the content — and is refused on
  push. It used to be called "read-only", which oversold it: there is nothing readable, and the marker is the
  point. IL is in this set for a reason worth keeping: being textual, it once materialized as its raw source,
  so the engineer got an editable-looking file and the next push rewrote their IL body as ST.
  Detection is `Document/BodyElement`, ONE scan shared by the reader and the codecs, searching a direct
  `<body>` child and any depth under `<body>/<addData>`. Both halves must agree or the protection is not
  protection: if only the reader recognises a nested diagram, `PresentWith` matches the empty `<ST>` the schema
  makes a nested body carry, that counts as uncommitted, and the push flattens the diagram.
- **Execute boxes round-trip as network text `EXECUTE … END_EXECUTE`** holding their ST verbatim (`Graph/NetworkTextReader`) — never a bare call that drops the ST.
- **Container managers are folders, never items** (`Item/ItemKind.IsContainerManager`) — no
  `<Manager>.<kind>` stub of their own.
- **Property accessor shape round-trips byte-identically** — GET-only / SET-only / GET+SET preserved on both
  bridges (`Document/PouReader.Accessor` — read from the SAME export as everything else, with an ABSENT accessor
  (null) kept distinct from a present-but-bodiless one (`""`), which is what lets a push drop a getter).
- **Referenced-library signatures materialize under the Library Manager** — one canonical `.library` manifest per
  library (`Library/LibraryManifest`); `verbose` fetch (`FetchRequest.Verbose`) adds each element's declaration-only
  signature as a read-only item, excluded from `structureVersion`. Volt implements no signature extraction on TwinCAT, so the set is empty there. That is a gap in VOLT and
  nothing else: the surface EXISTS and has now been measured — `_ITcPlcLibraryManager.ProduceAllLibrarySignatures()`
  returns ~181k chars of structured signatures on the fixture, out-of-process (DIALECT C2c). This line used to
  read "TwinCAT (out-of-process) can't extract", which was the same shape of invented incapacity as "TwinCAT has
  no move" (D4f) — both wrong, both for months.
- **Round-trips are lossless** — push→fetch returns byte-identical `sourceText`/`folder`/`name`; an **emptied body
  is cleared, not silently retained**. A vendor divergence is a parity defect.
- **Skipped/errored items are logged, never silently dropped** (`Volt.Contracts/VoltLog`) with `name` + reason.
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
  language must be parsed out locally; CODESYS gets the same answer from the shared `Volt.Engine.Source`. The parser is
  irreducibly TwinCAT-specific, so it stays in Beckhoff.
- **Beckhoff's tree walk keeps per-node `try/catch`** (skip a child that faults mid-walk) where CODESYS's doesn't
  — cross-process COM throws far more readily than the in-proc object model. That defensive catching is part of
  the walk; don't strip it for symmetry.

Pipes — the topology is now SYMMETRIC (one pipe per running IDE, keyed by pid); the remaining asymmetry is
LIFECYCLE (who owns the host), and mirrors InIdeLoad vs ExternalAttach — **do not unify the lifecycle**:
- **Both vendors = one host per running IDE, one pipe EACH: `volt.bridge.<vendor>.<pid>`.** No single bridge for
  either — every IDE serves its own pipe so multiple coexist without colliding. Clients find them all by enumerating
  the pipe namespace (`PipeDiscovery` → `Volt.Wire`). The connector fans out over the discovered pipes with
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

## Conventions — the rules this source actually follows

Derived from the line-by-line audit of `src/` (`openspec/changes/audit-volt-cli-src`), not invented: every rule
below is here because breaking it produced a real defect in this codebase. Where an exception is deliberate, it is
marked in the code with its reason — a `ponytail:` comment — rather than left to be re-discovered.

1. **No fallbacks. Fail loud with a coded error.** A defensive default (`?? ""`, `?? "FBD"`, a silent `catch`)
   masks a bug somewhere else and buys nothing. Concretely: `Hasher.ComputeItemVersion` no longer defaults a
   missing folder to `""`, because that hashed identically to a legitimately *empty* folder and silently drifted an
   item's version; `FetchService` raises a coded `BridgeException` naming the item instead. `PipeClient` no longer
   invents `"ERROR"` for a malformed error frame. If data is required, say so **and** guard it.
2. **A nullable annotation is not enforcement.** Annotations are compile-time only, so tightening `string?` →
   `string` changes nothing at runtime. If a value is genuinely required, add a runtime guard; otherwise you have
   documented an intention and moved a warning up the call chain.
3. **One question, one answer.** The not-connected precondition is decided from live driver state
   (`IIdeSession.IsConnected` + `ServedProjectName`), never from `BuildHealthResponse()` — health is served from a
   per-vendor **throttled cache**, and deciding a write against it refused pushes on stale state while reads of the
   same bridge succeeded. If two code paths answer the same question from different sources, that is the bug.
4. **Never swallow a background failure.** `DriverBase`'s health probe stays best-effort for the *request* (a probe
   failure must not fault `health`) but logs and marks degraded. A bare `catch` there once left health repeating a
   stale "nothing serving" indefinitely with no log line to read.
5. **One error channel, one log path.** Only `BridgeException`/`BridgeErrorCodes` cross the wire — a driver must not
   leak a vendor exception. All logging goes through `Volt.Contracts/VoltLog`.
6. **Parity-critical decisions live in Core, once.** Anything a pipe client can observe is decided in
   `Wire/BridgePipeHost` or a `Sync/` service; drivers supply only irreducible primitives (attach, walk, code r/w).
   See "Load-bearing asymmetries" above for what is *legitimately* per-vendor — do not unify those for symmetry.
7. **Centralized vocabulary stays centralized.** `ItemKind.Kinds`, `BridgeErrorCodes`, `Ops`, `Vendors` are the
   spellings; re-spelling one as a literal outside its home file fails `WireVocabularyGuardTests`. That guard is
   load-bearing, not pedantry — it caught a real regression during this audit.
8. **A false comment is a defect, not cosmetics.** The audit found comments claiming both vendors emit the same
   library manifest (CODESYS never calls that renderer), that `__`-*prefixed* names are skipped (the code tests
   `Contains`), and that keyword scanning happens "at column 0" (it does `TrimStart`, so any indentation matches —
   which decides whether an indented `END_METHOD` closes a child block). Fix the comment with the code, or fix the
   code.
9. **Static search does not prove code dead.** Reflection, `dynamic`, and the IronPython entry point reach the
   CODESYS host with no compile-time reference; and a `public static` helper can rot with no compiler warning
   (`CodeHelper.ExtractAcl` did). Prove callers repo-wide before deleting, and treat the live e2e run as the real
   check.
10. **Tests are the oracle.** A change that needs a test rewritten to stay green is a behaviour change wearing a
    costume — escalate it instead. A test may only change when its premise is wrong on grounds *independent* of the
    code's current behaviour. Beware the double: `FakeIde` asserted that `IsConnected` and
    `BuildHealthResponse().Connected` were the same signal — an invariant the real TwinCAT driver breaks — so 500+
    green unit tests could not see the divergence.
11. **Resolve the object you NAMED, never the first match in the document.** `ReadXml` returns a POU *and its
    children* on both vendors, so `doc.Descendants(ns + "FBD").FirstOrDefault()` can return a METHOD's body — and
    `SpliceFbdLdBody` then writes the root's new body into it, destroying the method's. The same mistake appeared
    three times in the graphical splice (`FindFbdLd`, `InlineInsert`, `GraphicalBodyLang`) and once more in
    `DeclFromExport`, which is why `Document/PouReader` exists. Scope to the root `<pou>`'s DIRECT child, by NAME —
    `PlcOpenDocument.OwnerOf`/`ItemBody`/`OwnDescendants` are the shared primitives that do it, and every splice
    member takes an item name for this reason alone. A FIFTH instance of the same bug was found later and is worth
    knowing: a declaration write took the FIRST `InterfaceAsPlainText` under the item, which on a POU with declared
    variables is the copy nested inside the typed `<interface>` — so the write was accepted and changed nothing.
12. **A name is not a path.** Wire item names are bare (`Foo.fb`); workspace entries are src-relative paths
    (`Folder/Foo.fb`). `IdeTree` matched a set of NAMES against PATHS, so an item deleted in the IDE never left
    the workspace unless it sat in the project root — and the one test covering it used a root item. Two auditors
    found this independently from opposite sides of the call. If a set crosses that boundary, convert at the
    boundary and name the variable for what it holds.
13. **A classifier must be TOTAL; a parser may be partial.** `RefinePou` returns a code for every input because
    it runs inside the CODESYS tree walk, whose `try/catch` wraps only `GetChildren` — a throw there aborts
    `WalkItems` and with it every fetch/refs/init/push for the project. `CodeHelper.ParseCodeHeader` throws by
    design. When the two must share logic, share the TOTAL half (`CodeHelper.HeaderLine`) and let the strict
    caller add the throw.
14. **A reflective miss is a version mismatch, not a no-op.** `CodesysObjectModel.InvokeMethod` returned null when
    no overload matched, and every mutating call routes through it — so a renamed object-model method turns
    `SetObject(meta, true, null)` into a silent no-op: push reports success and the edit is gone. Its siblings
    `InvokeWithOptionals`/`CreateNamed` throw "object-model version mismatch". Reflection must fail loud, and a
    `default:` arm in a kind switch must throw naming the kind rather than substituting a different one.
15. **A guard only the tests reach is not a guard.** All four "not a Volt workspace — run `volt init` first"
    refusals are unreachable in production: `BridgeResolver` reads the config eagerly and `Program` evaluates
    `Bridge()` as a call ARGUMENT, so an uninitialised workspace dies with a raw `FileNotFoundException` first.
    They fire only under `VOLT_PIPE` — which is how every test drives the CLI. A green suite that takes a path
    users never take is evidence about the suite, not the product.

## Build, run, test

See `README.md` for commands. In short: `dotnet build Volt.Cli.sln`; the C# unit tests
(`test/Volt.Engine.Tests/`) run offline against a fake IDE, and the TS e2e tests (`test/e2e/`) drive a live
bridge over the pipe; the headless CODESYS dev loop is `scripts/codesys-pipe.ps1` (the TwinCAT worker is spawned
by the connector).

## Related docs

- `docs/ITEM_KINDS.md` — the vendor-neutral item-type coverage map (`Item/ItemKind` is the source of truth).
- `docs/network-text.md`, `docs/network-text-diagnostics.md` — the network text graphical sublanguage.
- `docs/debugging-a-bridge-session.md` — debugging a live bridge.
