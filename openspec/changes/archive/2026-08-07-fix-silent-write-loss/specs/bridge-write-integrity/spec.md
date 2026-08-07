## ADDED Requirements

### Requirement: A write that does not reach the IDE fails loudly

An operation that cannot apply a change to the live IDE SHALL raise a coded error rather than return. It SHALL
NOT report success, and it SHALL NOT leave the caller to infer failure from a later read.

#### Scenario: The object model has no such method

- **WHEN** a reflective call into the vendor object model finds no matching member or overload
- **THEN** the operation fails with a coded error naming the member, rather than treating the missing member as
  a no-op that completes successfully

#### Scenario: A body cannot be read

- **WHEN** reading an item's implementation fails
- **THEN** the item's body language is reported as unknown and any format-dependent guard refuses, rather than
  the unreadable body being classified as textual and overwritten

### Requirement: A write lands on the object it names

An edit applied to a POU SHALL modify that POU's own body. Where an export contains child members, resolution
SHALL be scoped to the named object rather than to the first matching element in the document.

#### Scenario: The POU has a graphical child

- **WHEN** a graphical body is written to a POU whose export also contains a method or action with its own
  graphical body
- **THEN** the root POU's body is replaced and the child's body is untouched

#### Scenario: A child kind has no create path

- **WHEN** a push must create a child whose kind the vendor create-path does not handle
- **THEN** it fails naming the unhandled kind, rather than creating an object of a different kind under the
  requested name

### Requirement: An update never interrupts an in-flight operation

The updater SHALL NOT terminate a process it does not own. Process selection SHALL be by full path within the
install root.

#### Scenario: A sync is running when an update applies

- **WHEN** an update is applied while a CLI operation is writing to the IDE or the git repository
- **THEN** that operation is not terminated by the updater
