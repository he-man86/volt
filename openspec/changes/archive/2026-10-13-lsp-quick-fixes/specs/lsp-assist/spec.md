## ADDED Requirements

### Requirement: a quick fix the compiler accepts
Every quick fix the language server offers SHALL produce text the vendor compiler builds clean for the fixture that
reports its diagnostic, as recorded; a fix without such a recording SHALL NOT be offered. A fix is data on the finding,
produced by the check that reports it; the code-action service only renders it. A fix SHALL NOT be offered when its
range no longer holds the text it was made for, nor when its edit keeps text holding another error.

#### Scenario: declaring an unresolved identifier
- **WHEN** the user applies the fix for an unresolved identifier
- **THEN** the variable is declared with its inferred type and the recorded build of the result is clean

#### Scenario: a stale fix is not offered
- **WHEN** a client hands back a diagnostic published before its latest edit, and the fix's range now holds other text
- **THEN** no action is offered for it

### Requirement: fix all in the file
Fixes marked safe to apply together (the preferred conversion wraps) SHALL be offered as "Fix all '<code>' in the file"
beside the quick fix when the file holds more than one, and as the source action `source.fixAll.volt` — each finding's
first such fix, in document order, none overlapping another.

#### Scenario: two conversion warnings in one file
- **WHEN** a file holds two C0197 findings, each with a preferred wrap
- **THEN** the quick fix of either is accompanied by "Fix all 'C0197' in the file", whose edit applies both wraps

### Requirement: navigation breadth
Workspace symbols SHALL list a POU's methods, properties and actions, an interface's members and an enum's values under
their owner. Call hierarchy SHALL count a call of a function-block instance, of `SUPER^`/`THIS^` and of a PROGRAM as a
call of that body, and SHALL prepare on a property. A rename of a method or property SHALL rename its whole override /
implementation chain, and SHALL be refused by name when that chain reaches a library member.

#### Scenario: renaming the base renames the override
- **WHEN** method `Step` of FB `Base` is renamed, and `Derived EXTENDS Base` overrides `Step`
- **THEN** both declarations and every call of either are renamed
