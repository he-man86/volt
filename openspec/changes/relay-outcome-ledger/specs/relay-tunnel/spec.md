## ADDED Requirements

### Requirement: the outcome of a request whose answer could not be delivered is logged

When a relayed request completes after its terminal frame can no longer be delivered, the bridge SHALL log one Info
line naming the op, the request id and its outcome. For a push, that outcome is accepted or rejected, plus the new
project version. The line SHALL say the answer was not delivered. The bridge SHALL send nothing for that id on a
later connection.

#### Scenario: a push completes after the socket dropped
- **WHEN** the socket drops while push `r5` runs, the push is accepted in the IDE, and the bridge redials
- **THEN** the bridge's log has an Info line naming `r5`, `accepted`, the new project version and that it was not
  delivered, and the new connection carries no frame for `r5`

#### Scenario: nothing was abandoned
- **WHEN** a connection ends with no request in flight
- **THEN** no such line is written

### Requirement: a build's end is logged at Info

The engine SHALL log the end of every build at Info, with its verdict, its error and warning counts and its duration,
whether the build came from the CLI or through the relay.

#### Scenario: a CLI build
- **WHEN** `volt build` compiles with two warnings
- **THEN** the bridge log has an Info line with the verdict, `0 errors, 2 warnings` and the duration
