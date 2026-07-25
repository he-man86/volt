# Code conventions — layer/exposure structure

## ADDED Requirements

### Requirement: An exposed shape mirrors its source, not a derived layer on top of it

A type, endpoint, or view that a layer exposes SHALL be the shape of its underlying source, carrying per-item state
ON the item, rather than a wrapper/aggregate/duplicate built on top. A layer earns its existence ONLY by adding
information, enforcing a boundary, or absorbing an irreducible (documented) asymmetry — never by re-packaging what a
source already provides. Fields that are computable from other fields on the same object, or from data a prior call
in the same flow already returned, SHALL be derived at the edge, not stored as a second copy.

This does not apply to a client-side DTO of a parsed response across a genuine process boundary (the `volt` CLI /
connector HTTP wire), nor to the load-bearing vendor asymmetries recorded in `ARCHITECTURE.md` — those are kept.

#### Scenario: Discovery folded into the ambient poll, not a separate op

- **WHEN** the connector needs both a bridge's liveness and the projects it can serve
- **THEN** one cache-served `health` op returns a flat, self-describing `projects[]` array (each row carrying
  vendor/status/serving/dirty), rather than a separate `instances` op or a nested `instances[].projects[]` tree
- **AND** no wire field is present that no consumer reads (e.g. `activeOp`, `ideAlive`, `platformVariant`)

#### Scenario: The control-plane view is the project array, with no wrapper or aggregate on top

- **WHEN** a frontend reads `GET /status`
- **THEN** it receives exactly the unified `projects[]` array, each row self-describing (serving/dirty/status)
- **AND** there is NO separate per-vendor bridge view and NO aggregate status word duplicating what the rows carry;
  a frontend derives a workspace's state from its own row, and the tray derives its colour internally

#### Scenario: A finding that is an irreducible asymmetry is kept, not "simplified"

- **WHEN** the audit encounters a per-vendor difference below the wire (CODESYS in-proc vs TwinCAT COM; per-pipe vs
  one-worker discovery) that resembles redundancy
- **THEN** it is recorded as `keep` with the reason, and is NOT collapsed — the parity boundary is the wire, and the
  reaching mechanism below it is legitimately different
