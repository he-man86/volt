## ADDED Requirements

### Requirement: the implementation boundary is IMPLEMENTATION <LANG>

A workspace file SHALL mark where a body's declaration ends and its implementation begins with a line holding only
`IMPLEMENTATION <LANG>`, `<LANG>` being one of `ST`, `LD`, `FBD`; spacing is free and the keywords are
case-insensitive. The line SHALL stand where the comment marker stood, on exactly the items that have an
implementation, and every such body SHALL state its language, ST included. The comment
`(* @volt-implementation *)` SHALL NOT be recognised.

#### Scenario: an ST function block
- **WHEN** a function block with an ST body is pulled
- **THEN** its file holds `IMPLEMENTATION ST` on its own line between its declaration and its body

#### Scenario: a ladder method
- **WHEN** a method with an LD body is pulled
- **THEN** its body starts with the line `IMPLEMENTATION LD`

#### Scenario: a property getter
- **WHEN** a property's getter has an ST body
- **THEN** its accessor holds `IMPLEMENTATION ST` before the getter's code

#### Scenario: a file from before the change
- **WHEN** a pushed file carries `(* @volt-implementation *)` and no `IMPLEMENTATION` line
- **THEN** the push is refused, naming `volt pull` as the fix

### Requirement: the stated language decides how a body is read

A body under `IMPLEMENTATION ST` SHALL be read as ST, and a body under `IMPLEMENTATION LD` or `IMPLEMENTATION FBD` as
network text; nothing else SHALL decide it. A body that contradicts its stated language, or an `IMPLEMENTATION` line
without a known language, SHALL be refused by name on push with nothing written, and SHALL be an LSP diagnostic. It
SHALL never be guessed or re-read as another language.

#### Scenario: network text under ST
- **WHEN** a pushed method's body is `IMPLEMENTATION ST` followed by network text
- **THEN** the push is refused naming the item and its stated language, and the IDE is unchanged

#### Scenario: a missing language
- **WHEN** a pushed method's body opens with `IMPLEMENTATION` alone
- **THEN** the push is refused naming the missing language
