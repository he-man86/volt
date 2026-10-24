## ADDED Requirements

### Requirement: every request states its protocol
A bridge SHALL refuse any request whose `protocol` is absent or is not the protocol it speaks, with the error frame
`PROTOCOL_MISMATCH` naming both numbers, before its body is read.

#### Scenario: a client that states no protocol, or another one
- **WHEN** a request arrives without `protocol`, or with a number other than 1
- **THEN** the answer is `PROTOCOL_MISMATCH` and no op runs

### Requirement: the bridge states its own catalog
`health` SHALL list the ops, the shown languages and the item kinds of the bridge that answers, taken from that host's
declaration.

#### Scenario: the languages a bridge shows
- **WHEN** a client reads `health`
- **THEN** `languages` lists every language the bridge writes as `IMPLEMENTATION <LANG>` and no other

### Requirement: a fact the IDE does not state is absent
A wire value the IDE did not state SHALL be absent, never filled with a default: `dirty`, a diagnostic's `severity`,
`line` and `column`.

#### Scenario: an IDE that does not answer whether its project is saved
- **WHEN** the IDE's saved-state query fails or answers nothing
- **THEN** the health row carries no `dirty`

### Requirement: a push answer is enough to update a baseline
A push answer SHALL name every op that did not land in `conflicts`, by the op's own `name`, and SHALL list the new
version of every path it created or changed (`newItems`) and every path it made disappear (`removed`).

#### Scenario: a rename
- **WHEN** a push renames `A.pou` to `B.pou`
- **THEN** `newItems` holds `B.pou` and `removed` holds `A.pou`

### Requirement: every line on the wire is a line of the item's fetched text
A build diagnostic's `line` SHALL be the 1-based line of its item's fetched `sourceText` that holds the vendor's
position, and SHALL be absent when the bridge cannot place it there with certainty.

#### Scenario: an error inside a method
- **WHEN** the IDE reports an error on line 6 of a METHOD whose declaration has 4 lines
- **THEN** the diagnostic's `line` is the line of the fetched text holding that method's second code line
