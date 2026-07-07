## ADDED Requirements

### Requirement: Diagnostics traverse every ST body through one shared iterator

The diagnostics engine SHALL iterate Structured Text bodies through a single shared body iterator, used by both the analysis checks and the language services, so there is one definition of "for each ST body, with its unit, scope, and parsed statements." The iterator SHALL cover every ST body of a unit — function block, program, function, method, action, and **property getter/setter accessors** — not only the primary POU body. Introducing the shared iterator SHALL NOT change the diagnostics produced on the committed real-project corpora below their current floors (parse-clean, ingest, and per-corpus ERROR floors), preserving the zero-false-positive guarantee.

#### Scenario: A property accessor body is diagnosed
- **WHEN** a property `GET` or `SET` accessor body contains a checkable error (e.g. an assignment type mismatch)
- **THEN** the diagnostic is produced for the accessor body (previously accessor bodies were skipped by the analysis checks)

#### Scenario: Corpus floors hold under the unified iterator
- **WHEN** the checks run over the four corpora through the shared iterator
- **THEN** parse-clean / ingest / per-corpus ERROR floors are greater-than-or-equal to their current baselines

## MODIFIED Requirements

### Requirement: Call arguments are checked against the callee signature

The language server SHALL check a call expression against the resolved callee's declared parameters: the argument count SHALL be within the callee's required/optional input range, each positional and named argument's inferred type SHALL be assignment-compatible with its parameter, and a named argument SHALL name a parameter the callee actually declares. When the callee or a parameter type cannot be resolved, the affected check SHALL be skipped (no false positive). A call that MIXES a named argument with a positional one SHALL NOT bind the positional argument by index — that mapping is ambiguous, so positional type-checking runs only on all-positional calls. Omitting inputs SHALL NOT be flagged for callables whose inputs are optional (a function block retains its inputs between calls); a too-few-arguments error applies only where the callable requires them (e.g. a FUNCTION).

#### Scenario: Wrong argument type is flagged
- **WHEN** a function block input declared `INT` is called with a `STRING` argument
- **THEN** a call-argument-type diagnostic is raised

#### Scenario: Too many positional arguments is flagged
- **WHEN** a call passes more positional arguments than the callee declares inputs
- **THEN** a call-argument-count diagnostic is raised

#### Scenario: Unknown named parameter is flagged
- **WHEN** a call uses `paramX := value` and the callee declares no `paramX`
- **THEN** an unknown-named-argument diagnostic is raised

#### Scenario: A mixed named+positional call does not false-positive
- **WHEN** a call passes a named argument and then a positional one (`fb(In := x, y)`)
- **THEN** the positional `y` is NOT type-checked against parameter 0; the named argument is still checked by name

#### Scenario: Omitting an optional function-block input is allowed
- **WHEN** a function block with several inputs is called with only some of them
- **THEN** no call-argument-count diagnostic is raised (FB inputs are optional)
