## ADDED Requirements

### Requirement: one text per stored network model
Network text SHALL spell every stored network model with exactly one text, and SHALL read every text as exactly one
stored model, with no dependence on whitespace or on which declarations are in reach.

#### Scenario: a TwinCAT unwired pin
- **WHEN** a TwinCAT network with an unwired FB input is pulled
- **THEN** the pin is left out of the text, not written as `TRUE`
