## ADDED Requirements

### Requirement: every lowering diagnostic names its file
A diagnostic of `lowerSource` SHALL carry the URI of the file its span is in, and the span SHALL point at the cause in that
file. A refusal in no file, or whose span is not a span of the file it names, SHALL be a lowering bug (thrown), never a
diagnostic. A body that does not lower SHALL be refused once per POU, at that body in its own file, however many calls
reach it.

#### Scenario: a reached LD/FBD POU
- **WHEN** a program in one file calls an LD/FBD POU in another and lowering refuses it
- **THEN** the diagnostic carries the URI of the POU's file and its span is the POU's name there

#### Scenario: two instances of the refused POU
- **WHEN** two instances of that POU are called
- **THEN** there is still one diagnostic, and no `call-body` beside it

#### Scenario: a refusal in a GVL declaration
- **WHEN** the body reaches a GVL variable whose declaration does not lower
- **THEN** the diagnostic carries the GVL's URI and the declaration's span
