## ADDED Requirements

### Requirement: the LSP reports what the compiler reports, per class
Every field false positive SHALL be fixed at its root class, and every site of that class SHALL be pinned by a fixture
recorded against CODESYS (and TwinCAT where it applies).

#### Scenario: a name past ASCII in a header
- **WHEN** `FB_主控制.pou` declares `FUNCTION_BLOCK FB_主控制`
- **THEN** the LSP reports no signature-name mismatch, as the compiler builds it
