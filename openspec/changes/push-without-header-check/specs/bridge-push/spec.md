## ADDED Requirements

### Requirement: push does not parse a top-level header

The push path SHALL take a top-level item's kind from its wire name's extension and SHALL NOT parse or check the declaration header of the pushed text to decide, check or refuse anything. The text SHALL be written as sent; errors in it are reported by the IDE's build. The push reads only what performing it needs: the `IMPLEMENTATION <LANG>` line that splits a declaration from its body (refused `INVALID_ST` by name when it cannot split), and the headers of CHILD elements (METHOD, ACTION, TRANSITION, PROPERTY with GET/SET, an interface's members), which have no extension of their own. A file the child splitter cannot split is refused by name with its line, never split wrong.

#### Scenario: doc comment never closed
- **WHEN** `ST_X.dut` is pushed whose text opens `(*` on line 1 and never closes it
- **THEN** it is written as sent, and a build that reaches it reports the error

#### Scenario: header of another kind
- **WHEN** `FB_X.pou`, a function block in the IDE, is pushed whose text starts `PROGRAM FB_X`
- **THEN** it is not refused for its header; it stays one object named `FB_X.pou`

### Requirement: a wire name carries only what the IDE stores per object

The bridge SHALL name every item from the IDE object's class, on both vendors, and never from its text or a signature: every DUT is `name.dut`, every PROGRAM, FUNCTION_BLOCK and FUNCTION is `name.pou`, an interface `name.itf`, a global variable list `name.gvl`. No DUT subtype and no POU kind appears in a wire name, and no Volt code decides either. A member's kind (method, property, action, transition) is its class; a member whose text opens with the keyword of another kind is refused on pull by name. The retired names (`.struct`, `.enum`, `.union`, `.alias`, `.prg`, `.fb`, `.fun`) name no kind and are refused `BAD_REQUEST`, never mapped.

#### Scenario: a struct changed to an enum in place
- **WHEN** `ST_X.dut`'s text is changed from a STRUCT to an enumeration, in the IDE or by a push
- **THEN** the next pull reports `ST_X.dut` with new content — the same name, no rename

#### Scenario: a PROGRAM rewritten as a FUNCTION_BLOCK in place
- **WHEN** `X.pou` holding a PROGRAM is pushed with FUNCTION_BLOCK text
- **THEN** it is a content change of `X.pou`, and the pulled file ends `END_FUNCTION_BLOCK`

#### Scenario: a DUT whose text declares nothing
- **WHEN** a DUT's text is an unclosed comment, `TYPE X : END_TYPE`, empty, or prose
- **THEN** it is published as `name.dut` and fetched back as sent, and a build that reaches it reports the error

#### Scenario: a POU whose text is broken
- **WHEN** a POU's text opens with a comment that never closes
- **THEN** on CODESYS it is published as `name.pou` and fetched back, and a build that reaches it reports the error; on TwinCAT see the next scenario

#### Scenario: a TwinCAT POU its IDE does not parse
- **WHEN** a TwinCAT POU's text declares nothing the IDE reads as a POU (its Solution Explorer caption carries no kind)
- **THEN** the walk never opens its tree item (opening it after a reload crashes TcXaeShell), `refs` names it in `unreadable`, an unforced push naming it is refused `UNREADABLE` before any op lands, and a forced push repairs or deletes it through its parent by name

#### Scenario: a retired name
- **WHEN** a push names `X.struct` or `X.fb`
- **THEN** it is refused `BAD_REQUEST` naming the item, and nothing is written

### Requirement: the outer END line mirrors the header

The writer SHALL close a POU's declaration with the END keyword of the header keyword it holds (`PROGRAM` → `END_PROGRAM`, `FUNCTION_BLOCK` → `END_FUNCTION_BLOCK`, `FUNCTION` → `END_FUNCTION`), read past comments, pragmas and attributes; the reader SHALL accept any of the three as the boundary. A header naming none of them gets `END_FUNCTION_BLOCK`, logged by item name.

#### Scenario: the END line mirrors the header
- **WHEN** `X.pou` is pulled and its declaration opens with `FUNCTION_BLOCK`
- **THEN** the file's outer END line is `END_FUNCTION_BLOCK`, and its members follow below it

#### Scenario: a header naming no POU keyword
- **WHEN** `X.pou`'s declaration names no POU keyword
- **THEN** the file's outer END line is `END_FUNCTION_BLOCK`, and the pull logs the fallback for `X.pou`

### Requirement: one op per item

A push SHALL name each item in at most one op (an op's `name` and a set's `toName`, compared case-insensitively); a push naming one item twice is refused `BAD_REQUEST` in its pre-flight and nothing is applied. An update keeps the IDE object, so its class (a persistent-variable list, a check function, a text-list enumeration, an abstract method) survives; the CLI pushes a file deleted and re-added under one name as ONE set.

#### Scenario: a delete and a create of one name
- **WHEN** a push holds `deleteItem X.pou` and `set X.pou`
- **THEN** it is refused `BAD_REQUEST` naming `X.pou`, and nothing is written

### Requirement: the IDE decides which members a POU accepts

When a push creates a member and changes the declaration, the bridge SHALL write the declaration before creating the member. A member create the IDE refuses SHALL be refused `UNSUPPORTED` naming the item, the member, its kind and the IDE's reason; a create is rolled back whole, and an update says what landed.

#### Scenario: a FUNCTION with a method
- **WHEN** `X.pou` is created with FUNCTION text and a METHOD
- **THEN** the push is refused `UNSUPPORTED` naming the method, and no `X` is left in the project
