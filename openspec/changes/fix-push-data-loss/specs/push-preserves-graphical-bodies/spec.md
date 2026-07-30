## ADDED Requirements

### Requirement: A push never overwrites a body format it cannot round-trip

A push SHALL refuse, rather than write, when the target's live body format in the IDE cannot accept the incoming
content. This SHALL hold for a POU's own body **and for every child** (method / action) alike, and the decision
SHALL be made from the driver's live `BodyLanguage`, never from the incoming text — a read-only body has no text
form, so no content marker can identify it reliably.

#### Scenario: A read-only graphical child is refused, not flattened

- **GIVEN** a POU whose method child has a CFC or SFC body in the IDE
- **WHEN** a push carries any body for that child — the round-tripped `(* @volt-graphical: … *)` marker, or real ST
  text that a client edited in its place
- **THEN** the push refuses that item with `UNSUPPORTED`, and the child's body is NOT written

#### Scenario: A textual push over an editable graphical child is refused

- **GIVEN** a POU whose method child has an FBD or LD body in the IDE
- **WHEN** a push carries plain textual source for that child
- **THEN** the push refuses that item with `UNSUPPORTED` rather than flattening the graphical body

#### Scenario: An ordinary textual child still pushes

- **GIVEN** a POU whose method child has a textual body
- **WHEN** a push carries new textual source for it
- **THEN** the child is written normally and no conflict is reported

### Requirement: A refused push leaves the IDE untouched

When a push refuses an item on a body-format grounds, it SHALL NOT have already applied any part of that item.
Child formats SHALL be validated before the item's own body is written, so the IDE never ends up holding a new
parent body beside an unchanged child.

#### Scenario: Nothing is written when a child is refused

- **WHEN** a push to a POU is refused because one of its children has a read-only graphical body
- **THEN** neither the child nor the POU's own body was written
