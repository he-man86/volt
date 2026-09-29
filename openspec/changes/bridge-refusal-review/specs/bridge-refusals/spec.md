## ADDED Requirements

### Requirement: the bridge refuses only what it cannot write

The bridge SHALL refuse a pushed text only when the write cannot be performed as sent: no declaration/body split, no
child identity, no NWL model for an LD/FBD body, no vendor slot for a value, or a write that would silently drop or
change what the text says. It SHALL NOT refuse a text because the IDE would report it as a compile error; the IDE's
build reports that error and the LSP reports the same.

#### Scenario: identifier spelled like the boundary keyword
- **WHEN** a POU declaring `implementation : INT;` is pushed
- **THEN** it is written, and the build reports whatever it reports

#### Scenario: ST body that looks like network text
- **WHEN** a body stated `IMPLEMENTATION ST` holding `NETWORK … END_NETWORK` is pushed
- **THEN** it is written as sent, and the build reports the syntax error

#### Scenario: undeclared wire-shaped operand
- **WHEN** a network body uses `g7` that no VAR_TEMP or declaration names
- **THEN** it is written as a variable operand, and the build reports the undeclared identifier

#### Scenario: ENO read on a box with no EN
- **WHEN** CODESYS network text reads `.ENO` on a box with no EN
- **THEN** it is written, and the build reports "Missing EN pin"

### Requirement: canonical form is not a refusal

The bridge SHALL write a network-text body or a task descriptor that reads into a complete, writable model, whatever
its layout, and SHALL return the canonical text on the next pull or in the push response.

#### Scenario: non-canonical network text
- **WHEN** a network body has two VAR_TEMP blocks and tokens out of canonical order
- **THEN** it is written, and the next pull shows the canonical text

### Requirement: pull does not judge the IDE's code

Pull SHALL NOT list an item unreadable because of the content of a comment or a code construct the IDE compiles.

#### Scenario: retired Volt comment in a DUT
- **WHEN** a DUT in the IDE holds `(* @volt-note *)`
- **THEN** it is pulled and readable

### Requirement: refusal codes match their category

Every refusal SHALL carry the code of its category: a malformed request `BAD_REQUEST`, a stale version
`STALE_ITEM_VERSION`, a vendor limit `UNSUPPORTED`, a Volt bug `INTERNAL_ERROR`.

#### Scenario: concurrent edit during apply
- **WHEN** an item changes in the IDE between pre-flight and apply
- **THEN** the push is refused `STALE_ITEM_VERSION`

#### Scenario: malformed task descriptor
- **WHEN** a `.task` descriptor has no `Priority:` line
- **THEN** the push is refused `BAD_REQUEST`, not `INTERNAL_ERROR`

### Requirement: no fallback kind

The bridge SHALL NOT default an item or member it cannot classify to a kind (FUNCTION_BLOCK, METHOD); it SHALL refuse
or list the item by name.

#### Scenario: POU whose header does not parse on CODESYS
- **WHEN** a `.prg` whose text opens with an unclosed `(*` is pulled
- **THEN** it is not published as `.fb`
