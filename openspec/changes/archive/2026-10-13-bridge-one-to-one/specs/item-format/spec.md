## ADDED Requirements

### Requirement: the text is the vendor object one to one
For every item kind, every member of the vendor object SHALL be spelled in Volt's text, unless a recorded measurement
proves it an editor cache, or it SHALL be refused by name; no member is folded, guessed or defaulted. A member
with about zero occurrences in the corpora MAY instead be recorded in the completeness oracle's known list as "niche:
accepted loss" — held in place by an update, never written by a push.

#### Scenario: a check function migrated
- **WHEN** a pulled `CheckBounds` check function is pushed into a project that does not hold it
- **THEN** it is created as a check function, or the push refuses it by name — never a plain POU reported accepted

#### Scenario: a niche member held
- **WHEN** a recorded niche member (a `POUImageProperty`, a TwinCAT SFC body's `ObjectProperties`) is met
- **THEN** the pull logs it, an update keeps it in the IDE, and the completeness oracle reports it as expected under its reason

#### Scenario: an undecided member
- **WHEN** a vendor object carries a member the disposition table does not list
- **THEN** the completeness oracle fails naming the member

### Requirement: the same object reads the same on both vendors
The same declaration SHALL give byte-identical text on CODESYS and TwinCAT.

#### Scenario: a stub manifest
- **WHEN** a visualization or text list is pulled from either vendor
- **THEN** both texts are identical
