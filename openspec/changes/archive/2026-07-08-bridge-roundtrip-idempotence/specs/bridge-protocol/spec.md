## ADDED Requirements

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
