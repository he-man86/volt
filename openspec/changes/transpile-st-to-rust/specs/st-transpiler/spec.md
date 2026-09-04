## ADDED Requirements

### Requirement: ST POUs execute headlessly, off the IDE

The toolchain SHALL run a POU's scan logic without the IDE, so PLC logic can be exercised and asserted in a
test. It SHALL consume the shared ST frontend — parser, AST, symbol table and type model — rather than a
second parser or a second type model, and it SHALL cover the executable core of the language: assignment,
expressions, control flow, and function-block calls.

Rust emission is one backend serving this requirement, not the requirement itself.

#### Scenario: a POU produces the expected outputs across scan cycles
- **WHEN** a POU with known inputs is prepared for execution and driven for one or more scan cycles
- **THEN** its outputs match the values the same logic produces in the IDE for those inputs

#### Scenario: the frontend is consumed, not duplicated
- **WHEN** the backend needs a declared type, a name's meaning, a constant, or an IEC type's width
- **THEN** it obtains them from `types/`, `symbols/` and `types/elementary`
- **AND** no second type model, name resolver, or table of IEC type facts exists

### Requirement: A construct that cannot be represented is reported, never guessed

Lowering SHALL be total: it SHALL NOT throw, and SHALL NOT emit a partial or approximated program. Any
construct it cannot represent SHALL be reported as a diagnostic carrying a stable code and a source span, and
the POU SHALL NOT be produced.

An untestable POU is a reported gap. A POU that runs and computes the wrong answer is the failure this
requirement exists to prevent.

#### Scenario: an unsupported construct blocks the POU
- **WHEN** a POU contains a construct the backend does not implement
- **THEN** a diagnostic naming that construct is reported with its span
- **AND** no executable form of the POU is produced

#### Scenario: a graphical body is refused rather than silently emptied
- **WHEN** a POU's body is FBD/LD rather than ST
- **THEN** it is reported as unlowerable
- **AND** it does NOT yield a POU with an empty body that appears to succeed

#### Scenario: an expression with no resolvable type is a gap, not untyped output
- **WHEN** an expression's type cannot be determined from its operands
- **THEN** it is reported
- **AND** no node carrying an unknown type reaches a backend

### Requirement: ST aliasing is never expressed as a target-language reference

A POU SHALL be represented as a flat frame of storage locations addressed by index. Pointers, `REFERENCE TO`
and `VAR_IN_OUT` SHALL lower to positions within that frame, and SHALL NOT lower to a borrowed reference in
the emitted target language.

ST's memory model is one static image with real aliasing; a borrow-checked reference cannot express it, and
the corpus's most-called construct is `ADR`.

#### Scenario: emitted Rust borrows nothing but the frame itself
- **WHEN** a POU is emitted as Rust
- **THEN** the only borrow in the output is the `&mut self` of its scan method
- **AND** the emitted code passes `rustc` with the borrow checker and warnings-as-errors

### Requirement: semantics live in the IR, so a backend decides nothing

Type conversions SHALL be explicit nodes inserted by lowering. Constant-valued constructs — CASE labels among
them — SHALL be resolved before a backend sees them. Loop forms SHALL be normalised to a single shape. A
backend SHALL be a syntax-directed printer or walker over the IR, making no semantic decision of its own.

#### Scenario: a widening conversion is visible in the IR
- **WHEN** an expression mixes two numeric types
- **THEN** the narrower operand is wrapped in an explicit conversion node targeting their common type
- **AND** the backend emits that conversion rather than inferring one

#### Scenario: an operand's type comes from its sibling, not from the assignment target
- **WHEN** an integer-typed variable is divided by an integer literal and assigned to a REAL
- **THEN** the division is performed in the variable's integer type and its RESULT is converted

### Requirement: coverage is measured against POUs that have a body

Backend coverage SHALL be reported over the POUs that contain statements, with declaration-only POUs and
separately-declared METHOD/ACTION bodies counted apart from that figure. The report SHALL rank the constructs
blocking the remainder by how many POUs each would unblock.

Most units in a real project are empty-bodied; counting them yields a coverage figure that rises while
nothing executes.

#### Scenario: the coverage figure cannot be inflated by empty POUs
- **WHEN** coverage is reported over a corpus in which most units have no statements
- **THEN** the headline figure counts only POUs with a body
- **AND** declaration-only and METHOD/ACTION counts are shown separately

### Requirement: vendor-specific behaviour is verified against the IDE, not recalled

The backend SHALL establish every vendor-observable behaviour it reproduces by comparison against a live IDE
build or run, and SHALL NOT write one from recollection or infer one from a name. This covers a built-in
operator's result, a conversion's rounding, and a standard function block's parameter names.

#### Scenario: a built-in's semantics are established by comparison
- **WHEN** a built-in operator or standard function block is implemented
- **THEN** its result is compared against the same call executed in the IDE
- **AND** an implementation that has not been compared is marked as unverified where it is defined
