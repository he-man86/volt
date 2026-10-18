## ADDED Requirements

### Requirement: a document whose diagnostics throw does not take down the others
When computing a document's diagnostics throws, the language server SHALL report that document with one `not-analysed`
error saying its findings could not be computed and its declarations are still used, log the error, and SHALL keep
answering every other document's diagnostics. `not-analysed` SHALL mean one fact, "this file has no findings"; its
message SHALL state only the consequence of its own cause (declarations left out after a parse or bind throw; kept after
a findings throw).

#### Scenario: one deep document in the workspace
- **WHEN** the workspace holds a program whose body nests parentheses past the runtime's stack (Node 24 from 3000, bun
  from 20000), and another document with an assignment type mismatch
- **THEN** `workspace/diagnostic` answers the deep document with one `not-analysed` error and the other with its type
  mismatch

#### Scenario: the same document pulled alone
- **WHEN** a client pulls the deep document with `textDocument/diagnostic`, twice in one generation
- **THEN** both answers are the one `not-analysed` error, and the findings are computed (and the error logged) once
