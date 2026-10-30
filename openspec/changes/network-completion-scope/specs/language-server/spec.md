## ADDED Requirements

### Requirement: Completion in network text is scoped to the network
Completion inside an LD/FBD network body SHALL offer only the wires declared on that network's `VAR_TEMP` line, and SHALL NOT offer the `???` placeholder as an item.

#### Scenario: Another network's wire is not offered
- **WHEN** completion is requested at an operand of network 1 while only network 2 declares `VAR_TEMP w1 : ANY; END_VAR`
- **THEN** the items do not include `w1`

#### Scenario: The network's own wire is offered
- **WHEN** completion is requested at an operand of network 2, which declares `VAR_TEMP w1 : ANY; END_VAR`
- **THEN** the items include `w1`

#### Scenario: The placeholder is not a variable
- **WHEN** completion is requested in a POU whose network text holds `??? := AND(???, b);`
- **THEN** no item is labelled `???`
