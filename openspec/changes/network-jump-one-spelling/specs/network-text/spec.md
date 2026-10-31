## ADDED Requirements

### Requirement: a jump or return beside a coil has one spelling
A rung whose coils share their value with a jump or return SHALL be written as a wire assigned once, read by every coil and by the jump or return, whatever the value contains.

#### Scenario: repeatable value still uses the wire
- **WHEN** a rung `a AND b` ending in coil `y` and a jump to `skip` is written
- **THEN** the text is `w1 := a AND b; y := w1; JMP(skip, w1);` and not a repeated `a AND b`

#### Scenario: value reading its own coil round-trips
- **WHEN** a rung `NOT a` ending in coil `a` and a return is written and pushed back
- **THEN** the text is `w1 := NOT a; a := w1; RETURN(w1);` and CODESYS stores one rung with the coil and the return
