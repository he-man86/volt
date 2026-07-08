## ADDED Requirements

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
