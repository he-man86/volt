## ADDED Requirements

### Requirement: Wires are declared on a % line
A network's wires SHALL be declared on one `%WIRES` line after its `%NETWORK` and `%DISABLED` lines, naming each wire once, comma-separated, with no type.

#### Scenario: Two wires
- **WHEN** a network holds `%WIRES w1, w2`, then `w1 := a AND b;` and `w2 := t1(IN := w1).Q;`
- **THEN** `w1` and `w2` are the network's wires, typed by their definitions, and nothing is reported

#### Scenario: The old line
- **WHEN** a network holds `VAR_TEMP w1 : ANY; END_VAR`
- **THEN** `w1` is a wire, and a hint names the `%WIRES w1` spelling
