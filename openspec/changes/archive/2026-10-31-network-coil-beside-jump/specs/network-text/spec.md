## ADDED Requirements

### Requirement: A coil beside a jump needs no wire
Network text SHALL spell a jump or return beside a rung's coils without a wire, whatever the rung's value is.

#### Scenario: A timer rung with a coil and a jump
- **WHEN** the writer writes the rung `TON(IN := c).Q` into the coil `y` with a jump to `skip` beside it
- **THEN** the text declares no `VAR_TEMP` wire for it, and a pull, push, pull gives the same text
