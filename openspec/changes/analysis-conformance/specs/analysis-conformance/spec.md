## ADDED Requirements

### Requirement: the LSP reports what the IDE build reports

For every source in the corpora and the conformance fixtures, the LSP's diagnostics SHALL equal the recorded CODESYS and
TwinCAT builds' messages (text, place, severity), except where a known divergence is recorded with its reason.

#### Scenario: a false positive
- **WHEN** the LSP reports a message the recorded build does not
- **THEN** it is a finding: fixed, or recorded as a known divergence that fails the suite once it matches
