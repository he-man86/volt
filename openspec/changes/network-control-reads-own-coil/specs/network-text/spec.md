## ADDED Requirements

### Requirement: A control beside coils runs on the rung's value
When network text spells a jump or return beside a rung's coils, the control SHALL read the value the rung computed
before its coils wrote, also when that value reads a variable one of those coils writes.

#### Scenario: A toggle rung with a jump
- **WHEN** the writer writes the stored rung `NOT a` into the coil `a` with a jump to `skip` beside it
- **THEN** the jump's condition is not `NOT a` written after `a := NOT a;`, and a pull, push, pull gives the same text

#### Scenario: A plain rung keeps the repeated value
- **WHEN** the writer writes the stored rung `c` into the coil `y` with a jump to `skip` beside it
- **THEN** the text is `y := c;` followed by `JMP(skip, c);`
