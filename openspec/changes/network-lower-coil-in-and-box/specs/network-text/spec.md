## ADDED Requirements

### Requirement: a coil on a later AND operand runs
The lowering SHALL run an assignment that stands as a non-first operand of a contact AND or of a box input
(`y := a AND (x := b) AND c;`, CODESYS's 3-input AND box with coil x branching off b) as CODESYS 3.5.21.40 runs the
stored `Assign` node, in the interpreter and in Rust, instead of refusing it as not lowered.

#### Scenario: the coil branches off the second contact
- **WHEN** an LD program holds `y := a AND (x := b) AND c;` with `a` FALSE and `b` TRUE
- **THEN** the program builds and runs, `x` is TRUE and `y` is FALSE, as CODESYS's recorded trace shows
