## ADDED Requirements

### Requirement: A body runs from its IMPLEMENTATION line to its own END keyword
The bridge's text reader and the LSP SHALL read every element's body — POU, METHOD, ACTION and property accessor —
from its `IMPLEMENTATION` line to its own END keyword, treating nothing inside it as structure. `GET` and `SET` SHALL
count as accessor keywords only outside an accessor's body and its VAR blocks, because they are legal names.

#### Scenario: SET used as a variable inside a setter
- **WHEN** a property's setter body has the line `SET^.x := P;` and `SET` is a declared variable
- **THEN** the line is part of the setter's body, the item reads and pushes, and the LSP reports no accessor error

#### Scenario: An accessor body without its END line
- **WHEN** a getter's body reaches `END_PROPERTY` or `END_SET` before `END_GET`
- **THEN** the item is refused naming both lines, and no part of the body is dropped
