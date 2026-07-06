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

