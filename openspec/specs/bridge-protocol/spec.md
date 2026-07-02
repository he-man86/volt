# bridge-protocol Specification

## Purpose
TBD - created by archiving change review-bridge-protocol. Update Purpose after archive.
## Requirements
### Requirement: Exclude-from-build is a per-item wire flag

The bridge SHALL report, per item on both `/refs` and `/fetch`, whether the item is **effectively
excluded from build** — whether the IDE will compile it, accounting for inheritance (an item whose
parent folder is excluded from build is itself excluded). CODESYS SHALL derive this from the object's
`effectively_excluded_from_build` state. The field is additive and optional — absent means `false` —
and both vendor bridges SHALL serve it identically for the same project state. A bridge that cannot
determine it SHALL report `false` (fail-open: an item we cannot classify is treated as built and is
never silently hidden). A vendor without a build-exclusion concept SHALL report `false`.

#### Scenario: An excluded item is flagged, inheriting folder exclusion
- **WHEN** an item — or its containing folder — is excluded from build in the IDE
- **THEN** that item reports `excludeFromBuild: true`, and a built sibling reports `false`

#### Scenario: Unknown or unsupported state falls open
- **WHEN** the bridge cannot read the state, or the vendor has no such concept
- **THEN** the item reports `excludeFromBuild: false` and is treated as built

### Requirement: The item name is the wire identity

The bridge wire SHALL key every operation by the **full** item name — the bare IEC name plus its
kind-based extension (e.g. `PLC_PRG.prg`, `FB_Motor.fb`, `Recipe.struct`) — across `/refs`
(`items`/`folders`), `/fetch` `knownItems`, and every push op, mirroring the "one item per file"
workspace layout. Item **kind** is not carried on the wire for source items; the bridge recovers it
from the file content on push. Exclude-from-build IS carried on the wire, as a per-item boolean (see
"Exclude-from-build is a per-item wire flag"). There is no read-only wire field and no read-only
content marker: graphical CFC/SFC bodies carry only a non-semantic informational marker, and read-only
enforcement is the bridge's live IDE state (see the push requirement). The aggregate `structureVersion`
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

