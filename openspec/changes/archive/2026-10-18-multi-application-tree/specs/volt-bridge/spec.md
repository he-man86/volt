## ADDED Requirements

### Requirement: refs returns every application in one tree
The bridge SHALL return one tree holding every device and application (CODESYS) and every PLC project (TwinCAT) the IDE
holds, and SHALL identify each item by its location as well as its name.

#### Scenario: two applications with the same item names
- **WHEN** a CODESYS project has two devices whose applications both hold `PLC_PRG`
- **THEN** refs, fetch and pull return both `PLC_PRG` items, each under its own device

#### Scenario: several TwinCAT PLC projects
- **WHEN** a TwinCAT solution holds two system projects with four PLC projects
- **THEN** refs returns the items of all four PLC projects
