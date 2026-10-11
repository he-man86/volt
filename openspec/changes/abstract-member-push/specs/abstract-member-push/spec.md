## ADDED Requirements

### Requirement: An abstract member pulled from the IDE can be pushed back
The bridge SHALL push an owner that holds an abstract member whose object has no body slot without sending a body at
that slot, so an edit of the owner's text is accepted and the abstract member keeps its object, GUID and class.

#### Scenario: A declaration edit beside an abstract method
- **WHEN** a function block pulled from CODESYS holds `METHOD ABSTRACT TakePicture` (an `AbstractPOUMethodObject`,
  no `Implementation` aspect) and a line is added to its declaration in the workspace
- **THEN** the push is accepted, the declaration lands, and no body is written at the method
