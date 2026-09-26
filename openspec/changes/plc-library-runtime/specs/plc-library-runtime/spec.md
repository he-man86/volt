## ADDED Requirements

### Requirement: a library element executes only where the project references its library

The transpiler SHALL execute a library element (a function or function block of a referenced library) only when the
element's name resolves to that library's materialized declaration in the project, and the library repo holds its
body for the version the project resolved. Any other library call SHALL remain a reported gap.

#### Scenario: a referenced library's function runs from the repo
- **WHEN** a project references `Standard, 3.5.18.0` and a POU calls `LEN(someString)`
- **THEN** the call lowers to the ST body of `libraries/Standard/3.5.18.0/LEN.fun`, like any project FUNCTION

#### Scenario: an unreferenced library's function is not
- **WHEN** a project does not reference `Standard64` and a POU calls `WLEN(someWString)`
- **THEN** the call is reported as not lowered, as CODESYS reports it undefined

### Requirement: a library element's interface is the materialized one

Every element in the library repo SHALL carry, byte for byte, the declaration the bridge materializes for it —
parameter names, types, capacities and the private variables it shows — adding only a body (and, for a function, a
private VAR block of its own).

#### Scenario: a repo body cannot change a call
- **WHEN** the repo's `CONCAT.fun` is compared with the materialized `CONCAT.fun`
- **THEN** everything but the body and its private VAR block is identical

### Requirement: a library element runs only for the version it was written for

The repo SHALL be keyed by the version a project resolves, and a version it has not written SHALL be refused rather
than served another version's code.

#### Scenario: an unwritten library version is not assumed
- **WHEN** a project resolves `Standard, 3.5.19.0` and the repo holds only `3.5.18.0`
- **THEN** a call to a Standard element is refused as `call-library`

### Requirement: the LSP knows a library only through its materialization

No library element SHALL be hardcoded in the LSP. A library's elements resolve from the declarations the bridge
materializes for a project that references it, and nowhere else.

#### Scenario: a library element in a project without its library
- **WHEN** a project that references no `Standard` declares `t : TON` or calls `LEN`
- **THEN** the LSP reports the name unresolved, as CODESYS does
