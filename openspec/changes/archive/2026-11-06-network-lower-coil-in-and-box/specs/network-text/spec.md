## ADDED Requirements

### Requirement: a coil on an AND operand runs
The lowering SHALL run an ASSIGN that stands as any operand of a contact AND or of a box input
(`ASSIGN(ASSIGN(a, Q => x) AND b, Q => y);`, `ASSIGN(a AND ASSIGN(b, Q => x) AND c, Q => y);`, CODESYS's 3-input AND box with coil x branching off b) as CODESYS 3.5.21.40 runs the stored `Assign`
node, in the interpreter and in Rust.

#### Scenario: the coil branches off the second contact
- **WHEN** an LD program holds `ASSIGN(a AND ASSIGN(b, Q => x) AND c, Q => y);` with `a` FALSE and `b` TRUE
- **THEN** the program builds and runs, `x` is TRUE and `y` is FALSE, as CODESYS's recorded trace shows
