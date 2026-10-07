## ADDED Requirements

### Requirement: an LSP gap the transpiler work finds is filed, not dropped

Every disagreement between the LSP and a CODESYS recording that the transpiler work exposes SHALL be recorded as a task of this
change naming its fixtures and the mark that holds it, and the mark SHALL be removed in the same commit that makes the LSP agree.

#### Scenario: a silent LSP on a refused program
- **WHEN** a fixture CODESYS refuses rates `lsp-gap` because the LSP reports nothing
- **THEN** a task here names that fixture and the recorded message, and the fixture stays in `MEASURED_SILENT` until the task closes

#### Scenario: the gap closes
- **WHEN** the LSP starts reporting the recorded refusal for a listed fixture
- **THEN** the expected-failure guard fails until the fixture's mark is removed, and the task is ticked in that commit
