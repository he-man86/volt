## ADDED Requirements

### Requirement: the LSP follows the project's identifier setting
The LSP SHALL accept a name past ASCII exactly when the project's "Unicode identifiers" setting lets the IDE accept it.

#### Scenario: Unicode identifiers off
- **WHEN** `.projectsettings` states Unicode identifiers off and an object is named `FB_主控制`
- **THEN** the LSP reports what the IDE reports for that name

#### Scenario: Unicode identifiers off, a name inside the text
- **WHEN** the option is off and a variable is declared `计数 : INT;`
- **THEN** the LSP reports what the compiler reports: "Unexpected token '计' found" and the cascade after it

### Requirement: the LSP reports an object name the IDE refuses to create
The LSP SHALL report an object or member whose name the IDE refuses to create with the IDE's own refusal, and nothing
else about that text.

#### Scenario: a reserved word as a function block's name
- **WHEN** a workspace file `INT.pou` holds `FUNCTION_BLOCK INT`
- **THEN** CODESYS's LSP says "The name 'INT' is not valid for this object." and TwinCAT's "Creating the child named 'INT' is not possible on node (Name mismatch)"
