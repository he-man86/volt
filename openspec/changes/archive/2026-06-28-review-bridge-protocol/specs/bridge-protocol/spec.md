## ADDED Requirements

### Requirement: The item name is the wire identity

The bridge wire SHALL key every operation by bare item name — `/refs` (`items`/`kinds`/`folders`),
`/fetch` `knownItems`, every push op, `structureVersion` (a hash of the sorted names), and the
"one item per file" workspace layout. The system SHALL NOT reject duplicate names: same-name items
collapse last-write-wins. This is acceptable because IEC guarantees unique names for source items,
and only opaque non-source items (which the AI never edits) can collide.

#### Scenario: Duplicate opaque names do not throw
- **WHEN** a project contains two non-source items with the same name (e.g. a per-application `Library Manager`)
- **THEN** `/refs` succeeds and the items collapse last-write-wins — no "duplicate name" error is raised

#### Scenario: Structure version is the hash of sorted names
- **WHEN** the set of item names is unchanged
- **THEN** `structureVersion` is unchanged, regardless of vendor

### Requirement: Both vendor bridges serve byte-identical responses

The parity boundary SHALL be the HTTP wire, not the driver. The CODESYS and TwinCAT bridges SHALL
return byte-identical responses — including identical content hashes (`Hasher`) — for the same
project, even though one is an in-process net48 library and the other a standalone net8 COM client.

#### Scenario: Same project, same bytes
- **WHEN** the same project is served by the CODESYS bridge and the Beckhoff bridge
- **THEN** the wire responses and per-item content versions are identical

### Requirement: Push is one declarative set/delete wire

A push SHALL be a flat list of `set` / `delete` ops keyed by item name, each carrying an
`ifVersion` optimistic-concurrency guard; the bridge reconciles the IDE to match and applies the
batch atomically. Read-only items (`.cfc`/`.sfc`/opaque config kinds) SHALL be refused.

#### Scenario: A read-only item is refused
- **WHEN** a push includes a `set` for a `.cfc` or `.sfc` item
- **THEN** the bridge refuses the op rather than writing it to the IDE

### Requirement: A vendor bridge implements exactly one contract seam

A vendor bridge SHALL implement only `IIdeDriver` (`IIdeSession` + `IProjectTree` + `ICodeStore`);
everything above it lives in shared `Volt.Bridge.Core`. The load-bearing CODESYS↔Beckhoff
asymmetries behind that seam (in-proc reflection vs. standalone COM, in-memory vs. file-based
PlcOpen, `TcPouReader`, per-node `try/catch` walk) are intentional and SHALL NOT be unified.

#### Scenario: Shared logic stays vendor-neutral
- **WHEN** a new endpoint or materialization rule is added
- **THEN** it is implemented once in `Volt.Bridge.Core`, not duplicated per vendor
