## ADDED Requirements

### Requirement: a bridge that stops on purpose closes its relay socket

A bridge that stops deliberately SHALL send a WebSocket Close frame with status 1001 and the reason `bridge stopping`
before it drops the socket. That applies to the CODESYS stop script, Ctrl+C, the TwinCAT console window closing, and
the CODESYS IDE exiting. The bridge SHALL NOT wait more than about one second for the close. A connection dropped by
the silence watchdog or by a failed heartbeat SHALL still be aborted without a close handshake.

#### Scenario: the TwinCAT console window is closed
- **WHEN** the user closes the TwinCAT bridge's console window while it is connected to a relay
- **THEN** the relay receives a Close frame with status 1001 and the reason `bridge stopping` before the socket ends

#### Scenario: the CODESYS IDE exits
- **WHEN** the engineer closes CODESYS while the bridge is connected
- **THEN** the relay receives a Close frame with status 1001

#### Scenario: the relay does not answer the close
- **WHEN** the bridge stops and the relay never answers its Close frame
- **THEN** the bridge drops the socket after at most about one second and the stop is not delayed further

#### Scenario: the watchdog fires
- **WHEN** no frame arrived for longer than the silence limit
- **THEN** the socket is aborted without a Close frame, as today
