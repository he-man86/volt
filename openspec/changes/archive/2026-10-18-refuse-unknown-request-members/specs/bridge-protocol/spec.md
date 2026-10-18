## ADDED Requirements

### Requirement: every request body refuses a member it does not have
The bridge SHALL read every request body (`connect`, `refs`, `fetch`, `push` with each of its ops, and `build`) through
one read that matches member names exactly and refuses a member the op's request type does not define. The refusal SHALL
be `BAD_REQUEST` naming the op and the member, before any IDE work. Response frames SHALL NOT be read this way.

#### Scenario: a folder-wire client sends knownFolders on fetch
- **WHEN** a client sends `fetch { "knownItems": { … }, "knownFolders": { … } }`
- **THEN** the call fails `BAD_REQUEST` naming `fetch` and `knownFolders`, and nothing is walked

#### Scenario: a recorder sends a deleted build member
- **WHEN** a client sends `build { "buildType": "full" }`
- **THEN** the call fails `BAD_REQUEST` naming `build` and `buildType`, and no build runs

#### Scenario: an unknown member at the top of a push
- **WHEN** a client sends `push { "ops": [ … ], "x": 1 }`
- **THEN** the push fails `BAD_REQUEST` naming `x`, and no op is applied

#### Scenario: a push op with no discriminator
- **WHEN** a client sends `push { "ops": [ { "name": "X.pou" } ] }`
- **THEN** the push fails `BAD_REQUEST` naming `push`, and no op is applied

#### Scenario: a miscased member
- **WHEN** a client sends `fetch { "KnownItems": { … } }`
- **THEN** the call fails `BAD_REQUEST` naming `KnownItems`
