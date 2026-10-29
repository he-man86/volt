## ADDED Requirements

### Requirement: an FB instance declared in a GVL can be called
The interpreter SHALL run a call of a function-block instance declared in a global variable list, as CODESYS does.

#### Scenario: a timer in a GVL
- **WHEN** `GVL.t1 : TON;` is called as `GVL.t1(IN := x, PT := T#1S);` from a program
- **THEN** the program runs and `GVL.t1.Q` follows the timer
