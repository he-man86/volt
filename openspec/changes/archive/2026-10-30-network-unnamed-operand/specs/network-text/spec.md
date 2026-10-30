## ADDED Requirements

### Requirement: an unnamed operand keeps its statement
In a network body, `???` written where an operand stands (a contact, a box input positional or named, an output binding) SHALL parse as the unnamed operand, an identifier `???` with its span, as the bridge's reader lexes it. Its statement SHALL stay in the statement tree, and the build's two errors SHALL be reported at the `???`: "Expression expected instead of '?'" and "Unexpected token '?' found" (TwinCAT "Unexpected Token '?' found"), as recorded for `network_unnamed_input_pin` and `network_unnamed_group_operand` on both vendors. `???` as a coil keeps its own error, "The assignment target is not specified.".

#### Scenario: an unnamed contact
- **WHEN** an LD body holds `x := ??? AND a;`
- **THEN** the statement is in the tree with `???` as the left operand of `AND`, the build's two errors are reported at `???`, and nothing else in the statement

#### Scenario: an unnamed box input and output
- **WHEN** an LD body holds `x := MOVE(EN := a, ???, OUT => ???).ENO;`
- **THEN** the statement is in the tree with `???` as the second input and as the `OUT` binding, and the build's two errors are reported at each `???`

#### Scenario: plain ST is unchanged
- **WHEN** an ST body holds `x := ??? AND a;`
- **THEN** the syntax error "Expression expected instead of '?'" is reported as before
