## ADDED Requirements

### Requirement: WSTRING narrowing follows CODESYS
Converting a WSTRING to a STRING (and back) SHALL produce the bytes CODESYS produces, as recorded by `record:exec`,
including characters past ASCII.

#### Scenario: a character past ASCII
- **WHEN** a program evaluates `LEN(WSTRING_TO_STRING("größe"))`
- **THEN** the result equals the recorded CODESYS value (7)
