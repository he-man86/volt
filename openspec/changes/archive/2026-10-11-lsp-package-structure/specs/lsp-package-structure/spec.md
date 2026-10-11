## ADDED Requirements

### Requirement: the package structure is explained and kept

Every folder of `src/` and `test/` in `packages/volt-lsp-iec` SHALL be described, one line each, in `docs/architecture.md`
"The tree", and that tree SHALL name no folder that does not exist (the data trees `test/conformance/fixtures/` and
`recordings/` are one entry each; dot-folders are local caches). `src/` SHALL hold no source file at its top level but
the package barrel `index.ts`; network text (LD/FBD) SHALL have no root folder, each layer holding its part in a
`network/` folder. Every file of `scripts/` SHALL be listed in `scripts/README.md`. `test/package/structure.test.ts`
SHALL fail when any of these stops being true, and `test/package/layering.test.ts` when a layer imports one it may not.

#### Scenario: a new loose file
- **WHEN** a source file is added directly under `src/`
- **THEN** the structure gate fails naming it

#### Scenario: a folder nobody described
- **WHEN** a folder is added under `src/` or `test/` without its line in "The tree", or a described folder is removed
- **THEN** the structure gate fails naming it

#### Scenario: an unlisted script
- **WHEN** a file is added to `scripts/` that `scripts/README.md` does not list
- **THEN** the structure gate fails naming it
