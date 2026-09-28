## ADDED Requirements

### Requirement: the implementation boundary is IMPLEMENTATION <LANG>

A workspace file SHALL mark where a body's declaration ends and its implementation begins with a line holding only
`IMPLEMENTATION <LANG>` or `IMPLEMENTATION <LANG> UNSUPPORTED`, `<LANG>` being the body's real language: `ST`, `LD`,
`FBD`, `CFC`, `SFC` or `IL`. Without `UNSUPPORTED` the body under the line is shown and editable (only `ST`, `LD`,
`FBD` can be). With `UNSUPPORTED` Volt shows NO implementation code: the body under the line is empty, push leaves
the IDE's body exactly as it is, and the item's DECLARATION stays fully editable and is pushed as usual. `CFC`, `SFC`
and `IL` are always `UNSUPPORTED`; `LD`/`FBD` are `UNSUPPORTED` when network text cannot represent the body or when
graphical text is disabled in the build; spacing is free and the keywords are case-insensitive. The line SHALL stand where the comment marker stood, on exactly the items that have an
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
- **THEN** its keyword line is `IMPLEMENTATION CFC UNSUPPORTED` / `SFC UNSUPPORTED` / `IL UNSUPPORTED` and no
  implementation code follows; a bare `IMPLEMENTATION CFC` (no `UNSUPPORTED`) is refused by name

#### Scenario: an LD/FBD body network text cannot represent yet
- **WHEN** an LD or FBD body holds a shape network text has no spelling for (e.g. an assign below the top level)
- **THEN** its keyword line is `IMPLEMENTATION LD UNSUPPORTED` / `IMPLEMENTATION FBD UNSUPPORTED`, no implementation
  code follows, and the pull message names the item and the reason

#### Scenario: the declaration of a hidden body is edited
- **WHEN** a file with `IMPLEMENTATION LD UNSUPPORTED` gains a new `VAR_INPUT` and is pushed
- **THEN** the IDE's declaration gets the new input and its LD body is exactly what it was

#### Scenario: nothing in the IDE is overwritten
- **WHEN** any push touches an item whose body is `UNSUPPORTED` (its declaration edited, moved, or unchanged)
- **THEN** the push is not blocked, the IDE's implementation is never written, and reading it back from the IDE
  gives the same body, byte for byte, as before the push; a pull of such an item is never blocked either

#### Scenario: pushing a hidden body back unchanged
- **WHEN** a file with any `UNSUPPORTED` line is pushed unchanged
- **THEN** the push is a no-op

#### Scenario: code added under a hidden body
- **WHEN** a pushed body holds code under an `UNSUPPORTED` line
- **THEN** the push refuses it naming the item, and the IDE keeps the body it had

#### Scenario: a hidden member in a folder
- **WHEN** a member whose body is `UNSUPPORTED` sits in a folder
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

### Requirement: LD and FBD are disabled unless the build enables them

LD/FBD network text SHALL be off by default. It SHALL be on only in a process whose environment sets
`VOLT_GRAPHICAL=1` (development, `ide.ps1`, the test suites, the e2e suites). There SHALL be exactly one flag per
runtime: one in the C# engine (the bridge) and one in the LSP. While it is off, every LD/FBD body SHALL pull as
`IMPLEMENTATION LD|FBD UNSUPPORTED` with the reason "LD and FBD are not enabled in this build", a push carrying
network text SHALL be refused by name, nothing in the IDE SHALL be written for such a body, and the LSP SHALL read
nothing under an LD/FBD line. ST SHALL be unaffected. The bridge SHALL report its flag in `health`, so a client that
needs network text (the corpus refresh, the language recorder) can refuse a bridge that has it off.

#### Scenario: a production build
- **WHEN** a bridge without `VOLT_GRAPHICAL=1` pulls a project with ST and LD bodies
- **THEN** the ST bodies are shown and editable, every LD body is `IMPLEMENTATION LD UNSUPPORTED`, and its declaration
  can still be edited and pushed

#### Scenario: network text pushed to a production build
- **WHEN** a file with `IMPLEMENTATION LD` and network text is pushed to a bridge without `VOLT_GRAPHICAL=1`
- **THEN** the push is refused naming the item and that LD and FBD are not enabled in this build, and nothing is
  written

#### Scenario: an editor started without the variable
- **WHEN** the LSP runs in a process without `VOLT_GRAPHICAL=1` and opens a body stated `IMPLEMENTATION LD`
- **THEN** it reads nothing under that line: no network finding and no refusal; ST bodies are analysed as before

#### Scenario: a production workspace pushed to a development build
- **WHEN** a file pulled from a bridge without `VOLT_GRAPHICAL=1` (its ladder stated `IMPLEMENTATION LD UNSUPPORTED`)
  is edited in its ST and declarations and pushed to a bridge with it
- **THEN** the push is not blocked, the edits land, and the IDE's ladder is never written; a line stating another
  language than the one the IDE holds is refused naming both

#### Scenario: a corpus refresh through a production bridge
- **WHEN** the corpus refresh or the language recorder is pointed at a bridge whose `health` does not report network
  text on
- **THEN** it stops before pulling or pushing anything, naming the switch and `ide.ps1` as the way to turn it on

#### Scenario: a development build
- **WHEN** the bridge runs with `VOLT_GRAPHICAL=1`
- **THEN** LD/FBD bodies pull as network text, as before
