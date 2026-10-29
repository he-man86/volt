## ADDED Requirements

### Requirement: every lowering diagnostic names its file
A diagnostic of `lowerSource` SHALL carry the URI of the file its span is in.

#### Scenario: a reached LD/FBD POU
- **WHEN** a program in one file calls an LD/FBD POU in another and lowering refuses it
- **THEN** the diagnostic carries the URI of the file the reported span is in
