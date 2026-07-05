## ADDED Requirements

### Requirement: Interactive queries meet a performance budget on a large project

The LSP SHALL keep cross-file indexing and interactive queries (go-to-definition, references, hover,
completion, document/workspace symbols) responsive on the large multi-file corpus, within a measured
budget asserted by the test suite. The whole-project index SHALL build once and be reused across
queries rather than re-parsing the project per request. An edit SHALL invalidate only the changed
document's symbols, and `getProjectScope` SHALL recompose from cached per-file symbols rather than
re-parsing the whole workspace.

#### Scenario: Nav queries stay within budget on the corpus
- **WHEN** definition/references/hover/completion run against the fully-indexed real-project corpus
- **THEN** each query returns within the asserted budget, and the project index is built once rather than per query

#### Scenario: An edit re-parses only the changed file
- **WHEN** one document in a large project is edited
- **THEN** only that document's symbols are recomputed and `getProjectScope` recomposes from cached per-file symbols, not a whole-workspace re-parse
