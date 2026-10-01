## ADDED Requirements

### Requirement: SFC steps are not unknown members

For a POU whose implementation is SFC, the language server SHALL NOT report `unknown-member` for a reference to one of that chart's steps or its implicit step state.

#### Scenario: step flag in an SFC program
- **WHEN** an SFC program with step `S_Boot` has ST code reading `S_Boot.x`
- **THEN** no `unknown-member` diagnostic is reported for `S_Boot`

#### Scenario: a real typo still reported
- **WHEN** the same program reads `S_Bot.x` and no step or variable is named `S_Bot`
- **THEN** `unknown-member` is reported for `S_Bot`, or the dialect notes why it cannot be (chart not available)
