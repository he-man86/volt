## ADDED Requirements

### Requirement: every refusal names what it asks of the user

Every code the transpiler refuses with SHALL be one of `invalid` (CODESYS refuses the ST too), `not-modelled` (valid ST, not
built) or `not-measured` (valid ST no recording decides), each decided by its call sites and recordings, never by reading alone.

#### Scenario: a refused construct
- **WHEN** lowering refuses a body
- **THEN** its diagnostic's kind is `invalid`, `not-modelled` or `not-measured`, never `unclassified`
