# bridge-protocol Specification

## Purpose
TBD - created by archiving change review-bridge-protocol. Update Purpose after archive.
## Requirements
### Requirement: The bridge omits build-excluded objects and returns everything else

The `/refs` and `/fetch` responses SHALL omit objects the IDE will not compile — excluded-from-build (accounting for folder inheritance) — entirely: absent from `changed`, `items`, and the aggregate versions. Such an object has no compiler ground truth, so delivering it would only produce false positives against code the toolchain itself never checks.

Everything else SHALL be returned as ordinary source, INCLUDING dead/uncalled code (a POU reachable from no task). The bridge SHALL NOT compute reachability, SHALL NOT expose an `omitDeadCode` (or equivalent) flag, and SHALL NOT carry `excludeFromBuild`, `deadCode`, or any ground-truth metadata field, nor write in-file markers — determining what is unreachable is the LSP's job (see `st-language-server` "Dead code is detected structurally and its diagnostics are config-gated"). Both vendor bridges SHALL behave identically for the same project state.

#### Scenario: An excluded-from-build object is not returned
- **WHEN** a project contains an object flagged "exclude from build" (or inside an excluded folder)
- **THEN** neither `/refs` nor `/fetch` lists it (no `changed` entry, no `items` version), and the response carries no `excludeFromBuild` field

#### Scenario: A dead (uncalled) POU IS returned as ordinary source
- **WHEN** a project POU is never called or instantiated from any task's program (dead code)
- **THEN** the bridge still returns it in `changed`/`items` like any other source item — no `deadCode` field, no omission, no flag required

#### Scenario: No fetch flag governs dead code
- **WHEN** any client fetches the project (verbose or not)
- **THEN** the response is identical with respect to dead code — there is no request flag that drops uncalled POUs

### Requirement: The item name is the wire identity

