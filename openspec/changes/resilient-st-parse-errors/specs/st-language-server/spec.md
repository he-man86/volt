## ADDED Requirements

### Requirement: Syntax errors are surfaced by resilient parsing, held to the zero-FP gate

The LSP SHALL surface statement- and declaration-level **syntax** errors (a missing or unexpected token in a
statement, expression, or declaration) as diagnostics, each with a precise span and a message, produced by
the parser it already runs. Parsing SHALL be **resilient (error-tolerant)**: an individual syntax error SHALL
produce one diagnostic and SHALL NOT prevent the rest of the body/unit from parsing (no cascade to an
unrelated enclosing error). Every parse SHALL still yield a usable tree for the surrounding valid code.

These surfaced syntax errors SHALL be held to the SAME zero-false-positive guarantee as the semantic checks:
a statement- or declaration-parse error emitted on code that the IDE compiles clean (the corpus and the
recorded conformance set) is a defect (a grammar gap to fix), enforced by the corpus test and the conformance
replay. This supersedes the prior `st-body-ast` design position that statement-parse errors are never
surfaced — now that grammar completeness is measured (100% of corpus ST bodies parse) and gated.

The guarantee that the IDE stays authoritative for statement **semantics** (types, flow, overload/library
resolution) is unchanged: this requirement covers syntax structure the parser already decides, not semantics.

#### Scenario: A missing keyword is reported precisely, not as a cascade

- **WHEN** a POU body contains an `IF` condition with no following `THEN`
- **THEN** the LSP emits a diagnostic at the offending token stating a `THEN` was expected there
- **AND** it does NOT instead emit an unrelated "unterminated <unit>" diagnostic, and the rest of the body
  still parses

#### Scenario: Parse errors never false-positive on clean code

- **WHEN** the parser runs over any body in the corpus or the recorded conformance set (all compile clean in
  the IDE)
- **THEN** it emits zero statement/declaration parse-error diagnostics, and CI fails if any appears

#### Scenario: A surfaced syntax error maps to its catalog code

- **WHEN** the LSP surfaces a syntax error that mirrors a documented CODESYS code (e.g. C0006 for the missing
  keyword)
- **THEN** the diagnostic carries that `Cnnnn` as metadata (not as the LSP's own `code`), consistent with the
  error-catalog mapping
