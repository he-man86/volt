## ADDED Requirements

### Requirement: the LSP follows the project's identifier setting
The LSP SHALL accept a name past ASCII exactly when the project's "Unicode identifiers" setting lets the IDE accept it.

#### Scenario: Unicode identifiers off
- **WHEN** `.projectsettings` states Unicode identifiers off and an object is named `FB_主控制`
- **THEN** the LSP reports what the IDE reports for that name
