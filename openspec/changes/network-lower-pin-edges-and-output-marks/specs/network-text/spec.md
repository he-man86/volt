## ADDED Requirements

### Requirement: pin edges and output marks run as CODESYS runs them
The lowering SHALL run an edge mark on a box pin or on EN (`t1(RISING IN := a)`, `MOVE(RISING EN := c, …)`) and a mark
on a bound output (`t1(…, NOT Q => x)`), and an edge mark on a jump (`RISING JMP.l := a;`) as CODESYS 3.5.21.40 runs the stored model, in the interpreter and in Rust,
instead of refusing them as unmeasured.

#### Scenario: a rising edge on a timer's IN
- **WHEN** an LD program holds `t1(RISING IN := a, PT := T#1S);` and `a` stays TRUE over several scans
- **THEN** the program builds and runs, and `t1` sees IN as CODESYS's recorded trace shows it

#### Scenario: a negated output pin
- **WHEN** an LD program holds `t1(IN := a, PT := T#1S, NOT Q => x);`
- **THEN** the program builds and runs, and `x` holds what CODESYS's recorded trace shows for it
