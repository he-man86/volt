## ADDED Requirements

### Requirement: a called program's variables are readable by path
The runner SHALL resolve a path whose head names a PROGRAM called from the entry program (a global of section
`program`) to that program's frame, for reading and writing, with the members below it resolved as an FB instance's
members are (`Prog2.a`, `Prog2.t1.Q`, `Prog2.arr[1]`, `Prog2.__nw1_w1`). A bare name SHALL NOT resolve to a program's
member.

#### Scenario: reading a second program's variable
- **WHEN** Main calls `Prog2();` and `Prog2` declares `a : BOOL` and sets it TRUE, and one scan runs
- **THEN** `get("Prog2.a")` returns TRUE

#### Scenario: a bare name stays the entry program's
- **WHEN** Main and `Prog2` both declare `a`
- **THEN** `get("a")` returns Main's `a`
