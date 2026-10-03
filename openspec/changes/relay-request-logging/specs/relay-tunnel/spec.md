## ADDED Requirements

### Requirement: every relayed request ends in one log line

Every request the bridge reads from the relay SHALL produce exactly one terminal Info line naming its op, its id, its
outcome (ok, the error code, a refusal, or abandoned with the op's own outcome when it completed), its total duration
and whether the terminal frame was delivered. A failed delivery after a successful op SHALL NOT be logged as a
failure of the op.

#### Scenario: a coded error
- **WHEN** a relayed `refs` is answered `PLC_DISCONNECTED`
- **THEN** the log has a terminal line for its id naming `PLC_DISCONNECTED`

#### Scenario: an op that is not relayable
- **WHEN** the relay sends `connect`
- **THEN** the log has a terminal line for its id saying it was refused `BAD_REQUEST`

#### Scenario: a push whose result could not be sent
- **WHEN** a push is accepted and the socket fails while its result is sent
- **THEN** the terminal line says the push succeeded and was not delivered

### Requirement: every connection end is one log line with its cause

When a relay connection ends, the bridge SHALL log one line naming the pipe it serves, the connection's age, the
cause (the relay's close status and reason, a drop without close, the silence watchdog, a dead heartbeat, or a
refused upgrade), the ids still in flight and the delay before the next dial.

#### Scenario: the watchdog drops a connection with requests in flight
- **WHEN** the watchdog drops a connection while two requests are open
- **THEN** one line names the pipe, the watchdog as the cause, both ids, the connection's age and the next dial's delay
