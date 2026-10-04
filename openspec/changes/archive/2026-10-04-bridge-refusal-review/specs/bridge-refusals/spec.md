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

#### Scenario: FB instance of a type nothing declares
- **WHEN** network text calls `t1(IN := a)` and `t1`'s declared type is named by no project item, no library and no
  word the vendor refuses as a POU name
- **THEN** it is written as an instance box of that type on both vendors, and the build reports the unknown type

#### Scenario: instance declared in a list wrapped over two lines
- **WHEN** a declaration reads `a,` / `t2 : TON;` and network text calls `a(IN := b)`
- **THEN** `a` is read as an instance of `TON` (the declaration is read by statement), never as a FUNCTION named `a`

### Requirement: a body's language changes where the vendor writes it

The bridge SHALL decide in ONE comparison that a pushed body changes an existing body's language (ST ⇄ LD/FBD), from
the languages the driver and the ST reader state as facts, never from the body text. It SHALL write the change where
the vendor writes it in place (CODESYS: a POU's, a method's, an action's and a property accessor's body — DIALECT N24)
and SHALL refuse it `UNSUPPORTED` where the vendor cannot (TwinCAT), naming both languages, the vendor's reason and
the route that exists, before the item's first write. LD ⇄ FBD is a view change and is written on both vendors.

#### Scenario: ST over an LD body on CODESYS
- **WHEN** an existing POU or method whose body is LD in CODESYS is pushed with an `IMPLEMENTATION ST` body
- **THEN** it is written on the same object, the next pull states `IMPLEMENTATION ST`, and the project builds

#### Scenario: a language change on TwinCAT
- **WHEN** an existing TwinCAT body is pushed in the other language (ST ⇄ LD/FBD)
- **THEN** the push is refused `UNSUPPORTED` naming both languages and "delete it and push it again", and the item is
  unchanged

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

#### Scenario: TwinCAT member whose tree type maps to no kind
- **WHEN** a TwinCAT member's tree item type maps to no Volt member kind
- **THEN** it is refused by name, never written or read as a METHOD and never given an empty kind

#### Scenario: callee whose header does not parse
- **WHEN** network text calls a function block whose declaration opens with an unclosed `(*`
- **THEN** the call is built as an FB instance of the variable's declared type; no callee header is read (the callee
  is a POU by its kind — the push's wire kind, else the IDE's class)

### Requirement: both vendors answer identically behind the wire

The bridge SHALL give the same wire answer (code, message shape, state after) on CODESYS and TwinCAT for the same
request; a vendor difference SHALL be closed in the driver or the engine below the seam. Only an irreducible vendor fact
the owner accepted MAY remain, named in DIALECT and pinned in the live matrix: a TwinCAT POU loaded broken from disk
(no type stored — DIALECT C2i) is named unreadable where CODESYS fetches it, and a task watchdog is refused
`UNSUPPORTED` on TwinCAT (no published watchdog time — DIALECT C19b). Not built in this change: the internal refactors
D15, D16, D17, D19, D22, D24, D25, D29 and D30 deferred by the owner, the network-text (LD/FBD) live rows, the TwinCAT interface accessor declaration
(D21/D41) and recovery from E_FAIL after a solution reopen — each listed for the owner.

#### Scenario: a rename changes exactly the items the push names
- **WHEN** a push renames an item that other items reference, with no text for those items
- **THEN** on both vendors only the renamed item's header changes; the item's own references and every caller keep their
  text and version, and the answer names only the renamed item

#### Scenario: a rename with its callers in one push
- **WHEN** a push renames an item and sends the callers' new text, in any op order
- **THEN** each caller holds the text sent, and both vendors leave byte-identical refs and texts

#### Scenario: a POU written broken in the current load
- **WHEN** a POU whose text gives TwinCAT no type is pushed and then read in the same IDE load
- **THEN** it is fetched as sent and a create over it answers `ITEM_EXISTS`, on both vendors
