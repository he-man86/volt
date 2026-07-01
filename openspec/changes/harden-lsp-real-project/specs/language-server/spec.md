## ADDED Requirements

### Requirement: The LSP is verified against a real-project conformance corpus

The LSP SHALL be tested against a committed conformance corpus materialized from a real, full-option
CODESYS project (the project's items rendered as `.st` files on disk). Every language construct the
corpus contains — POUs, DUTs, GVLs, interfaces, methods/properties/actions/transitions, pragmas, and
editable graphical FBD/LD bodies surfaced as VG — SHALL parse and analyze with **no spurious parse
errors and no analysis gaps**. The corpus SHALL be loadable from disk by the test harness and
regenerable via a documented step, so it is a durable regression guard, not a one-off.

#### Scenario: The whole corpus parses without spurious errors
- **WHEN** the LSP loads every `.st` file in the real-project corpus
- **THEN** each file parses into a usable model with no parse-error diagnostic on valid code, and every construct kind present is recognized (not silently skipped)

#### Scenario: The corpus is a committed, regenerable fixture
- **WHEN** the corpus tests run in CI (no live bridge, no CODESYS)
- **THEN** they read the committed `.st` fixtures from disk and pass deterministically, and the corpus can be regenerated from the source project by the documented materialization step

### Requirement: Diagnostics are false-positive-free on valid real code

On the valid, library-heavy code in the real-project corpus the LSP SHALL raise **zero
false-positive diagnostics**. The false-positive-prone semantic checks (unresolved identifier,
unknown pragma, wrong-vendor pragma, and their peers) and their config defaults SHALL be tuned so
that a symbol imported from a library, a vendor-legitimate pragma, or any construct the project
actually compiles is not flagged. Any diagnostic the LSP does raise on the corpus SHALL correspond
to a genuine defect, not to a gap in the LSP's model of real projects.

#### Scenario: A library-imported symbol is not flagged unresolved
- **WHEN** the corpus references a symbol declared in an imported library (not in the workspace `.st` files)
- **THEN** the LSP does not raise an unresolved-identifier diagnostic for it

#### Scenario: The corpus diagnostics sweep is clean
- **WHEN** the diagnostics sweep runs over the whole valid corpus
- **THEN** it reports no diagnostics — a regression that introduces a false positive fails the sweep

### Requirement: Interactive queries meet a performance budget on a large project

The LSP SHALL keep cross-file indexing and interactive queries (go-to-definition, references, hover,
completion, document/workspace symbols) responsive on the large multi-file corpus, within a measured
budget asserted by the test suite. The whole-project index SHALL build once and be reused across
queries rather than re-parsing the project per request.

#### Scenario: Nav queries stay within budget on the corpus
- **WHEN** definition/references/hover/completion run against the fully-indexed real-project corpus
- **THEN** each query returns within the asserted budget, and the project index is built once rather than per query
