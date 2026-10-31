## ADDED Requirements

### Requirement: every stored LD/FBD mark, the rail and every jump target has its own spelling
Network text SHALL spell the rail as `RAIL()`, a jump and the return as targets (`JMP.l := v;`, `RETURN := v;`, `y := JMP.l := v;`), and the negation and edge marks where the model holds them: on a value (`NOT a`, `RISING(a)`, `FALLING(a)`, `NOT t1(…).Q`) and as a prefix on a receiver (a pin or EN `t1(NOT IN := a)`, an output `NOT Q => x`, a coil `RISING y := a;`), each pulling as a text that pushes back to the same stored model.

#### Scenario: a drawn rail coil round-trips
- **WHEN** a network with a coil fed straight from the rail is pulled and pushed back
- **THEN** the text is `y := RAIL();` and CODESYS stores a coil on the rail, not a TRUE contact

#### Scenario: a negated box pin round-trips
- **WHEN** a box whose pin is negated on the box is pulled
- **THEN** the text is `NOT IN := a` before the pin's formal, and the push stores the pin's flag, the operand plain

#### Scenario: a coil and a jump on one value are one item
- **WHEN** a rung drives a coil and a jump from one value
- **THEN** the text is `y := JMP.l := v;` in stored target order, the value written once

#### Scenario: a marked coil inside a chain is refused by name
- **WHEN** a chain marks any coil but its first (`y := NOT x := a;`)
- **THEN** the text is refused by name, because every target receives the rung's power flow (measured, CODESYS 3.5.21.40)

#### Scenario: a mark the IDE stores no model for is refused by name
- **WHEN** the text writes `NOT RISING y := a;`, `NOT y S= a;`, a mark on a jump, or `JMP l;` / `JMP(l, v);` / `RETURN;`
- **THEN** the reader refuses it by name, with its line
