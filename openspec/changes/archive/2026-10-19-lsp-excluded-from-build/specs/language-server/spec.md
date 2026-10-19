## ADDED Requirements

### Requirement: an object excluded from build is not diagnosed as built code
The language server SHALL decide in one function whether an object is excluded from build: its own `%EXCLUDE_FROM_BUILD`
is set, or an object above it in the IDE tree is excluded (a file's own object excludes the whole file). An excluded
object SHALL give no findings, parse errors included, whether or not `diagnoseDeadCode` is on; the missing-language
finding SHALL stay, because it follows the push.

#### Scenario: an excluded FB that built code reaches
- **WHEN** live program `p` instantiates FB `fb`, and `fb`'s body carries `%EXCLUDE_FROM_BUILD` and a type error
- **THEN** the LSP reports nothing inside `fb`

#### Scenario: an excluded method in a built FB
- **WHEN** method `m` of a built FB carries `%EXCLUDE_FROM_BUILD`, and an interface declares a method `m`
- **THEN** the LSP reports nothing inside `m`, and still reports the rest of the FB

#### Scenario: the corpus with dead-code diagnosis on
- **WHEN** the corpus projects are analysed with `diagnoseDeadCode` on
- **THEN** every finding inside an object excluded by its own flag is one the project's recorded build emitted

### Requirement: excluded code is no reachability edge
The identifiers inside excluded code SHALL NOT be reachability edges, and an excluded PROGRAM SHALL NOT be a root.

#### Scenario: code used only from excluded code
- **WHEN** FB `x` is used only inside an excluded method
- **THEN** `x` is dead, as an FB nothing calls is
