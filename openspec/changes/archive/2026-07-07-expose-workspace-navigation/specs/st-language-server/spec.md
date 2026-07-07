## ADDED Requirements

### Requirement: Call hierarchy is exposed

The language server SHALL support call hierarchy: `textDocument/prepareCallHierarchy` at a callable SHALL return its hierarchy item; `callHierarchy/incomingCalls` SHALL return the callers whose call site resolves — type-aware — to that exact callable; `callHierarchy/outgoingCalls` SHALL return the callables invoked in its body. A same-named method on a different type SHALL NOT be reported as a caller.

#### Scenario: Incoming calls are type-aware
- **WHEN** `prepareCallHierarchy` targets method `Step` on FB `A`, and both `A.Step()` and an unrelated `B.Step()` exist
- **THEN** `incomingCalls` reports the caller of `A.Step()` and NOT the caller of `B.Step()`

#### Scenario: Outgoing calls list invoked callables
- **WHEN** `outgoingCalls` is requested for a POU whose body calls two function blocks
- **THEN** both callees are returned with the call-site ranges

### Requirement: Type hierarchy is exposed

The language server SHALL support type hierarchy: `textDocument/prepareTypeHierarchy` at a function block or interface SHALL return its item; `typeHierarchy/supertypes` SHALL return its `EXTENDS` base and `IMPLEMENTS` interfaces; `typeHierarchy/subtypes` SHALL return every workspace type that extends or implements it.

#### Scenario: Supertypes follow EXTENDS and IMPLEMENTS
- **WHEN** `supertypes` is requested for an FB that `EXTENDS Base IMPLEMENTS I`
- **THEN** both `Base` and `I` are returned

#### Scenario: Subtypes span the workspace
- **WHEN** `subtypes` is requested for an interface implemented by two FBs in different files
- **THEN** both FBs are returned

### Requirement: Workspace symbol search is exposed

The language server SHALL support `workspace/symbol`: given a query string, it SHALL return matching top-level symbols across the indexed workspace as `SymbolInformation`, using the same symbol-kind mapping as document symbols.

#### Scenario: A type is found by name across files
- **WHEN** the client issues `workspace/symbol` with a query matching a DUT declared in an unopened file
- **THEN** the DUT is returned with its location and kind

#### Scenario: Query narrows the result set
- **WHEN** the query matches a subset of symbol names
- **THEN** only matching symbols are returned
