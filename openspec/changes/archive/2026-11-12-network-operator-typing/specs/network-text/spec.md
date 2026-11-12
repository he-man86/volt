## ADDED Requirements

### Requirement: EN is no operand of an operator box
The network check SHALL count and type an operator box's operands without its `EN` argument: a box read with
`EN := x` SHALL have the operands, operand types and diagnostics of the same call without `EN`, for SEL and the unary
math operators as for MUX, LIMIT and MOVE.

#### Scenario: SEL with EN/ENO
- **WHEN** a network holds `ASSIGN(SEL(EN := x, b, i, j, OUT => oi), Q => y);` with `b`, `x`, `y` BOOL and `i`, `j`, `oi` INT
- **THEN** no diagnostic is reported, as for `oi := SEL(b, i, j);`

#### Scenario: ABS with EN/ENO
- **WHEN** a network holds `ASSIGN(ABS(EN := x, i, OUT => oi), Q => y);`
- **THEN** no diagnostic is reported, and `ABS` is typed by `i`, an INT

### Requirement: a network box is typed as the ST operation it is
A negated output (`X_INVERTED => v`), an edge's value (`RISING(x)`, `FALLING(x)`) and an operator box's operands SHALL be
typed as ST types `v := NOT <box>.X`, the BOOL input `CLK` of an R_TRIG / F_TRIG, and the same operation in ST, with
CODESYS 3.5.21.40's messages (fixtures `ng_ot_*`).

#### Scenario: an edge on an INT
- **WHEN** a network holds `ASSIGN(RISING(i), Q => y);` with `i` an INT
- **THEN** it reports "Cannot convert type 'INT' to type 'BOOL'"

#### Scenario: ADD on two BOOLs
- **WHEN** a network holds `ASSIGN(ADD(a, b), Q => x);` with `a`, `b`, `x` BOOL
- **THEN** it reports "Cannot convert type 'BOOL' to type 'USINT'" once per operand and "Cannot convert type 'USINT' to type 'BOOL'"
