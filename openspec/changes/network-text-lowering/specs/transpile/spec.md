## ADDED Requirements

### Requirement: plain-ST network text is lowered by the interpreter
An LD/FBD body in plain-ST network text SHALL be lowered and run by Volt's interpreter, with the behaviour CODESYS gives
the same network.

#### Scenario: an LD body runs
- **WHEN** a POU whose body is `%LANGUAGE LD` network text is run by the interpreter
- **THEN** each scan's outputs equal CODESYS's for the same inputs
