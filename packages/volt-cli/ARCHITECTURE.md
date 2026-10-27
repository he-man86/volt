# Volt.Cli — implementation architecture

A **bridge** exposes one live PLC IDE (CODESYS or TwinCAT) to the `volt` CLI over a local **named pipe**.
Both vendors serve **byte-identical responses** for the same project even though they reach their IDEs in
completely different ways — because everything shareable lives in one Core and the parity boundary is the pipe
wire, not the driver.

## The projects

Eleven assemblies. The shape is forced by two hard constraints, not by taste: the CODESYS bridge is a **net48**
DLL loaded *in-process* by the IDE, the TwinCAT bridge is a **net10.0-windows** exe driving COM — so everything
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
src/Volt.Relay            netstandard2.0  the opt-in relay tunnel both bridges start (PipeHostTunnel.StartIfConfigured,
                                          a sidecar enables it): forwards allow-listed pipe calls over a WebSocket
                                          (docs/relay-protocol.md).
src/Volt.Ide.Codesys  net48 library   CODESYS bridge — driver + pipe host, loaded IN-PROCESS by the IDE.
src/Volt.Ide.Twincat  net10 exe        TwinCAT bridge — driver + worker, STANDALONE, attaches to XAE over COM. One build
                                          per XAE bitness (x86 for TcXaeShell, x64 for TcXaeShell64), the one the
                                          connector starts: the Solution Explorer hierarchy proxy must match the
                                          worker's bitness, so each reads its XAE in-process (DIALECT C2t).
src/Volt.Cli              net10 exe        the `volt` CLI — the pipe CLIENT (see README.md).
src/Volt.Connector.Core  net10 library the connector's UI-free model (DetectedProject / IProjectSource /
                                          ConnectionManager) AND the TwinCAT worker fleet. Here, not in the tray,
                                          because none of it needs WinForms — and in a net10.0-windows assembly
                                          the policy that actually runs was untestable.
src/Volt.Connector    net10 exe        tray + window over that model. Owns the WinForms shell, the user-facing
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
net10 standalone TwinCAT exe unchanged.

## How a request flows

Every op is the same shape — `Volt.Engine.Host/BridgePipeHost` receives one request per connection, `Sync/*`
services do the work over one `HostLink` (the host, its catalog, its composed session), and the host's declared
formats turn its items into canonical text:

```
volt CLI ──pipe──▶ BridgePipeHost (Volt.Engine.Host)
                     │  reads one {op,body} frame; single error boundary (throws → error frame)
                     ▼
                   RunOp ── marshals onto the IDE's required thread (ComposedSession); threads an onP() progress callback
                     ▼
                   Refs / Fetch / Push / Build / Grep  (Sync/)   ── the op logic, over a HostLink
                     │
     Catalog (the host's declaration) ── kind → IItemFormat (file layout), language → IBodyReader (body)
                     │
                   IVendorDriver  (Seam/ contract)               ── the ONE seam a vendor implements
                     ▼
        CodesysDriver / BeckhoffDriver  →  live IDE
```

Ops (`Volt.Contracts/Vocabulary/Ops`): `health`, `refs`, `fetch`, `push`, `build`, `grep`, plus
`connect`/`disconnect`. Each connection carries one request and its streamed frames. There is **no** events/SSE and no
wait-change — change-detection is client-polled. `connect`/`disconnect` bind and unbind a project; the connector's
reconciler drives them.

**`health` is the ONE ambient poll — and it must never marshal onto the IDE thread.** The IDE has exactly ONE work
thread (CODESYS's primary thread; TwinCAT's STA) and it is genuinely single-threaded — a `fetch`/`push`/`build`
holds it for the op's whole duration. `health` is what the connector polls every ~4s (plus every control-plane
`/status`). It is served from a **cached snapshot** refreshed off the request path by the session's single-flight
background probe (`ComposedSession.TriggerAsyncProbe` → on-thread `IVendorSession.ProbeProjects`). Connections are
served concurrently (`PipeServer`), so `health` returns immediately even while a long op holds the IDE thread: a
`health` that marshalled would queue behind the op, and a busy IDE would read as a **lost connection**. Guarded by `PipeTransportTests.Health_poll_answers_from_cache_while_the_one_IDE_thread_is_busy_with_a_long_op`.

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
for their SUBJECT, and a body language's implementation lives under the body.**

