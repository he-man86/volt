## ADDED Requirements

### Requirement: A push that reports success has committed the work to the IDE's own store

A push that returns success SHALL have committed every applied change to the IDE's persistent store, so the work
survives the IDE process dying. A push SHALL NOT report success for a change that exists only in the IDE's memory.

#### Scenario: A pushed item survives the IDE being killed

- **GIVEN** an item pushed successfully to a live IDE
- **WHEN** the IDE process is killed and reopened on the same project
- **THEN** the item is present with the pushed content

#### Scenario: A failure to commit is reported, not swallowed

- **WHEN** the commit step (TwinCAT `SaveAll`) cannot persist the applied change
- **THEN** the push reports the failure with an error code rather than returning success
