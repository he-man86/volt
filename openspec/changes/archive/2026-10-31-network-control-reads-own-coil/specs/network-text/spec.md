## ADDED Requirements

### Requirement: A control beside coils never reads its own coil's write
The network-text writer SHALL refuse by name a rung whose jump or return shares its value with coils when that value
reads a variable one of those coils writes, compared by base name case-insensitively, instead of repeating the value.

#### Scenario: A toggle rung with a jump
- **WHEN** the writer writes the stored rung `NOT a` into the coil `a` with a jump to `skip` beside it
- **THEN** it throws `StNetworkUnspellableException` with the reason `a jump sharing a value that reads a variable its own coil writes`

#### Scenario: A plain rung keeps the repeated value
- **WHEN** the writer writes the stored rung `c` into the coil `y` with a jump to `skip` beside it
- **THEN** the text is `y := c;` followed by `JMP(skip, c);`
