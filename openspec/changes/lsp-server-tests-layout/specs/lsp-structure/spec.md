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
