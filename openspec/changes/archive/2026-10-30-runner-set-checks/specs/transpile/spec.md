## ADDED Requirements

### Requirement: Runner.set refuses a value the variable's type cannot hold
`Runner.set(path, value)` SHALL refuse by name — a `RunnerValueError` naming the path, the declared type and the reason —
a value out of the declared type's range, of the wrong kind, or longer than a STRING's capacity, and leave the cell
unchanged, as CODESYS's online write refuses it. A struct or array value SHALL be checked field by field and element by
element; an FB instance SHALL be written by its variables, not whole.

#### Scenario: an out-of-range INT
- **WHEN** `set("i", 70000n)` is called on `i : INT`
- **THEN** the call is refused naming `i`, INT and the value, and `get("i")` returns the previous value

#### Scenario: a STRING longer than its capacity
- **WHEN** `set("s", "abcdef")` is called on `s : STRING(5)`
- **THEN** the call is refused naming `s`, STRING(5) and the length, and nothing is written
