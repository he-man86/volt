## ADDED Requirements

### Requirement: a finished walk always answers
After a `refs` walk reports all items done, the bridge SHALL send its terminal answer over the relay, and no single slow
operation SHALL keep the relay tunnel's heartbeat from flowing.

#### Scenario: a large project over the relay
- **WHEN** `refs` runs over the relay on a project of several hundred items
- **THEN** the terminal frame arrives well inside the relay's 60 s timeout and pings keep flowing during the operation
