## ADDED Requirements

### Requirement: the implementation boundary is a keyword line

A workspace file SHALL mark where a body's declaration ends and its implementation begins with a line holding only
the keyword `IMPLEMENTATION`, or `IMPLEMENTATION LD` / `IMPLEMENTATION FBD` for a graphical body (spacing free,
keyword case-insensitive). It SHALL appear exactly where the previous comment marker did, on exactly the items that
have an implementation. The comment `(* @volt-implementation *)` SHALL NOT be recognised.

#### Scenario: an ST function block
- **WHEN** a function block with an ST body is pulled
- **THEN** its file holds `IMPLEMENTATION` on its own line between its last declaration line and its first body line

#### Scenario: a ladder method
- **WHEN** a method with an LD body is pulled
- **THEN** its body starts with the line `IMPLEMENTATION LD`

#### Scenario: an identifier named implementation
- **WHEN** a body contains `implementation := 1;`
- **THEN** it is read as code, and the item round-trips unchanged

#### Scenario: a file from before the change
- **WHEN** a pushed file carries `(* @volt-implementation *)` and no keyword line
- **THEN** the push is refused, naming `volt pull` as the fix
