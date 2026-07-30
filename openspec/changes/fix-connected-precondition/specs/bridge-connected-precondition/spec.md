## ADDED Requirements

### Requirement: Every project op decides "connected" from one live signal

A project-touching op (`refs`, `fetch`, `init`, `push`, `build`) SHALL decide its not-connected precondition from
the driver's live `IsConnected` state read, never from a cached or throttled health snapshot. A read and a write
issued against the same bridge at the same moment SHALL therefore reach the same verdict.

#### Scenario: A write is not refused on stale health

- **WHEN** the driver is live-connected to the bound project but its cached health snapshot has no serving row
- **THEN** a `push` proceeds, and does NOT fail with `PLC_DISCONNECTED`

#### Scenario: A read and a write agree

- **GIVEN** any bridge state
- **WHEN** `refs` and `push` are issued against it
- **THEN** either both pass the connected precondition or both refuse with `PLC_DISCONNECTED` — never one of each

#### Scenario: A genuinely detached bridge still refuses

- **WHEN** no IDE project is attached
- **THEN** every project op refuses with `PLC_DISCONNECTED`, on both vendors identically

### Requirement: Project identity is compared against a live served-project name

When a caller supplies an expected project identity, the guard SHALL compare it against a live served-project name
read from the driver, not against a cached health row, so that a connected bridge is never reported as serving a
different (or no) project because its snapshot is stale.

#### Scenario: No spurious wrong-project on a stale snapshot

- **WHEN** the driver is live-connected to the project the caller is bound to, and the cached health list has no
  serving row
- **THEN** the op proceeds, and does NOT fail with `WRONG_PROJECT`

#### Scenario: A real mismatch still refuses

- **WHEN** the bridge is live-serving project A and the caller is bound to project B
- **THEN** the op refuses with `WRONG_PROJECT`, naming both

### Requirement: A health-probe failure is never silent

The background health probe SHALL remain best-effort with respect to the `health` request — a probe failure MUST
NOT fault the response — but it SHALL NOT be discarded silently: a failure SHALL be logged and SHALL mark the
session degraded, so a stale snapshot is never presented as a confident verdict.

#### Scenario: A failed re-attach is visible

- **WHEN** the background probe throws (for example the IDE's COM channel is gone)
- **THEN** the failure is logged with its reason, the session is marked degraded, and the `health` request still
  answers from the last snapshot rather than erroring

### Requirement: The IDE test double can represent a divergent driver

The shared IDE test double SHALL allow the live connected signal and the health snapshot to be driven
independently, so that a driver state where the two disagree is reproducible in a unit test.

#### Scenario: The divergence is reproducible without an IDE

- **WHEN** the double is configured live-connected with a health snapshot that has no serving row
- **THEN** a test can assert that a write still passes its precondition
