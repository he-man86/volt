## ADDED Requirements

### Requirement: One ST construct has one shortest emitted form

The emitter SHALL print each ST construct in one form, the shortest that keeps the program's values identical on
every input. It SHALL NOT change a program's result to shorten it. Any emission change SHALL keep every fixture's
recorded outputs byte-identical.

#### Scenario: a narrow increment is emitted the same way everywhere
- **WHEN** `x := x + 1` with `x : INT` appears in a FOR step and in a body statement
- **THEN** both print the same form, and the fixture outputs do not change

#### Scenario: a negative literal is one token
- **WHEN** `us : USINT := -1` appears in an initializer and as an assignment
- **THEN** both print a single literal in the target type

#### Scenario: unused helpers are not emitted
- **WHEN** a POU holds a STRING but converts no value to text
- **THEN** no `iec_*_text` helper appears in its Rust
