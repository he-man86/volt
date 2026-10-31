## ADDED Requirements

### Requirement: one text per stored network model
Network text SHALL spell every stored network model with exactly one text, and SHALL read every text as exactly one
stored model, with no dependence on whitespace or on which declarations are in reach.

#### Scenario: a TwinCAT unwired pin
- **WHEN** a TwinCAT network with an unwired FB input is pulled
- **THEN** the pin is left out of the text, not written as `TRUE`

#### Scenario: an operand holding ST text
- **WHEN** an operand holds ST text that is no plain operand
- **THEN** it is written `OPERAND('<its text>')`, its text one string in ST escaping, and read back as that operand

#### Scenario: a mark on an unnamed pin
- **WHEN** a pin the IDE stores unnamed carries a mark
- **THEN** the mark stands before an empty name, `AND(a, NOT := b)`, and `AND(a, := b)` is refused by name

#### Scenario: one spelling of every other text
- **WHEN** a text holds a wire numbered other than the writer numbers it, a title `""` or an escape the writer does not write, `EN :=` / `.ENO` / `ENO =>` / `OUT =>` against a callee no declaration states, or wires declared `VAR_TEMP`
- **THEN** the reader refuses it by name, and the writer writes wires `VAR w1 : ANY; END_VAR`, an Execute box's EN and ENO as on every box, and an extra `???` output slot `OUT => ???`
