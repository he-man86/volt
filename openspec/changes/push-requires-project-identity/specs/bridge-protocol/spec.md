## ADDED Requirements

### Requirement: a write names the project it writes
`push` and `build` SHALL carry both `expectedPlatform` and `expectedProjectName`. A request that omits either, or sends
it empty, SHALL be refused with `BAD_REQUEST` naming each missing member, before anything is walked, written or built.
A request carrying both SHALL be checked against the served project as before (`PLC_DISCONNECTED`, `WRONG_PROJECT`).
`refs` and `fetch` SHALL keep both members optional.

#### Scenario: a push without identity
- **WHEN** a client sends `push` with ops and neither member
- **THEN** the bridge answers `BAD_REQUEST` naming `expectedPlatform` and `expectedProjectName`, and the project is unchanged

#### Scenario: a build naming only its platform
- **WHEN** a client sends `build` with `expectedPlatform` and no `expectedProjectName`
- **THEN** the bridge answers `BAD_REQUEST` naming `expectedProjectName`, and nothing is built

#### Scenario: a read without identity
- **WHEN** a client sends `refs` with neither member
- **THEN** the bridge answers the served project's refs, with its `platform` and `projectName`
