## ADDED Requirements

### Requirement: every stored option of a model has a row
A model's map SHALL hold a row for every member and option its census declares, and a test SHALL fail when the census holds one
the map does not.

#### Scenario: a new member in the census
- **WHEN** a regenerated census declares a member the map has no row for
- **THEN** the completeness test fails and names the member

### Requirement: an unmeasured state is never treated as known
A state whose effect was not measured SHALL have the status `not-measured` and SHALL be refused by name on a push.

#### Scenario: a state that could not be run
- **WHEN** a stored state could not be built or run
- **THEN** its row says `not-measured`, and a push holding it is refused by name
