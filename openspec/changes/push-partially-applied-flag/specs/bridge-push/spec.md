## ADDED Requirements

### Requirement: a refused op's conflict states in fields what of it the IDE kept

A refused op's conflict SHALL carry `partiallyApplied: true` when the live IDE refused the op and part of it stays in
the project (an update's declaration or member, a native rename that ran first, the delete before a forced replace, a
create whose rollback failed), and SHALL name a rename's new name in its own field. When nothing of the op stays, the
conflict SHALL NOT carry `partiallyApplied`.

#### Scenario: an update refused after its declaration was written
- **WHEN** a push of one update is refused on a new member after the item's declaration was written
- **THEN** the conflict carries `partiallyApplied: true`, and its reason says the declaration stays, as today

#### Scenario: a rename that ran before the refusal
- **WHEN** an op renames `A.pou` to `B.pou` and its text is then refused by the IDE
- **THEN** the conflict carries `partiallyApplied: true` and names `B.pou` as the item's current name

#### Scenario: a refused create rolled back
- **WHEN** the IDE refuses a create part-way and the rollback removes the object
- **THEN** the conflict carries no `partiallyApplied`

#### Scenario: a pre-flight refusal
- **WHEN** an op is refused before the first write
- **THEN** the conflict carries no `partiallyApplied`
