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
