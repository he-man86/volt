## ADDED Requirements

### Requirement: every src file is in the folder of what it is
Each file under `packages/volt-lsp-iec/src` SHALL live in the layer folder of what it does: `server/` holds only the LSP
adapter (connection, dispatch, publishing), analyses of the program live in `analysis/`, the workspace index in
`workspace/`, language facts in `frontend/`, editor features in `services/`, and test support only under `test/`.

#### Scenario: test support in src
- **WHEN** a file under `src/` exists only to drive tests
- **THEN** the structure gate fails naming it

#### Scenario: a built-in without hover
- **WHEN** an elementary type, operator or compiler-provided function has no hover entry
- **THEN** the hover coverage test fails naming it
