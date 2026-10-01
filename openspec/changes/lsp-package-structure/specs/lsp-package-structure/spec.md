## ADDED Requirements

### Requirement: the package structure is explained and kept

Every folder of `src/` and `test/` in `packages/volt-lsp-iec` SHALL be described in `docs/architecture.md`, `src/` SHALL hold
no loose source files at its top level, every script SHALL be listed in `scripts/README.md`, and a test SHALL fail when any
of these stops being true or when a layer imports one it may not.

#### Scenario: a new loose file
- **WHEN** a source file is added directly under `src/`
- **THEN** the structure gate fails naming it
