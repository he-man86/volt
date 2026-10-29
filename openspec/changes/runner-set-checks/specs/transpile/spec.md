## ADDED Requirements

### Requirement: Runner.set refuses a value the variable's type cannot hold
`Runner.set(path, value)` SHALL refuse by name a value out of the declared type's range or of the wrong kind, and leave
the cell unchanged, as CODESYS's online write refuses it.

#### Scenario: an out-of-range INT
- **WHEN** `set("i", 70000n)` is called on `i : INT`
- **THEN** the call is refused naming `i`, INT and the value, and `get("i")` returns the previous value
