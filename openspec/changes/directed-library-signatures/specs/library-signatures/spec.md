## ADDED Requirements

### Requirement: reading a library returns its signatures

The bridge SHALL answer a directed fetch that names a `.library` item with that library's manifest AND all of its rendered signature items, exactly as a full fetch writes them beside the library, on both vendors, without fetching the project or any other library.

#### Scenario: the pins of a function block
- **WHEN** a client fetches `onlyItems: ["Standard, 3.5.17.0 (System).library"]`
- **THEN** the answer carries the manifest and every rendered signature of that library, among them TON with its inputs, outputs and their types, and no other library's items

#### Scenario: the same on TwinCAT
- **WHEN** the same directed read is made on TwinCAT
- **THEN** the answer carries that library's signatures from TwinCAT's own library manager, in the same item shape

#### Scenario: the extraction is paid once per resolution
- **WHEN** a client reads two libraries one after the other with no library change between
- **THEN** the second read does not run a new extraction for a resolution already extracted in the session

### Requirement: every readable extension is readable by a directed fetch

For every item kind a fetch can return, the bridge SHALL answer a directed fetch naming an item of that kind with the same content for that item as a full fetch gives.

#### Scenario: a kind without a directed read
- **WHEN** a kind is added to `ItemKind` that a full fetch returns
- **THEN** the directed-read test table fails until that kind has a row proving it is readable on its own