The bridge wire SHALL key every operation by the **full** item name — the bare IEC name plus its
kind-based extension (e.g. `PLC_PRG.prg`, `FB_Motor.fb`, `Recipe.struct`) — across `/refs`
(`items`/`folders`), `/fetch` `knownItems`, and every push op, mirroring the "one item per file"
workspace layout. Item **kind** is not carried on the wire for source items; the bridge recovers it
from the file content on push. Exclude-from-build is NOT carried on the wire: an excluded object is
omitted from the response entirely (see "The bridge omits build-excluded objects and returns everything
else"), so exclusion is an internal omission signal, never a per-item wire field. There is no read-only
wire field and no read-only content marker: graphical CFC/SFC bodies carry only a non-semantic
informational marker, and read-only enforcement is the bridge's live IDE state (see the push requirement). The aggregate `structureVersion`
and `projectVersion` hash the sorted **bare** names (extension stripped), so they stay vendor-neutral
and are unchanged by the kind-based naming. The system SHALL NOT reject duplicate names: same-name
items collapse last-write-wins. This is acceptable because IEC guarantees unique names for source
items, and only opaque non-source items (which the AI never edits) can collide.

#### Scenario: Duplicate opaque names do not throw
- **WHEN** a project contains two non-source items with the same name (e.g. a per-application `Library Manager`)
- **THEN** `/refs` succeeds and the items collapse last-write-wins — no "duplicate name" error is raised

#### Scenario: Structure version is the hash of sorted bare names
- **WHEN** the set of item names is unchanged
- **THEN** `structureVersion` is unchanged, regardless of vendor or file extension

### Requirement: Both vendor bridges serve byte-identical responses

The parity boundary SHALL be the HTTP wire, not the driver. The CODESYS and TwinCAT bridges SHALL
return byte-identical responses — including identical content hashes (`Hasher`) — for the same
project, even though one is an in-process net48 library and the other a standalone net8 COM client.

#### Scenario: Same project, same bytes
- **WHEN** the same project is served by the CODESYS bridge and the Beckhoff bridge
- **THEN** the wire responses and per-item content versions are identical

### Requirement: Push is one declarative set/deleteItem wire

A push SHALL be a flat list of `set` / `deleteItem` ops keyed by the full item name, each carrying an
`ifVersion` optimistic-concurrency guard; the bridge reconciles the IDE to match and applies the
batch atomically. Graphical CFC/SFC bodies SHALL be refused — but this is NOT inferred from the
extension or from any content marker (POUs are named by kind, and a graphical body carries only a
non-semantic informational marker). Instead the bridge SHALL refuse a `set` on a graphical body by its
**live IDE state** (`BodyLanguage` ∈ {CFC, SFC}, or an opaque config kind) — as it also refuses a
textual push over an item that is graphical in the IDE. The materialized informational marker is a
human/AI-readable hint only; the bridge's live state is the enforcement.

#### Scenario: A graphical body is refused by its live state
- **WHEN** a push includes a `set` for an item that is a CFC/SFC body (or an opaque config kind) in the IDE
- **THEN** the bridge refuses the op rather than writing it to the IDE, regardless of the file's extension or body content

### Requirement: A vendor bridge implements the core driver contract

A vendor bridge SHALL implement the core contract `IIdeDriver` (`IIdeSession` + `IProjectTree` +
`ICodeStore`), plus any optional capability seams it can serve (e.g. `IInstanceProvider`,
`IDebugIntrospect`) which the server feature-detects; everything above them lives in shared
`Volt.Bridge.Core`. The load-bearing CODESYS↔Beckhoff
asymmetries behind that seam (in-proc reflection vs. standalone COM, in-memory vs. file-based
PlcOpen, `TcPouReader`, per-node `try/catch` walk) are intentional and SHALL NOT be unified.

#### Scenario: Shared logic stays vendor-neutral
- **WHEN** a new endpoint or materialization rule is added
- **THEN** it is implemented once in `Volt.Bridge.Core`, not duplicated per vendor

### Requirement: The bridge materializes a namespace stub for every library in the dependency tree

The bridge's library-reference walk SHALL enumerate the FULL library dependency tree — the top-level
Library Manager entries AND their transitive dependencies (via `ILibManItem.GetDependencies()`) — and emit
a `.library` stub for each, carrying at least its `NAMESPACE`. Transitive dependencies (a library pulled in
by another, often `HideWhenReferencedAsDependency`) carry namespaces the source references directly (e.g.
`MEM` from CAA Memory), so omitting them leaves those qualified roots unresolvable. This walk SHALL be
build-free (it reads the library manager, not a compiled model) and part of the ordinary `/refs`/`/fetch`
response. Enumeration SHALL dedup by `(namespace, name)` to survive dependency cycles and multiply-referenced
libraries.

#### Scenario: A transitive dependency's namespace is materialized
- **WHEN** a project references a library that itself depends on `CAA Memory` (namespace `MEM`), and CAA Memory is not a top-level Library Manager entry
- **THEN** a `CAA Memory.library` stub with `NAMESPACE MEM` is emitted, so a source reference to `MEM.LowWord` resolves

#### Scenario: The dependency walk terminates on cycles
- **WHEN** the dependency graph contains a cycle or a library reachable via multiple parents
- **THEN** each library is emitted exactly once and the walk terminates

### Requirement: A verbose fetch returns full referenced-library element signatures

`POST /fetch` SHALL accept an optional `verbose` flag (default false). When set, the response SHALL
additionally carry every referenced-library element's public SIGNATURE — the declaration only, with real
member detail (FB/function `VAR_INPUT`/`VAR_OUTPUT`/`VAR_IN_OUT` pins and types, struct fields, enum
members, GVL vars, interfaces, and the `EXTENDS` base) — rendered as Structured Text with NO implementation
body. Each signature SHALL be pathed under its owning library's folder in the Library Manager
(`…/Library Manager/<LibraryName>/<Element>.<kind>`), matched to that library's `.library` ref by
RESOLUTION. System libraries SHALL be dropped (the LSP's floor is vendor libraries); compiler-mangled
(`__`-prefixed) and non-library entries SHALL be filtered. Extraction reads
`LanguageModelMgr.AllPrecompiledSignatures`; because a freshly-opened project's precompiled set is empty,
the bridge SHALL precompile first via a best-effort build (even a failing app build precompiles the
resolvable libraries). A vendor bridge that cannot extract SHALL return an empty signature set (documented
parity gap); TwinCAT returns none.

#### Scenario: verbose returns a library element's full signature
- **WHEN** a client fetches with `verbose: true` and a referenced library exposes `FUNCTION_BLOCK L_MC4P_MC_MoveAbsolute`
- **THEN** the response includes an item under that library's Library Manager folder containing the FB's declaration with its real input/output pins and types, and no body

#### Scenario: A normal (non-verbose) fetch pays no extraction cost
- **WHEN** a client fetches without `verbose`
- **THEN** no library element signatures are returned and no build is triggered (the transitive `.library` namespace stubs are still present, as they are build-free)

#### Scenario: A vendor without extraction returns none
- **WHEN** the vendor bridge (TwinCAT) cannot extract library signatures
- **THEN** a verbose fetch returns an empty library-signature set, keeping the wire shape identical

### Requirement: Library signatures are delivered as regular fetch items, not a separate field

The verbose `/fetch` response SHALL deliver referenced-library element signatures as ordinary items in the
`changed`/`items` set — each a normal fetch item (name, folder, read-only source text, version) — so a
consumer materializes them through the same path as any other file. The response SHALL NOT carry a bespoke
top-level `librarySignatures` field. Library signatures SHALL remain read-only (never a push target) and
SHALL NOT perturb `structureVersion` (they are excluded from the aggregate hash).

#### Scenario: A library signature arrives as a normal changed item
- **WHEN** a verbose fetch includes referenced-library signatures
- **THEN** each signature appears in `changed` as a regular fetch item (its rendered declaration as source text) foldered `…/Library Manager/<Library>/<Element>.<kind>`, and the response has no separate `librarySignatures` key

#### Scenario: A strict client parses the response without a schema addition
- **WHEN** a client with a strict `/fetch` response schema (no `librarySignatures` field) pulls a project that references libraries
- **THEN** the pull succeeds — the signatures materialize as files with no client schema change

### Requirement: Graphical Execute boxes round-trip as a first-class VG construct

The bridge SHALL materialize a CODESYS **Execute box** — the standard "ST inside FBD/LD" element (a PlcOpen
block whose `fbdcalltype` addData is `execute`, carrying its statements in an `STCode` addData) — as a
first-class VG `EXECUTE … END_EXECUTE` block holding the box's Structured Text VERBATIM, never as a bare
`EXECUTE()` call that drops the ST. The box's enable SHALL use the ORDINARY VG EN machinery (a wire + `IF en
THEN … END_IF`), not a special form. On push, the bridge SHALL reconstruct the CODESYS Execute box from that
VG construct — `<block typeName="EXECUTE">` + `fbdcalltype=execute` + the verbatim `STCode` — so the ST
round-trips byte-for-byte and the box is created/edited, not read-only.

#### Scenario: An Execute box renders its inline ST, not a call
- **WHEN** a client fetches an FBD program whose network contains an Execute box holding
  `IF cmd THEN target := 0; END_IF`
- **THEN** the materialized body contains `EXECUTE` … `END_EXECUTE` with that ST verbatim (its comments and
  nested `IF` preserved), EN-guarded by the box's enable wire, and no bare `EXECUTE()` call

#### Scenario: Pushing the EXECUTE construct recreates the CODESYS Execute box
- **WHEN** a client pushes an FBD body containing `IF en THEN EXECUTE <st> END_EXECUTE END_IF`
- **THEN** the bridge creates a CODESYS Execute box (`<block typeName="EXECUTE">` + `fbdcalltype=execute` +
  `<STCode>`) wired to `en`, and fetching it back yields the same ST verbatim (a stable round-trip)

### Requirement: The LSP analyzes an Execute box's body as Structured Text, not simplified VG

The LSP SHALL analyze an `EXECUTE … END_EXECUTE` block's body as full Structured Text — NOT the simplified VG
statement grammar (which would `VG_PARSE` on real ST: nested `IF`, comments, multi-statement). The block's ST
identifiers SHALL be resolved against the POU scope (so an undeclared reference is flagged and a declared one
is not) and SHALL be navigable (references / highlight / completion), rather than the block being opaque.

#### Scenario: Complex ST inside an Execute box is checked, not VG-parse-errored
- **WHEN** the LSP analyzes an FBD body whose `EXECUTE` block contains multi-statement, commented ST
- **THEN** it emits no `VG_PARSE` for that block; a reference to a declared variable resolves, an undeclared
  identifier is flagged, and the surrounding VG networks still analyze normally

### Requirement: Both bridges serve library data in one canonical shape

For the same concept, CODESYS and TwinCAT SHALL emit byte-identically-shaped library data on the wire: a
`.library` manifest in the single canonical form (`LIBRARY`/`NAMESPACE`/`RESOLUTION`/`PLACEHOLDER`/`SYSTEM`/
`DEPENDENCIES`). When a bridge can also extract library element signatures, they SHALL be the same `LibSignature`
records rendered by the one shared renderer. The vendor-neutral work (manifest format, rendering, foldering,
`(unresolved)` surfacing) SHALL live once in `Volt.Bridge.Core`; each driver SHALL contribute only its irreducible
vendor extraction, with no duplicated formatting/rendering logic.

#### Scenario: The library manifest is identical in shape across vendors
- **WHEN** each bridge materializes a referenced library's `.library` stub
- **THEN** both produce the canonical `LIBRARY/NAMESPACE/RESOLUTION/PLACEHOLDER/SYSTEM/DEPENDENCIES` manifest via
  the shared `LibraryManifest` builder — never a vendor-specific format

#### Scenario: Library element signatures are a documented TwinCAT limitation
- **WHEN** a TwinCAT project references a library
- **THEN** the bridge returns the library ref + manifest (name/namespace/resolution), but NOT its element
  signatures — the out-of-process automation surface does not expose the language model (see the change's
  research). CODESYS (in-process) does return them; when a future in-process TwinCAT path exists it SHALL reuse
  the same shared renderer. The gap is surfaced, never faked.

### Requirement: Property accessors round-trip identically on both bridges

A property's GET-only, SET-only, and GET+SET accessor shape SHALL round-trip byte-identically through both
bridges — no phantom accessor is synthesized (e.g. a `__SETVALUE` on a get-only property) and none is dropped.

#### Scenario: A GET-only property is not given a phantom setter
- **WHEN** a GET-only property is fetched and pushed back through the TwinCAT bridge
- **THEN** it round-trips as GET-only, with no synthesized `__SETVALUE`, matching the CODESYS result

### Requirement: The bridge advertises a wire-protocol version and clients refuse a mismatch

The `/health` response SHALL carry an integer `wireVersion` identifying the version of the HTTP wire contract
the bridge speaks — distinct from the human-readable `version` display string. A single `wireVersion` value
SHALL be the source of truth on each side (the bridge Core constant and the client wire-types constant), bumped
together only when the wire shape changes incompatibly. Both vendor bridges SHALL report the same `wireVersion`
for the same build (Core-level, parity-preserving).

A client SHALL read `wireVersion` before it relies on any other endpoint and SHALL refuse to proceed — with an
actionable error naming both versions and the remedy — when it does not equal the version the client speaks.
The client SHALL NOT attempt to interpret data from a bridge whose `wireVersion` it does not recognize, since a
shape mismatch produces silently-wrong results.

#### Scenario: A matching wire version proceeds normally
- **WHEN** a client calls `/health` and the reported `wireVersion` equals the version the client speaks
- **THEN** the client proceeds with `/refs`, `/fetch`, `/push`, and `/build` as usual

#### Scenario: A mismatched wire version is refused, not silently interpreted
- **WHEN** a client calls `/health` and the reported `wireVersion` differs from the version the client speaks
- **THEN** the client raises a `PROTOCOL_MISMATCH` error identifying the bridge's version, the client's version,
  and the remedy (update/restart the bridge or reinstall Volt), and does NOT read any other endpoint

#### Scenario: The two version constants cannot silently drift
- **WHEN** the repository is built or its integration is checked
- **THEN** an integration check fails if the bridge-side and client-side wire-version constants are not equal

### Requirement: The bridge recovers across project close/reopen and never reports a stale project as connected

The bridge's connection state SHALL track the currently-open project, not merely the IDE process. Liveness SHALL
be project-aware: when the IDE is running but the bound project has been closed, the bridge SHALL report the
`no-project` state and SHALL NOT report `connected` (nor a stale project name). When a project is reopened or the
user switches to the selected target while the IDE stays alive, the bridge SHALL re-resolve the project and
reconnect **without requiring the IDE to restart**. An IDE that is momentarily busy (mid-build, modal, reload)
SHALL surface as degraded-retry, distinct from both "connected" and a hard failure, so clients do not read
half-state. Both vendor bridges SHALL behave equivalently.

#### Scenario: A closed project is not reported as connected
- **WHEN** the IDE stays open but the bound project is closed
- **THEN** `/health` reports `no-project` (or degraded), never `connected` with the old project name

#### Scenario: Reopening a project reconnects without an IDE restart
- **WHEN** the user reopens the project (or switches to the selected target) with the IDE still running
- **THEN** the bridge re-resolves the project and returns to `connected` on its own, no IDE restart needed

#### Scenario: A busy IDE is degraded-retry, not a false connected
- **WHEN** the IDE is momentarily busy (a build, a modal dialog, a project reload)
- **THEN** the bridge reports degraded-retry and does not serve half-state to a pull/push

#### Scenario: Both vendors recover equivalently
- **WHEN** a close/reopen cycle runs against the CODESYS and the TwinCAT bridge
- **THEN** both recover to the correct attached project

### Requirement: Push/pull round-trips are idempotent and lossless

The bridge SHALL be idempotent and lossless across a pull/push round-trip. Fetching a project and writing it back
with no changes SHALL be a no-op (no item is reported changed that was not, and a push of the unchanged set
applies zero state-changing operations). Pushing an item and then fetching it SHALL return that item
byte-identical in `sourceText`, `folder`, and `name`, for every item kind — including editable graphical (VG)
bodies and boundary cases (an emptied body, a whitespace-only implementation, a declaration-only or
implementation-only item). Both vendor bridges SHALL satisfy this identically; a divergence is a parity defect.

#### Scenario: A no-edit round-trip is a no-op
- **WHEN** a client pulls a project and pushes it back with no local edits
- **THEN** the push applies zero state-changing operations and no item is reported as changed

#### Scenario: A pushed item returns byte-identical
- **WHEN** a client pushes an item's `sourceText` and then fetches that item
- **THEN** the fetched `sourceText`, `folder`, and `name` are byte-identical to what was pushed

#### Scenario: An emptied body is cleared, not silently retained
- **WHEN** a client pushes an item whose implementation body is now empty
- **THEN** a subsequent fetch returns the empty body (the prior content is not silently retained)

#### Scenario: Both vendors round-trip identically
- **WHEN** the same round-trip runs against the CODESYS and the TwinCAT bridge for the same project
- **THEN** both produce the same result; any difference is reported as a parity failure

### Requirement: Long operations stream progress on their own response

The bridge SHALL stream progress for a long operation (`/fetch`, `/push`, `/build`) on that operation's OWN
response when the client requests it via `Accept: application/x-ndjson` — not on a separate endpoint the client
must poll. When streaming is requested, the bridge SHALL respond with a stream of newline-delimited JSON:
zero or more progress frames `{"progress": {operation, done, total, phase}}` emitted as the operation proceeds,
followed by exactly one terminal frame — `{"result": …}` on success or `{"error": …}` on failure. Progress SHALL
be reported on the operation's OWN response (not a separate endpoint the client must poll), so it is inherently
correlated to that operation. When the total work is known up front (fetch item count, push op count) the frames
SHALL carry `done` and `total`; when the IDE exposes no granularity (a build) they MAY carry a phase message and
no fraction. When the client does NOT send `Accept: application/x-ndjson`, the bridge SHALL return the operation's
single JSON body unchanged (backward-compatible). Both vendor bridges SHALL stream identically (Core-level).

#### Scenario: A streaming client receives progress then a result
- **WHEN** a client sends `/fetch` with `Accept: application/x-ndjson`
- **THEN** it receives zero or more `progress` frames and then exactly one terminal `result` frame carrying the
  full fetch response

#### Scenario: A non-streaming client is unaffected
- **WHEN** a client sends `/fetch` without `Accept: application/x-ndjson`
- **THEN** it receives the current single JSON body, unchanged

#### Scenario: A known total yields a fraction; a build does not fabricate one
- **WHEN** the operation has a known total (fetch/push) versus none (build)
- **THEN** the progress frames carry `done`/`total` for the former and a phase message with no fraction for the latter

#### Scenario: A failure ends the stream with an error frame
- **WHEN** a streamed operation fails partway
- **THEN** the stream ends with a single `{"error": …}` terminal frame, not a truncated result

### Requirement: The bridge pushes project-change events over an event stream

The bridge SHALL push a `change` event to subscribed clients when the loaded project changes, so a long-lived
client reacts without polling. It SHALL expose an event stream — `GET /events` (Server-Sent Events) — that a
client opens once and on which the bridge emits a `change` event carrying the new change token (`structureVersion`
+ a content token) whenever the project changes, plus periodic keep-alives; the stream SHALL be served without
holding the marshalled IDE thread, and disconnected subscribers SHALL be cleaned up. The event wire SHALL be
identical for every vendor — HOW a change is detected (a native IDE event where the IDE exposes one, an internal
poll where it does not) is an implementation detail behind a single internal change source and SHALL NOT leak to
the wire. Detection SHALL be centralized in the bridge (one source, fanned out to all subscribers), never a poll
performed by each client. The surface is additive: a client that never subscribes is unaffected, and `/refs` /
`/fetch` remain the authoritative source of WHAT changed. A long-poll `GET /wait-change?since=<token>` MAY be
offered with equivalent semantics for clients that cannot consume SSE.

#### Scenario: A subscriber is pushed a change after an IDE edit
- **WHEN** a client is subscribed to `/events` and an engineer edits the project in the IDE
- **THEN** the bridge pushes a `change` event carrying the new token, without the client polling

#### Scenario: No event when nothing changed
- **WHEN** the project is unchanged
- **THEN** the bridge emits only keep-alives (no `change`), so a client performs no redundant refresh

#### Scenario: Detection differences do not leak to the wire
- **WHEN** the same edit is made against the CODESYS bridge (internal poll) and the TwinCAT bridge (native DTE event)
- **THEN** both push an identical `change` event — the wire is the same regardless of how the change was detected

#### Scenario: Detection is centralized, not per-client
- **WHEN** multiple clients are subscribed to `/events`
- **THEN** the bridge detects a change once and fans it out to all subscribers; no client polls the IDE

### Requirement: Container-manager nodes are folders, never items

A container-manager — a library manager, recipe manager, or visualization manager — SHALL be represented on the
wire as a FOLDER holding its children, and SHALL NOT be emitted as a tracked item. It groups its children (library
references, recipes, visualizations) and has no content of its own, so it produces no stub file beside the folder.
Both vendor bridges SHALL behave identically (the rule is enforced in shared Core, not per-driver), so a container
manager never materializes a `<Manager>.<kind>` stub. Because item wire identity is the bare name and opaque
non-source names may legitimately repeat, the changed-item set of a fetch SHALL contain at most one entry per full
name (matching the name-keyed version map), so a repeated name never materializes as two files.

#### Scenario: A library manager materializes as a folder, not a stub
- **WHEN** a project's Library Manager holds referenced libraries
- **THEN** the libraries materialize under a `Library Manager/<lib>/<lib>.library` folder and no
  `Library Manager.library_manager` stub file is emitted beside it

#### Scenario: The invariant holds for both vendors
- **WHEN** the same project structure is walked by the CODESYS and the TwinCAT bridge
- **THEN** neither emits a container-manager item — the folder + children representation is identical

#### Scenario: A repeated opaque name does not orphan a duplicate file
- **WHEN** two distinct opaque objects legitimately share a bare name at different folders
- **THEN** the fetch's changed set carries at most one entry for that full name, matching the version map — no
  second, orphaned file

