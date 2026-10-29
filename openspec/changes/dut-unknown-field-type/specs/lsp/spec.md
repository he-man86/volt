## ADDED Requirements

### Requirement: an unknown STRUCT field type is reported in the DUT
A STRUCT field whose type resolves to nothing SHALL be reported on the field, in the DUT file, as the compiler reports it.

#### Scenario: a typo in a field type
- **WHEN** a DUT declares `STRUCT a : INTT; END_STRUCT`
- **THEN** the LSP reports the unknown type on `INTT` in that DUT, not at a later lowering in another file
