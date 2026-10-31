## ADDED Requirements

### Requirement: a function box with formal pins in a network runs as its positional call
Lowering SHALL lower a Standard function or operator box in a network body that is called with its formal input
names (`LIMIT(MN := 0, IN := v, MX := 100)`) as the positional call in the declaration's pin order, as CODESYS runs
the box. An unknown pin name, a pin given twice or a missing pin SHALL be refused by name. Outside a network body a
built-in called with named arguments SHALL stay refused as `call-named-args`.

#### Scenario: LIMIT with its pin names in FBD
- **WHEN** an FBD `Main` holds `y := LIMIT(MN := 0, IN := v, MX := 100);` and runs with `v` at 150
- **THEN** it lowers, and `y` is 100

#### Scenario: the same call in ST
- **WHEN** an ST `Main` holds `y := LIMIT(MN := 0, IN := v, MX := 100);`
- **THEN** lowering refuses it with `call-named-args`

### Requirement: a wire lowering cannot type is refused at the wire
A network wire whose type lowering cannot declare SHALL be refused at the span of that wire, never at the start of the
file.

#### Scenario: a wire fed by MOVE of an array
- **WHEN** an FBD network declares `VAR_TEMP w1 : ANY; END_VAR`, assigns `w1 := MOVE(arr);` with `arr` an array, and
  reads `out := w1;`
- **THEN** the refusal names `w1` and stands on the wire's line
