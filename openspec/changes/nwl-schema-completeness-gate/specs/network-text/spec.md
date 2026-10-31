## ADDED Requirements

### Requirement: every NWL shape has one spelling or a named refusal
The network-text gate SHALL generate every NWL node class, slot and flag combination from the vendor schema, and SHALL
fail when a combination has neither exactly one text spelling nor a refusal by name.

#### Scenario: a shape no corpus holds
- **WHEN** the schema allows a flag on a slot that no corpus network uses
- **THEN** the gate still generates it and requires its spelling or its named refusal
