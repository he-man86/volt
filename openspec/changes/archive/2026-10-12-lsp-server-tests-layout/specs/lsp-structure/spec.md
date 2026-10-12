## ADDED Requirements

### Requirement: server tests sit beside what they test
Every source file under `packages/volt-lsp-iec/src/server/` (and its `handlers/`) SHALL have its own colocated test named
after it, and tests that drive the whole server over its protocol SHALL live under `test/lsp/`.

#### Scenario: a handler without its test
- **WHEN** a file under `src/server/handlers/` has no `<name>.test.ts` beside it
- **THEN** the structure gate fails naming it

#### Scenario: a test named after a finding
- **WHEN** a test under `src/server/` is named after anything but a source file beside it
- **THEN** the structure gate fails naming it

### Requirement: a colocated test is named after the source file beside it
Every `*.test.ts` under `packages/volt-lsp-iec/src/` SHALL be named after a source file beside it (`<name>.test.ts` beside
`<name>.ts`), except the topic suites the structure gate lists, each with its reason (the transpile pipeline per subject,
the parser fuzz, lowering totality, the refusal classification, and the network-text tests until the LD/FBD change).

#### Scenario: a topic-named test outside the list
- **WHEN** a test under `src/` has no source file of its name beside it and is no listed topic suite
- **THEN** the structure gate fails naming it

#### Scenario: a listed topic suite that is gone
- **WHEN** a topic suite the gate lists no longer exists
- **THEN** the structure gate fails naming it
