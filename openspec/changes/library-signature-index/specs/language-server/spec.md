## ADDED Requirements

### Requirement: The LSP resolves symbols against an ambient library scope

The LSP SHALL build an **ambient library scope** from the read-only `libs/` signature tree (in addition
to the project scope) and consult it during name resolution. A reference to a library symbol — bare or
namespace-qualified (`PACK_ML.State`, `L_MC4P.Foo`, `StrConcatA(...)`) — that resolves to a library
signature SHALL NOT be flagged unresolved. The library scope SHALL be keyed by namespace so a library
symbol and a same-named project symbol do not collide. Hover, completion, signature-help, and
go-to-definition SHALL surface library signatures from this scope. The hand-curated standard-function
table is thereby superseded for indexed libraries and retained only as a fallback for un-indexed names.

#### Scenario: A library symbol resolves and is not flagged
- **WHEN** a built object references a library type/FB/function that has a signature under `libs/`
- **THEN** the LSP resolves it and emits no unresolved-identifier diagnostic

#### Scenario: Namespaced resolution avoids collisions
- **WHEN** a project declares `State` and the `PACK_ML` library also defines `State`
- **THEN** `PACK_ML.State` resolves to the library signature and a bare `State` resolves to the project symbol — neither shadows the other

#### Scenario: Hover shows a library signature
- **WHEN** the cursor is on a library symbol reference
- **THEN** hover renders that symbol's declaration/signature from the `libs/` tree
