## ADDED Requirements

### Requirement: Library signatures materialize as a read-only libs/ tree

Referenced-library public signatures SHALL materialize into a dedicated `libs/` tree, sibling to
`src/`, as one file per library element using the same kind-based extensions as project source
(`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`), organized by library namespace
(`libs/<Namespace>/<Element>.<ext>`). These files SHALL contain declarations/signatures only (no
implementation bodies) and SHALL be **read-only**: never a push target, never reconciled to the IDE.
The tree SHALL be committed and versioned by a library manifest, changing only when a referenced
library is added, removed, or version-bumped.

#### Scenario: A library element is a kind-named signature file under its namespace
- **WHEN** the `L_MC4P` library exposes a struct `AxesGroup`
- **THEN** it materializes at `libs/L_MC4P/AxesGroup.struct` containing only its declaration, and is not editable or pushable

#### Scenario: libs/ is never pushed
- **WHEN** a push is computed
- **THEN** no file under `libs/` is included — the tree is read-only library mirror, not project source
