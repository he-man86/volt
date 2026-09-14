## ADDED Requirements

### Requirement: a library element executes only where the project references its library

The transpiler SHALL execute a library element (a function or function block from a referenced library such as
`Standard` or `Standard64`) only when the element's name resolves to that library's materialized signature in the
project. A call to a library element whose library the project does not reference SHALL remain a reported gap.

#### Scenario: a referenced library's function is available
- **WHEN** a project references `Standard` and a POU calls `LEN(someString)`
- **THEN** the call lowers to the `Standard` `LEN` intrinsic

#### Scenario: an unreferenced library's function is not
- **WHEN** a project does not reference `Standard64` and a POU calls `WLEN(someWString)`
- **THEN** the call is reported as not lowered, as CODESYS reports it undefined

### Requirement: a library element's signature is read, not recalled

Parameter names, parameter types and result types of a library element SHALL be taken from the library's
materialized signature files, including string capacities.

#### Scenario: a string function's capacity comes from its signature
- **WHEN** `CONCAT` is lowered
- **THEN** its inputs and result carry the `STRING(255)` capacity its materialized signature declares

### Requirement: a library element's behaviour is verified per library version

Every executed library element SHALL have its behaviour recorded against the IDE, in a project that references the
library at the version the recording names.

#### Scenario: an unrecorded library version is not assumed
- **WHEN** a project resolves a library version for which no recording exists
- **THEN** the element is reported as unverified for that version rather than assumed to match another
