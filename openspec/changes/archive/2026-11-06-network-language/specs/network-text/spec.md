## ADDED Requirements

### Requirement: the network text is the stored NWL tree as ST calls
Every state the CODESYS editor can draw SHALL have one network text, each stored node one call whose flow is its
return; every other state SHALL be refused by name.

#### Scenario: a negated coil beside a plain one
- **WHEN** a rung stores one assign with targets `x` (negated) and `y`
- **THEN** it pulls as `ASSIGN(a, Q_INVERTED => x, Q => y);` and pushes back to the same stored tree
