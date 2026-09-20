## ADDED Requirements

### Requirement: Every conformance test states which of four questions it answers

The suite SHALL be organised into four tiers — **vendor**, **backends**, **invariants**, **suite** — and every
test file SHALL belong to exactly one and answer exactly one question. The tier SHALL be visible in the file's
name, and the file SHALL state its question in its first paragraph.

#### Scenario: a reader asks which gate should have caught a defect

- **WHEN** a defect is found that the suite did not catch
- **THEN** the tier it belongs to is decidable from the defect alone — an answer that disagrees with the vendor is
  the vendor tier, a property that holds without a vendor is the invariants tier — and the absence is a named gap
  in one file rather than a question about fourteen

#### Scenario: a test that answers two questions

- **WHEN** a file asserts both a vendor agreement and a vendor-independent property
- **THEN** it is split, because a reader cannot otherwise tell which half a failure came from

### Requirement: A regression belongs beside the code it regresses

A test that pins ONE past defect in one module SHALL live in that module's own test file, not in a conformance
tier. A conformance tier holds contracts that are true of the whole product; a regression is true of one function.

#### Scenario: a totality gate accumulating regressions

- **WHEN** a specific input once made lowering throw and a test is added for it
- **THEN** the test goes beside `lower/`, and the conformance tier keeps only the general property — that NO input
  makes lowering throw

### Requirement: A POU that lowers clean has not silently dropped a declaration's initial value

For every corpus POU that lowers with NO diagnostics, every slot whose declaration carried an initializer SHALL
have either a non-default initial value or a statement in the init sequence that assigns it.

This needs no vendor: it is the product checked against its own input. It exists because the opposite — a POU that
lowers clean with a variable silently at its type's default — is a plausible wrong answer that every other tier is
structurally unable to see.

#### Scenario: an initializer is dropped by a refusal that was discarded

- **WHEN** a declaration's initial value is refused and the refusal does not reach the output
- **THEN** the slot holds its type's default while the POU reports nothing, and this gate fails naming the POU and
  the variable

#### Scenario: an initializer is deferred to the init step

- **WHEN** a declaration's initial value is not a constant and becomes an init-step statement
- **THEN** the gate passes, because the value is assigned — the slot's default is the state before the step runs
