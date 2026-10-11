## ADDED Requirements

### Requirement: an abstract member reads the same on both vendors
An `ABSTRACT` member with no code SHALL be pulled as `IMPLEMENTATION NONE` on CODESYS and on TwinCAT, whoever made the
object, and a push of it SHALL write no body where the object has no body slot and an empty body where it has one.

#### Scenario: the same declaration on both vendors
- **WHEN** an FB with an abstract method is pulled from CODESYS and from TwinCAT
- **THEN** both texts are byte-identical, with `IMPLEMENTATION NONE` under the abstract method

#### Scenario: migrating an abstract member
- **WHEN** an owner holding `IMPLEMENTATION NONE` is created in a blank project on either vendor
- **THEN** the push is accepted and the next pull reads it back unchanged
