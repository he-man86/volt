## ADDED Requirements

### Requirement: a quick fix the compiler accepts
Every quick fix the language server offers SHALL produce text the vendor compiler builds clean for the fixture that
reports its diagnostic, as recorded; a fix without such a recording SHALL NOT be offered.

#### Scenario: declaring an unresolved identifier
- **WHEN** the user applies the fix for an unresolved identifier
- **THEN** the variable is declared with its inferred type and the recorded build of the result is clean
