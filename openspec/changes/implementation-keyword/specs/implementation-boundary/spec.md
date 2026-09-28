## ADDED Requirements

### Requirement: the implementation boundary is IMPLEMENTATION <LANG>

A workspace file SHALL mark where a body's declaration ends and its implementation begins with a line holding only
`IMPLEMENTATION <LANG>`, `<LANG>` being one of `ST`, `LD`, `FBD` (read as text), `CFC`, `SFC`, `IL` (never read:
the body is empty and read-only), or `LD UNSUPPORTED` / `FBD UNSUPPORTED` (an LD/FBD body network text cannot
represent yet: empty and read-only); spacing is free and the keywords are case-insensitive. The line SHALL stand where the comment marker stood, on exactly the items that have an
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

#### Scenario: the keyword inside a comment
- **WHEN** a declaration's block comment holds a line reading `IMPLEMENTATION ST`
- **THEN** that line is part of the comment, and the boundary is the first keyword line outside any comment

#### Scenario: the keyword inside a comment opened mid-line or nested
- **WHEN** a block comment opens after code on its line, or nests another comment, and a line inside it reads
  `IMPLEMENTATION ST`
- **THEN** that line is part of the comment until the outermost comment closes, in the push and the LSP alike

#### Scenario: a second keyword line
- **WHEN** a body holds a second `IMPLEMENTATION <LANG>` line outside any comment
- **THEN** the push refuses it naming the item, nothing is written, and the LSP reports it on that line

#### Scenario: a body in a language Volt does not read
- **WHEN** a body the IDE holds in CFC, SFC or IL is pulled
- **THEN** its keyword line is `IMPLEMENTATION CFC` / `IMPLEMENTATION SFC` / `IMPLEMENTATION IL`, the body under it
  is empty, and pushing the file back unchanged is a no-op

#### Scenario: an LD/FBD body network text cannot represent yet
- **WHEN** an LD or FBD body holds a shape network text has no spelling for (e.g. an assign below the top level)
- **THEN** its keyword line is `IMPLEMENTATION LD UNSUPPORTED` / `IMPLEMENTATION FBD UNSUPPORTED`, the body under it is
  empty, the pull message names the item and the reason, and pushing the file back unchanged is a no-op

#### Scenario: code added under a read-only body
- **WHEN** a pushed body holds code under `IMPLEMENTATION CFC|SFC|IL` or `IMPLEMENTATION LD|FBD UNSUPPORTED`
- **THEN** the push refuses it naming the item, and the IDE keeps the body it had

#### Scenario: a read-only member in a folder
- **WHEN** a member whose body Volt cannot write sits in a folder
- **THEN** its `%FOLDER` directive follows its keyword line, and the file reads back with that folder and that body

#### Scenario: no Volt comment remains
- **WHEN** any item is pulled
- **THEN** its file carries no `(* @volt-… *)` comment of any kind; a pushed file that holds one is refused naming
  `volt pull` as the fix

#### Scenario: IMPLEMENTATION is reserved
- **WHEN** a workspace file names anything `IMPLEMENTATION` (any case): a variable at any scope, a member, the POU,
  an enum value or a struct member
- **THEN** the push refuses it by name as reserved, and the LSP reports it on its declaration

#### Scenario: a file from before the change
- **WHEN** a pushed file carries `(* @volt-implementation *)` and no `IMPLEMENTATION` line, including the old shape
  of a body Volt cannot write (the comment, then the marker line)
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
