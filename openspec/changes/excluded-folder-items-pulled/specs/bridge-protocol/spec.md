## ADDED Requirements

### Requirement: a folder's build property is its read-only descriptor
A folder whose build property is off its defaults SHALL have a read-only descriptor `<folder path>/<FolderName>.folder`
stating that build property, and SHALL NOT appear in `unreadableNodes` for it. A folder at its defaults SHALL have none.

#### Scenario: an excluded folder
- **WHEN** folder `Application/Old` is excluded from build
- **THEN** `items` holds `Application/Old/Old.folder`, whose `Exclude from build` row is set, and `unreadableNodes` does not
  name `Application/Old`

#### Scenario: a push to the descriptor
- **WHEN** a push sets `Application/Old/Old.folder`
- **THEN** it is refused as a push to any read-only descriptor is

### Requirement: an item in an excluded folder is an ordinary item
An item inside an excluded folder SHALL be in `items` with its own text, carrying only its own properties, SHALL NOT be in
`unreadable` for the folder's exclusion, and a push SHALL treat it as any other item.

#### Scenario: a DUT in an excluded folder
- **WHEN** excluded folder `Application/Old` holds DUT `a` with no build setting of its own
- **THEN** `items` holds `Application/Old/a.dut`, its text has no `%EXCLUDE_FROM_BUILD`, and `unreadable` does not name it

#### Scenario: an edit pushed back
- **WHEN** a client changes `a`'s body and pushes it
- **THEN** the body is written, and neither `a`'s nor the folder's build property changes

### Requirement: exclusion from build has one spelling on both vendors
A TwinCAT item excluded from build SHALL pull with `%EXCLUDE_FROM_BUILD`, as on CODESYS, and SHALL NOT be in `unreadable`
for it. A TwinCAT folder excluded from build, where TwinCAT has that setting, SHALL have the same `.folder` descriptor.

#### Scenario: an excluded TwinCAT POU
- **WHEN** TwinCAT POU `b` is excluded from build
- **THEN** `items` holds it with `%EXCLUDE_FROM_BUILD`, byte-identical to the CODESYS text of the same POU

### Requirement: the LSP treats effectively excluded code as uncompiled
The LSP SHALL treat an item as excluded when its own `%EXCLUDE_FROM_BUILD` is set or a folder above it has a `.folder`
descriptor stating `Exclude from build`. An excluded item SHALL get no diagnostics, and its declarations SHALL NOT be in
the scope that built items resolve against.

#### Scenario: built code calls an excluded function block
- **WHEN** built program `p` instantiates FB `fb` that sits in excluded folder `Application/Old`
- **THEN** the LSP reports `fb` in `p` as the recorded build reports it, and reports nothing inside `fb`
