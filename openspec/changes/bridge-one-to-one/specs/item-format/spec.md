## ADDED Requirements

### Requirement: the text is the vendor object one to one
For every item kind, every member of the vendor object SHALL be spelled in Volt's text, unless a recorded measurement
proves it an editor cache, or it SHALL be refused by name; no member is folded, guessed or defaulted.

#### Scenario: a check function migrated
- **WHEN** a pulled `CheckBounds` check function is pushed into a project that does not hold it
- **THEN** it is created as a check function, or the push refuses it by name — never a plain POU reported accepted

#### Scenario: an undecided member
- **WHEN** a vendor object carries a member the disposition table does not list
- **THEN** the completeness oracle fails naming the member

### Requirement: the same object reads the same on both vendors
The same declaration SHALL give byte-identical text on CODESYS and TwinCAT.

#### Scenario: a stub manifest
- **WHEN** a visualization or text list is pulled from either vendor
- **THEN** both texts are identical
