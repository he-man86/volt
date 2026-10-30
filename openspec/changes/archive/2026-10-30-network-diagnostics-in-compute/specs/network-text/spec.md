## ADDED Requirements

### Requirement: computeDiagnostics reports the network checks
`computeDiagnostics` SHALL include the network checks of every network-text body in the document (`networkDiagnostics`, appended after the registry's checks and their policy), each diagnostic once, the same ones the language server reports while typing. The language server's `documentFindings` SHALL take them from `computeDiagnostics` and append none of its own.

#### Scenario: an infix operator in a network
- **WHEN** an LD body holds `x := a XOR b;` and a consumer calls `computeDiagnostics` for that document
- **THEN** the result holds one `network-plain-st` error on `a XOR b`

#### Scenario: the language server does not repeat it
- **WHEN** the same document is open in the language server
- **THEN** it reports that `network-plain-st` error once

#### Scenario: an ST body has no network check
- **WHEN** an ST body holds `x := a XOR b;`
- **THEN** `computeDiagnostics` reports no `network-*` finding
