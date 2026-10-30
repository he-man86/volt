## ADDED Requirements

### Requirement: The series through a box has one documented spelling
The network-text documentation SHALL state how a rung that runs through a box and on through contacts is spelled, and SHALL state that an infix `AND` whose box operand stands after a contact is an `AND` box.

#### Scenario: Box first
- **WHEN** an LD network holds `y := GT(EN := c, i, j) AND a;`
- **THEN** the documentation names it a series through the box `GT` and the contact `a`

#### Scenario: Box later
- **WHEN** an LD network holds `y := a AND GT(EN := c, i, j);`
- **THEN** the documentation names it an `AND` box fed by the contact `a` and the `GT` box
