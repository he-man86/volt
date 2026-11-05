## ADDED Requirements

### Requirement: a reconnecting bridge states why its last connection ended
A bridge's `hello` after a lost connection SHALL carry `lastDrop` with a fixed cause token, the connection's age, its silence, the
call in flight if any, and how long the redial took. It SHALL hold no exception text.

#### Scenario: the watchdog dropped the connection
- **WHEN** the bridge aborts a socket after 60 s with no inbound frame, and then redials
- **THEN** its next `hello` carries `lastDrop.cause` = `watchdog_silence`

#### Scenario: a first connection
- **WHEN** the bridge dials for the first time since it started
- **THEN** its `hello` carries no `lastDrop`
