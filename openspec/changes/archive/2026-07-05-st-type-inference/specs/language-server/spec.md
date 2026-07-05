## ADDED Requirements

### Requirement: Expressions are type-inferred over the body AST

The language server SHALL infer the type of an ST expression by walking the `st-body-ast` expression tree, resolving names through the symbol table and named types through the type resolver. Inference SHALL propagate: literal types (with the integer family's width and signedness, REAL vs LREAL, STRING/WSTRING, TIME); member access (`a.b`) by resolving the base expression's type and looking up the member in its scope; array indexing to the element type; dereference to the pointer's target type; call expressions to the callee's return type; and binary operations to the IEC result type. When any step cannot be resolved, inference SHALL yield an `unknown` type, and every consumer SHALL treat `unknown` as "skip" — never emitting a diagnostic from an unknown-typed expression.

#### Scenario: Member-chain type is inferred, not abandoned
- **WHEN** `motor` is a struct/FB with a `REAL` field `speed`, and an expression reads `motor.speed`
- **THEN** the inferred type of `motor.speed` is REAL (whereas the prior token scan abandoned any `.` expression)

#### Scenario: Unknown type never false-positives
- **WHEN** an expression references a symbol from an unresolved library or an unmodeled construct
- **THEN** its inferred type is `unknown` and no type diagnostic is raised for it

### Requirement: Type-aware diagnostics resolve through compound expressions

The assignment-type, binary-operator, and conversion diagnostics SHALL evaluate operand types via the type-inference walker rather than a single-token heuristic, so that member access, indexing, dereference, calls, and nested expressions are typed rather than skipped. These diagnostics SHALL NOT raise a false positive on any built object of the committed corpora.

#### Scenario: Assignment mismatch through a member l-value
- **WHEN** a `BOOL` value is assigned to `motor.speed` (a REAL field)
- **THEN** the assignment-type diagnostic can evaluate both sides (previously it skipped any member l-value)

#### Scenario: Corpus precision holds
- **WHEN** the deepened checks run over the four corpora
- **THEN** total diagnostics on built objects do not exceed the committed baselines (pro2193 3, bakon-nano 10, awa-palletizer 0, lenze-mid 0)

### Requirement: Call arguments are checked against the callee signature

The language server SHALL check a call expression against the resolved callee's declared parameters: the argument count SHALL be within the callee's required/optional input range, each positional and named argument's inferred type SHALL be assignment-compatible with its parameter, and a named argument SHALL name a parameter the callee actually declares. When the callee or a parameter type cannot be resolved, the affected check SHALL be skipped (no false positive).

#### Scenario: Wrong argument type is flagged
- **WHEN** a function block input declared `INT` is called with a `STRING` argument
- **THEN** a call-argument-type diagnostic is raised

#### Scenario: Unknown named parameter is flagged
- **WHEN** a call uses `paramX := value` and the callee declares no `paramX`
- **THEN** an unknown-named-argument diagnostic is raised (mirroring the VG `vg-unknown-pin` check for ST)

### Requirement: Opt-in narrowing-conversion diagnostic

The language server SHALL provide an opt-in diagnostic for an implicit narrowing / loss-of-precision conversion (e.g. assigning an `LREAL` expression to a `REAL` target), matching the CODESYS compiler's "possible loss of information" warning. It SHALL be validated against the compiler oracle before its corpus floor is set, and SHALL default off unless enabled by config.

#### Scenario: LREAL to REAL narrowing warns when enabled
- **WHEN** the narrowing check is enabled and an `LREAL` expression is assigned to a `REAL` variable
- **THEN** a narrowing-conversion warning is raised, matching the compiler's warning on the same site
