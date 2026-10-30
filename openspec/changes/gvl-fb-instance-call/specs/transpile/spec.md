## ADDED Requirements

### Requirement: an FB instance declared in a GVL can be called
The interpreter and the Rust backend SHALL run a call of a function-block instance declared in a global variable list —
its body, a METHOD, a PROPERTY accessor — as CODESYS does, through its list (`GVL.t1(…)`) and, for a list that is not
`qualified_only`, by its bare name. A call whose run could reach the variable it runs on — its own body reaching it, a
call through an interface, the instance reached through a runtime index — SHALL be refused by name
(`call-global-reentrant`).

#### Scenario: a timer in a GVL
- **WHEN** `GVL.t1 : TON;` is called as `GVL.t1(IN := x, PT := T#1S);` from a program
- **THEN** the program runs and `GVL.t1.Q` follows the timer, in both backends

#### Scenario: a body that reaches its own GVL instance
- **WHEN** `GVL_R.own : FB_S;` is called and FB_S's body writes `GVL_R.own.k`
- **THEN** lowering refuses the call with `call-global-reentrant`, naming `GVL_R.own`
