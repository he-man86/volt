## ADDED Requirements

### Requirement: An abstract member pulled from the IDE can be pushed back
The bridge SHALL push an owner that holds an abstract member whose object has no body slot without sending a body at
that slot, so an edit of the owner's text is accepted and the abstract member keeps its object, GUID and class.

#### Scenario: A declaration edit beside an abstract method
- **WHEN** a function block pulled from CODESYS holds `METHOD ABSTRACT TakePicture` (an `AbstractPOUMethodObject`,
  no `Implementation` aspect) and a line is added to its declaration in the workspace
- **THEN** the push is accepted, the declaration lands, and no body is written at the method

#### Scenario: The pulled text states a member with no body slot
- **WHEN** CODESYS holds a member whose object holds no `Implementation` aspect (the member declared, holding null) at a
  site whose kind has a body
- **THEN** the pulled text states `IMPLEMENTATION NONE` under it with nothing below, an empty body keeps
  `IMPLEMENTATION ST`, and TwinCAT (whose abstract members have a slot) keeps writing `IMPLEMENTATION ST`

#### Scenario: A body pushed at a member with no slot is refused by name
- **WHEN** a push states `IMPLEMENTATION ST` at a member the IDE holds with no body slot, or `IMPLEMENTATION NONE` at a
  member that has one
- **THEN** the push is refused before any write, naming the member and `volt pull`

#### Scenario: A member created with IMPLEMENTATION NONE is refused with its remedy
- **WHEN** a push creates a member stated `IMPLEMENTATION NONE` — added, or renamed or retyped (which the reconciler
  turns into delete + create)
- **THEN** the push is refused before any write, naming the member and telling the user to change its line to
  `IMPLEMENTATION ST`

#### Scenario: Removing ABSTRACT from a member with no slot is refused as a re-type
- **WHEN** a push keeps `IMPLEMENTATION NONE` under a member the IDE holds with no body slot but drops `ABSTRACT` from
  its declaration (or from its property's, for an accessor)
- **THEN** the push is refused before any write, naming the member and saying the IDE keeps it abstract (a re-type the
  push cannot make in place)

#### Scenario: A member whose object cannot be read is not stated as having no slot
- **WHEN** the driver reads no object for a body site (its declaration read refuses that first), or an object whose
  type declares no `Implementation` member at all (measured on no object: every slotless CODESYS object declares the
  member and holds null there)
- **THEN** the pull refuses that item and never writes `IMPLEMENTATION NONE` for it — the declared-nothing type by name

#### Scenario: A hidden body of a vendor language spelled NONE keeps its UNSUPPORTED line
- **WHEN** a body's view mode, aspect or archive root is spelled NONE
- **THEN** the pull writes `IMPLEMENTATION NONE UNSUPPORTED`, read apart from `IMPLEMENTATION NONE`, and the item stays
  in refs and fetch