| Folder | Does | Key types |
|---|---|---|
| **`Seam/`** | **The contract a vendor host implements — and only this** (no vendor or NWL name, no family code: the new-vendor gate pins it at zero). `IVendorDriver` = `IVendorSession` (attach state, identity, `MarshalToIdeThread`, `ProbeProjects`, select, build, diagnostics, library signatures — PRIMITIVES only) + `IVendorTree` (walk as `HostWalk`, `Children`/`Parent`/`Name`/`Classify` → `NodeClass`, create/delete/rename/move) + `IVendorStore` (`Content` in and out, manifests, task settings, the pre-flight refusals). A host also states a `VendorDeclaration`: its vendor row, kinds, languages and `%`-keys, which a `Catalog` registers into four registries that refuse a conflict by name (`VendorRegistry`, `KindRegistry`, `LanguageRegistry`, `PropertyKeyRegistry`). A kind row names its file layout (`IItemFormat`); a shown language names its `IBodyReader`. | `IVendorDriver`, `VendorDeclaration`, `Catalog`, `Content`, `BodyText`, `PropertySet`, `IItemFormat`, `IBodyReader`, `NodeClass`, `HostWalk`, `VendorDriverBase` |
| **`Ide/`** | **What both hosts share below the contract**, and `DIALECT.md` (the vendor facts). Helpers a host calls over its IEC tree (`Item/IIecTree`): `MemberSites` (where a member's declaration sits), `ProjectDeclarations` (the declarations index network text reads against), `ItemLookup.All`. Shared wording: `ExcludedFolder`, `MeasuredNames`, `BothVendorsRefusedNames`, `InterfaceAccessorGuard`, `ChildRefusedException`, `UnreadableItemException`. `WalkObserver` reports a walk's progress. | `MemberSites`, `ProjectDeclarations`, `ItemLookup`, `WalkObserver`, `UnreadableItemException` |
| **`Item/`** | **What an item IS and where it sits.** `ItemKind` is the IEC item-type table (`docs/items.html`) the CODESYS-family hosts answer in codes; `FolderPath` is tree-path arithmetic; `ItemRef` is the opaque per-vendor handle that keeps native objects out of the domain; `WalkResult` distinguishes a complete walk from one that skipped a subtree. `ItemContent` is the IEC layout's record; `ObjectProperties`, required on it and on every `Member`, carries every vendor member the text spells beside the code (the `%`-lines). | `ItemKind`, `FolderPath`, `ItemRef`, `WalkResult`, `IIecTree`, `ItemContent`, `ObjectProperties` |
| **`Format/St/`** | **The IEC layout: the canonical workspace file of a POU, interface, GVL and DUT, both halves together.** `IecFormat` is that layout as the kinds' `IItemFormat`, over `StWriter`/`StReader` and the layout's record (`FamilyContent` converts it to the contract's `Content` and back, losing nothing). `IecLayout` says how each kind's file is laid out (composite, members inside). `Descriptor` renders the canonical text for NON-source items. `PropertyLines` is the one spelling of an object's `%`-lines, both directions. An INVERSE PAIR over one record — `write(read(write(x))) == write(x)`. The only written spec of a format with TWO implementations in two languages (`volt-lsp-iec` re-parses it). **An INTERFACE's members are `interface_method`/`interface_property` on both sides**, because both sides decide a member's kind from its owner. | `IecFormat`, `FamilyContent`, `IecLayout`, `StWriter`, `StReader`, `PropertyLines`, `Descriptor` |
| **`Format/Network/`** | **FBD and LD — one pipeline, because they are one implementation.** `NetworkModel` is the vendor-neutral graph, shaped on the vendors' OWN `INetwork`/`IBoxTree` (`Ide/DIALECT.md` N1: the two ship an identical model). `NetworkTextReader`/`NetworkTextWriter` convert that graph ⇄ network text — one statement per NWL item, a name only where the vendor names a wire (`docs/network-text.html`); both work against a `NetworkScope` built from the declarations the body sees (`Ide/ProjectDeclarations`); `NetworkBodyReader` is LD's and FBD's `IBodyReader`; `NetworkTextGate` is the token fixed-point gate; `NetworkSpelling` holds the rules writer and reader must agree on; `FbdOperators` is the operator table. **Nothing here knows XML** — a vendor's own representation is the host's business. Called `Network`, not `Diagram`: CFC and SFC are the bodies Volt CANNOT express as text. | `NetworkModel`, `NetworkText*`, `NetworkBodyReader`, `NetworkTextGate`, `NetworkScope`, `NetworkSpelling`, `FbdOperators` |
| **`Format/Body/`** | **What a body IS, decided from the body itself.** `BodyFormatGuard` is the ONE gate a push passes: it refuses to overwrite a body Volt cannot author, deciding from the IDE's LIVE body and never from the incoming text. `UnrepresentableBodyException` is how a reader says a body has no spelling, answered with the read-only `%LANGUAGE LD\|FBD UNSUPPORTED` line rather than by dropping the item. | `BodyFormatGuard`, `UnrepresentableBodyException`, `Languages` |
| **`Library/`** | Referenced-library manifests + signatures — `LibraryManifest` (the canonical `.library` body and hash basis, shared so the two vendors cannot drift on those bytes), `LibSignatureRenderer`, `LibraryLayout`, `LibraryFetch`, `LibSignature`. | `LibraryManifest`, `LibSignatureRenderer`, `LibSignature` |
| **`Sync/`** | **One service per op** over a `HostLink` — the ONE host a process serves, the `Catalog` of ITS declaration alone (a kind no host declared is `BAD_REQUEST` before any write), and its `ComposedSession`. `ComposedSession` is composed once over the host's primitives: the degraded-state machine, the IDE-thread bracketing, the single-flight health probe and **the whole health response** — a wire-visible shape, so no host builds one. `RefsService`, `FetchService`, `PushService`, `BuildService`, `GrepService`. `Materializer` reads an item's `Content` and writes it through its kind's format; a non-source item is its manifest (`ReadManifest`). `Hasher` + `Versioning` give each item one content version, so the same project hashes identically on either vendor. `TreeNav`/`TreeLookup` navigate the host's tree by path; `OpGuard` is the shared precondition; `ProjectSnapshot` is the version walk `refs` answers with. | `HostLink`, `ComposedSession`, `FetchService`, `PushService`, `BuildService`, `RefsService`, `GrepService`, `Materializer`, `Versioning`, `TreeNav` |

`BridgeException` and `Polyfills` sit at the root because their namespace is the root: `BridgeException` is the
wire's error type and every layer throws it, so it is reachable without a `using` by design.

The stack is acyclic. `Item/` depends on nothing; `Format/` may depend on `Item/`, never the reverse; `Seam/` is
the vendor contract in vendor-neutral words; `Ide/` is what the hosts share below it; `Sync/` composes them all over
`Seam/` alone. That direction is a property of the code, not of the folder names — the names only have to make it
legible. Content never travels as a document: a host's store speaks `Content`, and each host reaches its vendor's own
representation below the seam.

### Adding a vendor

A new vendor is one IDE host (its own assembly, as `Volt.Ide.Codesys` and `Volt.Ide.Twincat` are) and nothing in the
Engine. The third test vendor (`test/shared`, "Fakeco": `.blk`/`.typ`/`.stn`, `%LANGUAGE FKL`) is the worked
example; it passes the transport suite over the pipe (`ThirdVendorTransportTests`, `ThirdVendorContractTests`).

1. **Declare** (`IVendorSession.Declaration`, a `VendorDeclaration`):
   - its `VendorRow` (`Id` names the pipe, `volt.bridge.<id>.<pid>`; `Display` is what a user reads);
   - its `KindRow`s: each kind with its extension, its role (`Source`, `Descriptor`, `WritableDescriptor`, `Member`),
     and for a source kind its `KindShape` and its `IItemFormat` (the file layout; the IEC kinds name `IecFormat`);
   - its `LanguageRow`s: a SHOWN language with its `IBodyReader`, a hidden one without (`%LANGUAGE <LANG>
     UNSUPPORTED`);
   - its `PropertyKey`s: the `%`-keys its objects hold, each with its grammar.
   The `Catalog` refuses a malformed or conflicting row by name, before the host serves.
2. **Implement** `IVendorDriver` (deriving `VendorDriverBase` for the pre-flight defaults):
   - session primitives: attach state and identity, `MarshalToIdeThread` (the IDE's one work thread), `ProbeProjects`
     (rows, liveness; never throws for an IDE that stopped answering), `SelectProject`, `Build`,
     `GetBuildDiagnostics`, `ExtractLibrarySignatures`;
   - tree: `Walk` → `HostWalk`, `Children`/`Parent`/`Name`, `Classify` → `NodeClass` (folder, container, item of a
     kind, member, skip), and the structure edits;
   - store: `Read`/`Write` a `Content`, `ReadManifest`, the task settings, and the pre-flight it has MEASURED
     (`RefusedName`, `RefusedMemberCreate`, `ValidateSource`, `ValidateAccessor`, `ValidateProperties`,
     `RefusedLanguageChange` — the one with no default).
3. **Serve**: start `BridgePipeHost` over `HostLink.Of(host)` on the vendor's pipe, and call `RefreshHealth` on the IDE
   thread right after connecting.

What the host never does: build a `HealthResponse`, compute a version or a path, parse a workspace file outside its
declared format, or decide a wire error a shared rule already decides. A vendor fact the host measures gets its row in
`Ide/DIALECT.md` and a test that pins it.

Above the wire, a vendor still has to be registered where the host cannot reach: the closed vendor list
(`Volt.Contracts/Vocabulary/Vendors`: its id and display name, which the CLI binding and the connector read), the
connector's launch of its host (`Volt.Connector.Core`: the CODESYS script command, the TwinCAT worker fleet), the
installer payload and the bridge bundles, and the LSP's dialect (`volt-lsp-iec`). The kind extensions a host declares
must also match the writable-source set the other runtimes declare (`bun run check`).

### Protocol invariant: the item **path** is the identity

The whole wire is keyed by the item's PATH in the IDE's own tree, `<folder>/<name>.<kind>` — `refs`/`fetch` `items`,
`removed`, `knownItems`, `onlyItems`, every push op (`name`, a `set`'s `to`) and conflict, a build diagnostic whose object the vendor names,
`projectVersion` (hash over path + version), and the one-item-per-file workspace layout. One `refs` holds every device
and application (CODESYS) and every system project and PLC project (TwinCAT), so two `PLC_PRG.pou` in two
applications are two items, and so are `CM_Carrier.pou` and `CM_Carrier.visualization` in one folder. The path is
derived in ONE place (`Versioning.VersionedItem.Identity`); an item that could not be materialized has no kind and is
named `<folder>/<bare name>`. **Below the vendor seam the name is BARE** (the IDE's own lookup key, no extension), and
a push resolves it only inside the container its path names (`ItemLookup`), never across the tree. `docs/items.html`
shows one tree per vendor.

**Applications are stated, never parsed.** Each driver's walk names the root folder of every application
(`WalkResult.Applications`; CODESYS each `IApplicationObject`, TwinCAT each PLC project), and `refs`/`fetch` publish
them as `applications`. An item belongs to the application whose root is the longest prefix of its path
(`ItemPath.ApplicationOf`); an item under none is in the pool (the CODESYS project root). No layer above the drivers
reads a vendor segment such as `Plc Logic` or `PLC`. On this rest: a move pairs only within one application (the CLI
never pairs across; the bridge refuses a cross-application `to`, `BAD_REQUEST` naming both), `build` compiles every
application, a client sends its baseline's `knownApplications` so a path under an unread device is judged by the
application it was in, and the LSP resolves a name inside its own application, its libraries and the pool.

**Do not add a "duplicate name" guard that throws** — real projects repeat names across kinds and across
applications, and throwing breaks `refs`.

### Wire / materialization invariants (each cites its Core symbol)

- **Dead code is RETURNED; reachability is the LSP's job.** All source is returned over `refs`/`fetch`
  **including** dead/uncalled POUs — reachability is analyzed downstream, not a wire field. **An object excluded
  from the build is returned too, and SAYS so**: its text carries `%EXCLUDE_FROM_BUILD` (openspec
  `bridge-one-to-one`; below), so a migration does not turn it into a built one and the LSP can tell an object
  with no compiler ground truth. An excluded FOLDER is no item: it is named in the pull report with a known kind,
  and each object in it is named unreadable with its kind — not published (nothing would read it as excluded), not
  read as deleted, and an op on one is refused by name. Every `unreadable` entry carries its REASON on the wire, and
  `volt init` / `pull` / `status` print each name with it, so an object left out by design is told from a failed read.
  A folder linked always, or holding defines, is named and walked.
- **Volt's text is the vendor's object, one to one** (openspec `bridge-one-to-one`). Every member of a vendor
  object is SPELLED, a MEASURED editor cache (never read into the text or written), or REFUSED BY NAME — nothing
  folded, guessed or defaulted. What a declaration and a body cannot hold travels as `%`-lines (`%CLASS`,
  `%EXCLUDE_FROM_BUILD`, `%LINK_ALWAYS`, `%EXTERNAL`, `%COMMENT '…'`, `%NETVAR k: v`, … — `docs/items.html#properties`),
  the fields of one closed record, `Item/ObjectProperties`, REQUIRED on `ItemContent` and `Member` (no default, so a
  driver that has not read an object's properties cannot build its content). `Format/St/PropertyLines` is the one
  spelling (the LSP mirrors it in `frontend/syntax/format/object-properties.ts`); a vendor member no field names
  refuses the ITEM by name on pull. **The class is made at the create, never changed in place**
  (`IVendorTree.CreateChild(…, CreateArgs.Class)`, DIALECT C2l/C2r/C2s): a create the vendor cannot make as that class
  is refused by name, never made plain and reported ACCEPTED, and an update whose `%CLASS` differs is refused. A
  member renamed in a push keeps its object (the vendor's rename — GUID and class kept) when exactly one member of
  that kind was dropped and one added (`PushService.RenamePairs`); a same-name kind change is refused. A text written
  before the `%`-lines is refused on push ("re-pull: the text predates object properties", the binding's format
  version), because it would push "not excluded" over an excluded object.
- **CONTENT travels as `Content` over the vendor's own object model; STRUCTURE travels on the tree.**
  `IVendorStore.Read`/`Write` reach declarations and textual bodies through the vendor's aspects and graphical bodies
  as typed node trees (CODESYS) or TwinCAT's own NWL archive text (N42) — there is no document to splice and no
  import to re-place items after. Folder membership, rename and move are not properties of an item's content, so they
  stay on `IVendorTree` (`Sync/TreeNav`), where a rename is the IDE's own (TwinCAT rewrites the call sites, CODESYS
  does not — DIALECT C2p). A task is the sharp case — it is placed by KIND rather than by folder name, because the
  vendor names its container in the installation's LANGUAGE: the container `Classify` says TAKES the kind
  (`NodeClass.Takes`, `TreeNav.ResolveDedicatedParent`, DIALECT C22).
- **A DECLARATION is handed to the vendor VERBATIM — nothing re-emits one from parsed fields.** The path is
  `StReader` → `ItemContent.Declaration` → `PushService` → the driver's declaration aspect, and not one step in
  it reassembles the text — and **a top-level item's header is not even read** (openspec
  `push-without-header-check`): its kind is its wire name's extension, so the header is never parsed, never checked
  against the extension and never a reason to refuse. A DUT or a GVL is not read at all; a POU or an interface is
  read for its `%LANGUAGE` line and its CHILD elements, whose signature line is the only place a member's name
  exists (a child whose header cannot be read is refused naming the item and the line). A mistake in the text is
  the IDE build's to report. It is the rule to refuse any future "normalize the header" on sight. **Two exceptions, and they are the whole
  list:** an ACTION's header is SYNTHESIZED (`ACTION <name>`, because IEC gives an action a name and a body and
  nothing else, so there is no declaration to read), and a property's accessors are framed with `GET`/`END_GET`.
  Trailing NEWLINES are kept: both vendors store them (DIALECT C35), so the text between boundaries is the vendor
  text VERBATIM plus exactly one separator newline, which is all the reader strips.
- **What a pull writes, a push must send back unchanged:** `StWriter.Write(StReader.Read(x)) == x`, for every
  file, byte for byte. A workspace file IS the writer's output and a push feeds it straight back to the reader,
  so this identity is the whole guarantee that pull-then-push is a no-op — and every byte the pair disagrees on
  is a byte an engineer's project silently loses or gains. It is gated by
  `test/Volt.Engine.Tests/format/st/StFixedPointTests.cs`, over committed fixtures always and over whole
  customer projects when `VOLT_CORPUS` names a corpus root. **Necessary, not sufficient:** the writer never
  emits `Member.Name`, `ReturnType` or `DataType`, so a change to the signature parsers needs its own field
  assertions — and a member-level boundary move (which side of the line a comment falls on) is byte-identical by
  construction, so those need structural assertions too. Both kinds live in that same file.
- **The DECL/IMPL boundary is STATED in the file: the property line `%LANGUAGE <LANG>`** (`Format/St/PropertyLines.Language`,
  one of `PropertyLines`' closed keys, so there is one `%`-line grammar; the LSP mirrors it in
  `src/frontend/syntax/format/language-line.ts` and `object-properties.ts`). It stands between a declaration and its body
  on exactly the kinds `ItemKind.ShapeOf` gives a body (POU, method, action, property getter and setter; a
  DUT/GVL/interface has none), it is the body's FIRST `%`-line (the object's own property lines follow it), and it
  states the body's language, ST included — the ONE signal for how the body is read: `ST` by the ST path, `LD`/`FBD`
  as network text. It is matched as a whole line outside every comment (the key in upper case, the language words in
  any case), and a missing or unknown language, a second line, or a body that contradicts its language is refused by
  name. A METHOD or GET/SET whose IDE object has NO body slot (DIALECT C2n, CODESYS's abstract-member class) has no
  line and nothing after its declaration — its property lines close the declaration, as an interface member's do;
  `BodyFormatGuard` judges such a member against the live object. It replaced an INFERRED boundary (last `END_VAR`, the
  end of a wrapped `EXTENDS`/`IMPLEMENTS` header, rules about which trailing comments and pragmas belonged to which
  side) — every one of those rules was written after a bug. A file holding the retired `IMPLEMENTATION <LANG>` line
  is refused naming `volt pull`.
- **Volt shows ST, FBD and LD; every other body is `%LANGUAGE <LANG> UNSUPPORTED`** (`PropertyLines.UnsupportedLine`). CFC,
  SFC and IL always; an LD/FBD body when network text has no spelling for what it holds, or when network text is
  off in the build (`NetworkTextSwitch`, `VOLT_GRAPHICAL=1`). Nothing is shown under the line, the item's
  DECLARATION stays editable and pushes as usual, and a push never writes the IDE's body
  (`PropertyLines.Written`, on both vendors' writers) — so a hidden body blocks neither pull nor push and
  nothing the IDE holds is overwritten. IL is in this set for a reason worth keeping: being textual, it once
  materialized as its raw source, so the engineer got an editable-looking file and the next push rewrote their IL
  body as ST.
  Detection is the driver's: it states each body's language as a vendor FACT (`Item/StatedLanguage`, openspec
  `bridge-refusal-review` D6), and `BodyFormatGuard` judges a push by that fact, never by decoding the incoming text.
- **Execute boxes round-trip as network text `EXECUTE … END_EXECUTE`** holding their ST verbatim (`Format/Network/NetworkTextReader`) — never a bare call that drops the ST.
- **Container managers are folders, never items** (`Item/ItemKind.IsContainerManager`) — no
  `<Manager>.<kind>` stub of their own.
- **Property accessor shape round-trips byte-identically** — GET-only / SET-only / GET+SET preserved on both
  bridges. **Presence is the object**: an ABSENT accessor (`null`) is kept distinct from a present-but-bodiless
  one, which is what lets a push drop a getter. `PushService.ReconcileAccessor` creates and deletes them; the
  drivers only write into one that exists. Whether an accessor is the GET or the SET is the vendor's own member
  (CODESYS `IsGetAccessor`), never the accessor's name; one that answers none is refused by name. An INTERFACE
  property's accessor holds a declaration and no body: CODESYS writes the declaration (D41); TwinCAT COM can
  hard-crash the IDE on that write (D21), so TwinCAT writes none — its IDE stores the constant `PUBLIC` / `VAR` /
  `END_VAR`, read from the saved `.TcIO` and spelled as the EMPTY declaration CODESYS holds, so the same interface
  pulls the same text on both (`test/shared/WireParityCases.cs`); any other stored text refuses the interface by
  name, and a pushed non-empty declaration is refused on TwinCAT.
- **Referenced-library signatures materialize under the Library Manager** — one canonical `.library` manifest per
  library (`Library/LibraryManifest`); a fetch adds each element's declaration-only signature as a read-only item
  beside its library's manifest, re-extracted only when a walked `.library` changed (`FetchService`). Signatures are
  never in `refs`, so never in `projectVersion`. Both vendors extract them: CODESYS from the precompiled signatures
  after a build (`CodesysObjectModel.Libraries.cs`), TwinCAT from `_ITcPlcLibraryManager.ProduceAllLibrarySignatures()` out-of-process
  (`TcLibrarySignatures`, DIALECT C2c).
- **What round-trips, and what is refused instead** — push→fetch returns byte-identical `sourceText` at the same path
  for every member the text spells, and an **emptied body is cleared, not silently retained**. That is the
  completeness oracle's claim (`scripts/completeness.ts`, openspec `bridge-one-to-one` 2.1: vendor object → text →
  push into a blank copy → re-read reproduces every non-cache member, an undecided member fails by name) — not
  "lossless": what the text does not spell is either a measured cache, refused by name (listed `unreadable` on pull,
  `UNSUPPORTED` on push), or a named known divergence (`scripts/completeness.known.ts`; CODESYS's stored member and
  sibling order, DIALECT C34, is the owner's open decision). The same object gives the same text on both vendors —
  gated offline by `test/shared/WireParityCases.cs` on both drivers' doubles and live by `test/e2e/vendor-parity.test.ts`:
  a stub manifest is `ItemKind.EmptyManifest` on both, a library's `SYSTEM` line is spelled only where CODESYS holds
  it true (TwinCAT states no such member, C37). A vendor divergence is a parity defect.
- **Skipped/errored items are logged, never silently dropped** (`Volt.Contracts/VoltLog`) with `name` + reason.
- **The wire is a local named pipe, never a network socket** — there is no listening port and no browser-reachable
  surface, so a web page can't drive `push`.

## A bridge — three parts (`Codesys` / `Beckhoff`)

Both bridges share one shape, so the roles line up. The `Driver/` facets are **thin facades** holding no vendor
state — they delegate every real IDE touch to a single **gateway** and every cross-thread call to a **dispatcher**,
both in `Ide/`.

```
PipeHost.cs / WorkerStart.cs  entrypoint  — serves the host as a HostLink through the shared BridgePipeHost
Driver/                       contract    — implements Seam's IVendorDriver, split by facet (.Seam / .Tree / .Content)
Ide/                          vendor glue — the gateway + dispatcher that talk to the live IDE
```

Note the naming: **Engine `Seam/` is the contract; a bridge's `Ide/` is the live-IDE access behind it; the bridge's
`Driver/` is the bridge between them.**

| Role | CODESYS | Beckhoff | Notes |
|---|---|---|---|
| Entrypoint | `PipeHost.cs` | `Program.cs` + `WorkerStart.cs` | CODESYS: `PipeHost.Start()` called in-proc by the IDE's IronPython script command. Beckhoff: standalone exe; spawns its STA thread, starts degraded, attaches when TwinCAT appears. Both refresh health on the IDE thread right after connecting (`HostLink.RefreshHealth`). |
| Driver — contract | `Driver/CodesysDriver.Seam.cs` | `Driver/BeckhoffDriver.Seam.cs` | the `VendorDeclaration` and the contract's tree and store words over the host's own IEC tree and record (`FamilyContent`). |
| Driver — session | `Driver/CodesysDriver.cs` | `Driver/BeckhoffDriver.cs` | facade: connect / probe / build. |
| Driver — tree | `Driver/CodesysDriver.Tree.cs` | `Driver/BeckhoffDriver.Tree.cs` | walk/lookup/CRUD algorithm. CODESYS classifies by object-model interface names; Beckhoff by native `ItemType`. |
| Driver — content | `Driver/CodesysDriver.Content.cs` | `Driver/BeckhoffDriver.Content.cs` | the IEC record in and out: declaration, body, members, accessors. CODESYS writes through aspects and builds graphical bodies as typed `NWLObject` trees; Beckhoff writes text, edits the NWL archive in place and BUILDS a changed network (or a new body) as TwinCAT's own archive (`TcArchiveBuilder` + `TcArchiveWriter`, DIALECT N42). Neither writes PLCopen. |
| Access gateway | `Ide/CodesysObjectModel.*.cs` (+ `CodesysTypeMap.cs`, `Reflection.cs`, `NwlInterop.cs`) | `Ide/TcObjectModel.*.cs` (+ `RotInstances.cs`, `TcArchive.cs`, `TcItemArchive.cs`) | holds ALL vendor state + the only `reflection`/`dynamic` in the bridge. |
| Graphical body | `Ide/CodesysNetworkReader.cs` / `Writer.cs` | `Ide/TcNetworkReader.cs` / `Writer.cs` | `NetworkModel` ⇄ the vendor's own form. CODESYS: live typed objects through `NwlInterop`. TwinCAT: the `<NWL><XmlArchive>` through `TcArchive`, edited in place and never constructed (DIALECT N4). |
| Thread dispatcher | `Ide/CodesysDispatcher.cs` | `Ide/StaDispatcher.cs` (+ `ComMessageFilter.cs`) | CODESYS delegates to the IDE's `InvokeInPrimaryThread`; Beckhoff owns + pumps an STA thread via a `BlockingCollection`. |

### Load-bearing asymmetries — don't "unify" these

These are irreducible differences between how the two IDEs are reached, **not** drift to be refactored away:

- **Hosting.** CODESYS = net48 library loaded *in-process* by reflection (no compile-time refs → loads in any
  3.5.x); Beckhoff = net10 exe *attaching* to a separate XAE over COM. This dictates each `Ide/` layer. And it
  dictates packaging: the CODESYS bridge ships as ONE assembly, `Volt.*` and `System.Text.Json` (with its net48
  dependencies) merged in and internalized at build (the csproj's `VoltBundle` target, ILRepack), because anything
  it left to resolve would be resolved inside `CODESYS.exe` by whichever `AssemblyResolve` handler answers first
  (DIALECT V6). The TwinCAT worker is its own process with ordinary probing, so it ships its folder as built.
- **How a graphical body is reached — and this one is ACCESS, not model.** The two vendors ship the SAME
  `NWLObject` model, member for member (DIALECT N1). CODESYS hands over the live objects, so its writer builds a
  typed tree and a wrong member name throws. TwinCAT hands over the serialization (its Automation Interface
  exposes no NWL object, N39), so its writer edits the archive in place, and builds what changed as TwinCAT's own
  archive text — a wrong member SET would corrupt silently, which is why the builder takes every member list from
  archives TwinCAT wrote and the writer must first reproduce every one of them byte for byte (the identity gate,
  `TcArchiveIdentityTests`; DIALECT N42). The model each builds from is the same `NetworkModel`; the box's output
  names and types come from the engine's one derivation (`NetworkMembers.Buildable`) on both.
- **Beckhoff's tree walk keeps per-node `try/catch`** (skip a child that faults mid-walk) where CODESYS's doesn't
  — cross-process COM throws far more readily than the in-proc object model. That defensive catching is part of
  the walk; don't strip it for symmetry.
- **Beckhoff opens a PLC tree child only through `TcObjectModel.ChildAt`, behind a Solution Explorer snapshot**
  (DIALECT C2i). After a load, touching the tree item of a POU whose text the IDE does not read as a POU kills
  TcXaeShell, so no `try` can guard it. Each operation reads the VS hierarchy once (`TcSolutionExplorer`, ~0.1 s;
  dropped at the start of every op and after a structural write while something is flagged): a `.TcPOU` node
  captioned with its bare name is UNTOUCHABLE. Fast path (nothing flagged — every real project): plain `Child[i]`.
  A folder holding one is addressed by name, and the flagged child answers `UnreadableItemException` without a COM
  call — the walk names it in `unreadable` (`UnreadableObject.Kinds` = the POU kinds, so its folder stays walked and
  its known file is kept), `ItemLookup` skips it for other names and refuses it by name, and a forced push deletes
  it through the parent (a set then recreates it in the same folder). An unreadable hierarchy fails the op —
  there is no unguarded walk. The snapshot must VOUCH for what it clears: a node inside the PLC project with a
  failed read (name, caption, canonical name, child list) refuses the op by name; the PLC project and every PLC
  folder outside a POU must be listed with exactly the tree's child count (`ChildCount` checks it, so a short or
  lazily-filled hierarchy refuses that folder — unwalked — before a child of it is opened); and a POU flagged once
  in a worker session stays untouchable after its caption heals, until Volt deletes it through its parent (a repair
  in the editor keeps the tree item that was loaded broken; unmeasured whether that one is safe). CODESYS reads such
  a POU in-process without harm and has no snapshot.

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
is REACHED — they live below the `IVendorDriver` seam (and the pipe topology below `IProjectSource`). The wire
behavior and error codes are identical across vendors by construction:
- **Parity-critical decisions live in Core, once.** A choice a pipe client can observe — a `connect` post-condition,
  the not-connected precondition on project-ops, an error mapping — is decided in `Volt.Engine.Host/BridgePipeHost`, delegating
  only irreducible primitives (attach, tree-walk, code r/w) to the driver. The drivers can't diverge these; they
  don't own them. (E.g. a `connect` that can't attach the project, and any project-op on a not-connected bridge,
  both refuse with the shared `PLC_DISCONNECTED` on either vendor — the check is in Core, not per driver.)
- **One error channel:** only `BridgeException`/`BridgeErrorCodes` cross the wire; a driver must not leak a
  vendor-specific exception type as an expected condition.
- **Enforced by a guard:** `VendorParityGuardTests` fails the build if a vendor string literal appears in Core code
  (`Volt.Engine`). Comments may still explain a vendor's dialect — `Ide/DIALECT.md` is where those live — but no
  `vendor == "twincat"` branch may live above the pipe.

A host supplies primitives only (`Seam/IVendorDriver`); the conformance suite over both drivers is
`test/shared/WireParityCases.cs` offline and the contract suite over the pipe (`test/e2e/contract`).

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
   (`ComposedSession.IsConnected` + `ServedProjectName`, the host's live reads), never from `BuildHealthResponse()` — health is served from a
   per-vendor **throttled cache**, and deciding a write against it refused pushes on stale state while reads of the
   same bridge succeeded. If two code paths answer the same question from different sources, that is the bug.
4. **Never swallow a background failure.** `ComposedSession`'s health probe stays best-effort for the *request* (a probe
   failure must not fault `health`) but logs and marks degraded. A bare `catch` there once left health repeating a
   stale "nothing serving" indefinitely with no log line to read.
5. **One error channel, one log path.** Only `BridgeException`/`BridgeErrorCodes` cross the wire — a driver must not
   leak a vendor exception. All logging goes through `Volt.Contracts/VoltLog`.
6. **Parity-critical decisions live in Core, once.** Anything a pipe client can observe is decided in
   `Volt.Engine.Host/BridgePipeHost` or a `Sync/` service; drivers supply only irreducible primitives (attach, walk, code r/w).
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
11. **Resolve the object you NAMED, never the first match under it.** A document-shaped read returns a POU *and
    its children*, so `Descendants("FBD").FirstOrDefault()` can return a METHOD's body — and the write then puts
    the root's body into it, destroying the method's. That mistake appeared FIVE times: three in the graphical
    splice, once in the declaration read, and once where a declaration write took the FIRST
    `InterfaceAsPlainText` under an item — which on a POU with declared variables is the copy nested inside the
    typed `<interface>`, so the write was accepted and changed nothing. The document layer that hosted all five
    is deleted, and the rule outlived it: **address the object, never search under it.** `IVendorStore` takes an
    `ItemRef` per item and `WriteMembers` resolves each member by NAME from one map.
12. **A bare name is not a path.** The wire and the workspace key an item by its path (`Folder/Foo.pou`); below the
    seam the IDE's key is the bare name (`Foo`). `IdeTree` once matched a set of NAMES against PATHS, so an item
    deleted in the IDE never left the workspace unless it sat in the project root — and the one test covering it
    used a root item. If a set crosses that boundary, convert at the boundary (`ItemPath`) and name the variable for
    what it holds.
13. **One object never fails the walk — so a classifier may refuse, and must not guess.** `RefinePou` once had to
    return a code for every input, because the CODESYS tree walk's `try/catch` wrapped only `GetChildren` and a
    throw aborted `WalkItems` and with it every fetch/refs/init/push for the project — and "a code for every input"
    meant a guess (`FUNCTION_BLOCK` for a text it could not read). Both are gone: a POU is one kind by its class, and
    the walk now guards each child's classification (`CodesysDriver.Tree`, matching the TwinCAT walk), naming an
    object whose kind cannot be read unreadable with its folder and counting that folder as not fully read. So a
    classifier refuses by name instead (`CodesysTypeMap.AccessorCode`: an accessor's GET/SET is the vendor's
    `IsGetAccessor`, never its name). What the guard must NOT catch is a binder failure (a missing member, an
    ambiguous overload): it would hit every object and answer a successful walk with all of them unreadable, so it
    fails the operation by name. A member-signature parser (`StReader.ParseSignature`) throws by design.
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

See `README.md` for commands. In short: `dotnet build Volt.sln`; the C# unit tests
(`test/Volt.Engine.Tests/`) run offline against a fake IDE, and the TS e2e tests (`test/e2e/`) drive a live
bridge over the pipe; the CODESYS dev loop is `scripts/ide.ps1` (the TwinCAT worker is spawned
by the connector).

## Reading a vendor API instead of guessing at it

Twice now a HIDDEN ARGUMENT has cost real debugging time, and both times the answer took minutes once the API
surface was read properly:

- `ProduceXml()` was called with no argument, which returns an item's METADATA and none of its children. An
  interface therefore came back with no `<Property>` elements, and a property's accessors were unreadable. The
  member takes a `recursive` flag; nobody had looked.
- `ITcPlcOpenImportExport2.PlcOpenExport2` was assumed to take an options flag that would bring back a missing
  export block. It takes `bSubTree`. The assumption would have sent the fix down the wrong path entirely. (That
  transport is deleted; the lesson is why this section exists.)
- **Half of `ITcPlcImplementation` was never used.** Volt read `ImplementationText` and inferred the rest, while
  `ImplementationXml`, `Language` and `ITcPlcPou.DocumentXml` sat on the same objects untouched — see the
  measurements below, and DIALECT N3/N7.

**TwinCAT — the type library IS the authoritative surface, and it is importable.** `TlbImp.exe` ships with the
Windows SDK:

```
TlbImp.exe "C:\TwinCAT.1\Components\Base\TCatSysManager.tlb" /out:TCatSysManagerLib.dll /silent
```

Reflecting over the result gives every interface, method, parameter name and type, OFFLINE — no running IDE, no
trial-and-error against a live project. That is how these were settled:

```
ITcPlcOpenImportExport2   PlcOpenExport2(bstrFile, bstrSelection, bSubTree)   <- bSubTree, NOT options
ITcPlcPou                 DocumentXml {get;set}   ReturnType {get;set}
ITcPlcImplementation      ImplementationText | ImplementationXml | Language
ITcPlcDeclaration         DeclarationText, and NOTHING else
```

**And the type library is necessary but not sufficient — READ IT, THEN MEASURE IT.** All three
`ITcPlcImplementation` members are in the TLB; against a live POU only two answer. `Language` throws
`RuntimeBinderException` — the interface declares it, this object does not implement it — and `ImplementationXml`
returns byte-for-byte the same string as `ImplementationText`, not a second representation. Reading the surface
tells you what to try; only the running IDE tells you what is there (measured live, DIALECT N3).

That last line is worth keeping: Beckhoff's own object model encodes the fact that **an ACTION has no
declaration**, which this repo previously learned the hard way. When a vendor fact and a Volt assumption
disagree, the type library is the tiebreaker.

**TwinCAT's PLC ENGINEERING assemblies are also plain .NET, and they are the authority for the native body
model.** `C:\TwinCAT.1\Components\Plc\Common\*.dll` — `Assembly.LoadFrom` + reflect, no TLB step:

```
NWLObject.dll   (_3S.CoDeSys.NWLObject, v3.5.13)   the FBD/LD network model
    IFlags            Negation, Set, Jump, Return, Rtrig, Ftrig   <- the per-node bit-field
    NWLDisplayMode    LD=0, FBD=1, IL=2
    TypeHandlingMode  Embedded, Declaration, PreferEmbedded, PreferDeclaration
PLCopenXML.dll  the export/import
CFCEditor.dll   CFC
```

Note the assembly is a **3S** one shipped inside TwinCAT — the shared CODESYS ancestry, visible in the binaries.

**Reflect FIRST; use a differential only for what reflection does not name.** `Flags` in the NWL archive was
decoded the hard way (toggle one PLCopen attribute, re-import, diff the native) before anyone looked in
`NWLObject.dll`, which names every bit. The two agreed — the measurement proved the encoding is live, the
assembly named it — but the reflection would have been minutes.

**CODESYS — reflect over the plugin assemblies** (`ScriptDriver*.plugin.dll`), tolerating
`ReflectionTypeLoadException` and reading `ex.Types`. That is how `CreateNativeXmlExportService` /
`CreateNativeXmlImportService` were found alongside the PLCopen pair — after this repo had asserted in writing
that CODESYS had no native transport at all. For anything script-facing the faster route is a throwaway
`--runscript` probe that prints `dir(obj)`.

**Probing a live IDE.** TwinCAT is reachable over the COM ROT from PowerShell
(`Marshal.GetActiveObject('TcXaeShell.DTE.15.0')`). Two traps, both hit in practice.

**A modal dialog stalls the bridge — but NOT a simple probe, which is what makes it so easy to mis-diagnose.**
Measured 2026-09-03 against a live TcXaeShell with a modal up (`#32770` "Open Project", and separately the WPF
`Help > About`): `GetActiveObject` bound in 4 ms and `Solution.FullName` answered in 5 ms — the dialog pumps its own
message loop, so a hand probe says everything is fine. The same modal, left open across a real run, timed out every
test in the suite at 60 s and made the connector's ROT walk exceed a 6-second budget. So *"a modal blocks every COM
call"* — what this said before — is wrong twice over: it does not block the calls a prober reaches for, and it does
block the work that matters. **Verify a modal by running actual bridge ops, never by reading a DTE property**, and
expect the connector to name the dialog in its log (`ProbeDiagnosis`).

**An XAE that started WITHOUT loading its solution** answers happily while `Solution.FullName` is empty and
`Projects.Count` is `0` — check that before trusting anything a probe or an e2e run reports.
## Related docs

`docs/` is a small static site — open `docs/index.html` in a browser; it needs no build step and no server.
Every table of facts on it (the wire ops and schemas, the error codes, the item kinds, the driver members) is
GENERATED from these types by `test/Volt.Engine.Tests/docs/DocDataTests.cs` and gated against them, so a doc
that disagrees with the code fails the build. Regenerate with
`VOLT_WRITE_DOCS=1 dotnet test test/Volt.Engine.Tests`.

| page | covers |
|---|---|
| `docs/index.html` | The two layers, the session shape, how to serve a bridge. |
| `docs/wire.html` | Transport and framing, identity and versions, the error codes, all eight ops, every schema. |
| `docs/driver.html` | `IVendorDriver` — the layer to reuse outside Volt. |
| `docs/items.html` | The item-kind table (`Item/ItemKind` is the source of truth) and the file-extension registry. |
| `docs/network-text.html` | The FBD/LD graphical sublanguage: grammar, statement forms, the gate, the diagnostics. |
| `docs/logs.html` | The durable log, the drop tallies, and diagnosing a live bridge. |
| `docs/volt-bridge.openrpc.json` | The wire as a conformant OpenRPC 1.2.6 document — the artefact to hand to another project. |
