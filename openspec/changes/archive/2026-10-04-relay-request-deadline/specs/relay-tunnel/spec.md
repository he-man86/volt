## ADDED Requirements

### Requirement: a relayed write never starts after waiting behind another write

A relayed `push` or `build` SHALL either start without waiting behind another push or build on the same IDE, or be
refused at once with `IDE_BUSY`, having changed nothing. The bridge SHALL ignore request-frame fields it does not
know (such as a caller's budget) and SHALL serve the request as if they were absent.

#### Scenario: a push while a long build runs
- **WHEN** a relayed push arrives while a build holds the IDE for 120 s
- **THEN** it is answered `IDE_BUSY` at once, and the project is unchanged

#### Scenario: a frame with a budget
- **WHEN** a relay sends `{ id, op, body, budgetMs }`
- **THEN** the op is served exactly as `{ id, op, body }` would be
