## ADDED Requirements

### Requirement: pin edges and output marks run as CODESYS runs them
The lowering SHALL run an edge mark on a box pin or on EN (`t1(IN := RISING(a))`, `MOVE(EN := RISING(c), …)`), a mark
on a bound output (`t1(…, Q_INVERTED => x)`) and an edge mark on a jump (`ASSIGN(RISING(a), Q => JMP.l);`) as CODESYS
3.5.21.40 runs the stored model, in the interpreter and in Rust.

#### Scenario: a rising edge on a timer's IN
- **WHEN** an LD program holds `t1(IN := RISING(a), PT := T#1S);` and `a` stays TRUE over several scans
- **THEN** the program builds and runs, and `t1` sees IN as CODESYS's recorded trace shows it

#### Scenario: a negated output pin
- **WHEN** an LD program holds `t1(IN := a, PT := T#1S, Q_INVERTED => x);`
- **THEN** the program builds and runs, and `x` holds what CODESYS's recorded trace shows for it
