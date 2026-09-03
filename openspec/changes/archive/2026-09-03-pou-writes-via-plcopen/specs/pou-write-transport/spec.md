## ADDED Requirements

### Requirement: A POU is written through the document it is read from

A push that changes a POU SHALL apply the change by importing the PLCopen document for that POU, produced by
splicing the item's current export. It SHALL NOT write part of the item through the PLCopen document and another
part through a second mechanism.

#### Scenario: A textual POU body is pushed

- **WHEN** a POU whose body is textual is pushed with an edited body
- **THEN** the edit is applied by importing the spliced document, and a subsequent read returns the edited body

#### Scenario: A declaration is pushed

- **WHEN** a POU is pushed with an edited declaration
- **THEN** the declaration is carried in the document's plaintext interface and a subsequent read returns it

#### Scenario: A change cannot be expressed in the document

- **WHEN** a requested change has no representation in the PLCopen document
- **THEN** the push fails naming what could not be expressed, rather than applying part of the change through
  another mechanism

### Requirement: A POU write preserves everything the write does not name

Importing a spliced document SHALL preserve the POU's placement and any content the push does not address,
including children it does not mention and vendor metadata Volt does not model.

#### Scenario: The POU lives in a folder

- **WHEN** a POU inside one or more folders is written
- **THEN** it remains in the same folder after the import, rather than being relocated to the project root

#### Scenario: The POU has children the push does not mention

- **WHEN** a POU with methods, actions or properties is written with a change to only one of them
- **THEN** the other children survive the import with their declarations and bodies unchanged

#### Scenario: The POU carries vendor metadata

- **WHEN** a POU whose export contains vendor attributes, pragmas or object ids is written
- **THEN** that metadata is present after the import, because the document was spliced rather than regenerated

### Requirement: A failed POU write leaves the IDE as it was

Because the write is delete-then-reimport, a failure between the two SHALL NOT leave the POU missing.

#### Scenario: The import is rejected

- **WHEN** the IDE rejects the imported document
- **THEN** the original POU is restored and the push reports the rejection, rather than leaving the project
  without the item
