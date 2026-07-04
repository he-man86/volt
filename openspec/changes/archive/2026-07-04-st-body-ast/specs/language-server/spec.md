## ADDED Requirements

### Requirement: ST POU bodies are parsed into a statement/expression AST

The language server SHALL parse the body of every Structured Text POU (function block, program, function, method, action, property accessor) into a statement/expression abstract syntax tree, in addition to the existing token stream. The tree SHALL cover the ST statement forms (`IF`/`ELSIF`/`ELSE`, `CASE`, `FOR`, `WHILE`, `REPEAT`, assignment, `RETURN`/`EXIT`/`CONTINUE`, and bare call statements) and the ST expression forms (binary and unary operators with IEC precedence, member access `a.b`, indexing `a[i]`, dereference `p^`, address-of, function/method calls with positional and named `param := value` arguments, parenthesised sub-expressions, identifiers, and typed/untyped literals). Every node SHALL carry the source span of its tokens so LSP queries can map a node back to document coordinates.

The parsed tree SHALL be exposed on the body model for `language: "st"` bodies. VG (graphical) bodies SHALL retain their existing dedicated model and SHALL NOT be given an ST statement tree.

#### Scenario: Member-chain expression is structured, not flattened
- **WHEN** a body contains `alarmCondition := IMM.AutoOperation AND (ActState = StateWaitForMouldClosed);`
- **THEN** the body model exposes an assignment statement whose right-hand side is a binary `AND` expression, whose left operand is a member-access expression (`IMM` . `AutoOperation`), each node carrying its own source span

#### Scenario: Call arguments are captured with names and positions
- **WHEN** a body contains `Increment.State(ActState, XUnitsToParking(), StateTakeover1PosCheck);`
- **THEN** the tree exposes a call expression on `Increment.State` with three positional arguments, the second of which is itself a call expression

#### Scenario: Statement structure is available for control flow
- **WHEN** a body contains a `CASE ActState OF … END_CASE` with labelled arms
- **THEN** the tree exposes a case statement with its selector expression and one entry per labelled arm, rather than an undifferentiated token run

### Requirement: Body parsing degrades conservatively and never regresses precision

Parsing a body into the statement/expression AST SHALL NOT raise any new diagnostic. When a body cannot be parsed cleanly into the tree, the language server SHALL fall back to the existing token-scan representation for that body so that all current queries and diagnostics continue to function unchanged. Introducing the AST SHALL NOT change the diagnostics produced on the committed real-project corpora: parse-clean percentage, ingest percentage, and the per-corpus diagnostic floors asserted by the corpus ratchet test SHALL be greater-than-or-equal to their current baselines for every corpus (pro2193, bakon-nano, awa-palletizer, lenze-mid).

#### Scenario: Unparseable body still resolves identifiers
- **WHEN** a body contains a construct the new grammar does not yet model
- **THEN** the body model still yields its identifier and call lists via the token-scan fallback, and no parse-error diagnostic is emitted for that body

#### Scenario: Corpus ratchet holds
- **WHEN** the corpus coverage test runs after the AST is introduced
- **THEN** each corpus reports parse-clean, ingest, and total-diagnostic counts no worse than its committed baseline
