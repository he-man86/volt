## ADDED Requirements

### Requirement: a relay close is reported with its reason

Every time the relay closes the tunnel, `RelayTunnel` SHALL log the close status and description. A close with
status 1008 SHALL be logged at error level, naming the reason; when the reason names the protocol, the line SHALL
say that the latest bridge must be downloaded.

#### Scenario: an old bridge is turned away
- **WHEN** the relay answers `hello` by closing with 1008 `unsupported protocol 1`
- **THEN** the bridge log holds one error line with `unsupported protocol 1` and the instruction to download the
  latest bridge

#### Scenario: an ordinary close
- **WHEN** the relay closes with 1001
- **THEN** the log names status 1001 and its description

### Requirement: a policy refusal slows dialing without ending it

After a 1008 close, `RelayTunnel` SHALL wait a long backoff ceiling (1 hour) before dialing again; it SHALL NOT stop
dialing for the life of the process. Any other end SHALL keep the jittered backoff capped at 30 s. An accepted
connection (one on which the relay sent at least one frame) SHALL reset the backoff to its floor. A refused tunnel SHALL NOT stop the bridge serving its local pipe.

#### Scenario: a refused bridge
- **WHEN** the relay closes with 1008
- **THEN** the next connection attempt comes after the long ceiling, and the local pipe keeps answering

#### Scenario: the relay restarts
- **WHEN** the connection ends with 1006 or 1001
- **THEN** the tunnel backs off at most 30 s and redials, as today

#### Scenario: the refusal is lifted
- **WHEN** a later attempt after a 1008 is accepted
- **THEN** the backoff is back at its floor
