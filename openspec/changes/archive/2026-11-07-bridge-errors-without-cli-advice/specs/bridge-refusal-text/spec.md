## ADDED Requirements

### Requirement: A refusal over the bridge gives advice its reader can follow

A refusal served over the bridge pipe SHALL state what is wrong and what to change in the text or do in the IDE. It SHALL
NOT tell the reader to run a Volt CLI command or perform a workspace step.

#### Scenario: A pushed POU has no %LANGUAGE line

- **WHEN** a client pushes a POU whose text has no `%LANGUAGE` line
- **THEN** the push is refused with `INVALID_ST`
- **AND** the message says to add the line, and names no `volt pull`

#### Scenario: A property the push cannot change

- **WHEN** a push changes something that has no measured write
- **THEN** the refusal says to change it in the IDE
- **AND** it does not say to pull
