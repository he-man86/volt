## ADDED Requirements

### Requirement: An ENO binding shows ENO
In network text, a box call with an `ENO => v` argument SHALL show its ENO without a closing `.ENO`. A closing `.ENO` SHALL be needed only where the call's value is read.

#### Scenario: Root box with ENO bound
- **WHEN** an LD network holds `MOVE(EN := c, 7, ENO => lamp, OUT => n);`
- **THEN** no network check is reported, and the box shows `EN` and `ENO`, its `ENO` running to `lamp`

#### Scenario: ENO handed on
- **WHEN** an LD network holds `lamp := MOVE(EN := c, 7, OUT => n).ENO;`
- **THEN** the closing `.ENO` still states the value the coil reads, and no network check is reported
