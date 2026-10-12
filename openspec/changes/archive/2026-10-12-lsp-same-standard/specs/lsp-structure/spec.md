## ADDED Requirements

### Requirement: the whole LSP package is held to one standard
Every file under `packages/volt-lsp-iec/src` SHALL stay within 400 lines (600 for a test file) and every function within
80 lines, SHALL export nothing no module imports, and SHALL live in the layer folder of what it does: `server/` holds only
the LSP adapter, analyses of the program live in `analysis/`, the workspace index in `workspace/`, language facts in
`frontend/`, editor features in `services/`, and test support only under `test/`. Network-text files are exempt only
until the LD/FBD coverage change, at ceilings that may not grow.

#### Scenario: a file grows past its limit
- **WHEN** a source file outside network text exceeds 400 lines
- **THEN** `bun run lint` fails naming it

#### Scenario: test support in src
- **WHEN** a file under `src/` exists only to drive tests
- **THEN** the structure gate fails naming it

#### Scenario: a built-in without hover
- **WHEN** an elementary type, operator or compiler-provided function has no hover entry
- **THEN** the hover coverage test fails naming it
