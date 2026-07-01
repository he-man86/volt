# bridge-protocol Specification

## Purpose
TBD - created by archiving change review-bridge-protocol. Update Purpose after archive.
## Requirements
### Requirement: The item name is the wire identity

The bridge wire SHALL key every operation by the **full** item name — the bare IEC name plus its
kind-based extension (e.g. `PLC_PRG.prg`, `FB_Motor.fb`, `Recipe.struct`) — across `/refs`
(`items`/`folders`), `/fetch` `knownItems`, and every push op, mirroring the "one item per file"
workspace layout. Item **kind** is not carried on the wire for source items; the bridge recovers it
from the file content on push. Read-only status is likewise not a wire field — it is self-describing
in the materialized content (a read-only graphical POU's body begins with `READONLY <LANG>`; see the
push requirement). The aggregate `structureVersion` and
`projectVersion` hash the sorted **bare** names (extension stripped), so they stay vendor-neutral and
are unchanged by the kind-based naming. The system SHALL NOT reject duplicate names: same-name items
collapse last-write-wins. This is acceptable because IEC guarantees unique names for source items,
and only opaque non-source items (which the AI never edits) can collide.

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
batch atomically. Read-only items SHALL be refused — but read-only is NOT inferred from the extension
(POUs are named by kind, so a read-only CFC/SFC POU and a writable one share a `.fb`/`.prg`/`.fun`
extension). Instead the bridge SHALL refuse a `set` on a read-only item by its **live IDE state**
(a CFC/SFC body, or an opaque config kind) — as it also refuses a textual push over an item that is
graphical in the IDE. The materialized content self-describes read-only (a `READONLY <LANG>` body
marker) so clients can predict the refusal, but the bridge's live state is the enforcement.

#### Scenario: A read-only item is refused by its live state
- **WHEN** a push includes a `set` for an item that is read-only in the IDE (a CFC/SFC POU or an opaque config kind)
- **THEN** the bridge refuses the op rather than writing it to the IDE, regardless of the file's extension

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

