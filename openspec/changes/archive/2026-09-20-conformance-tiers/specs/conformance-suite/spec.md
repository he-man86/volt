## ADDED Requirements

### Requirement: Every conformance test states which of four questions it answers

The suite SHALL be organised by CONCERN — what could be wrong — and every test file SHALL belong to exactly one
and answer exactly one question. The four are: the fixture contract (an oracle exists and we disagree with it),
the corpus (a false alarm or a crash on code nobody wrote for us), cross-backend (the two backends disagree where
nothing recorded the answer), and whether enough is being ASKED at all. The file's NAME SHALL be the question
rather than the mechanism, and the file SHALL state that question in its first paragraph.

#### Scenario: a reader asks which gate should have caught a defect

- **WHEN** a defect is found that the suite did not catch
- **THEN** the concern it belongs to is decidable from the defect alone — a wrong answer is the fixture contract,
  a false alarm on real code is the corpus, a disagreement nothing recorded is cross-backend, and a question
  nobody put is the fourth — and the absence is a named gap in ONE file rather than a question about thirteen

#### Scenario: a test that answers two questions

- **WHEN** a file asserts both a vendor agreement and a vendor-independent property
- **THEN** it is split, because a reader cannot otherwise tell which half a failure came from. The converse also
  holds and is what the change mostly did: four files asking ONE question through four hand-written selections are
  merged, because a selection that is not total cannot show the case it forgot

### Requirement: A regression belongs beside the code it regresses

A test that pins ONE past defect in one module SHALL live in that module's own test file, not in a conformance
tier. A conformance tier holds contracts that are true of the whole product; a regression is true of one function.

#### Scenario: a totality gate accumulating regressions

- **WHEN** a specific input once made lowering throw and a test is added for it
- **THEN** the test goes beside `lower/`, and the conformance tier keeps only the general property — that NO input
  makes lowering throw

### Requirement: A dropped initial value says so, at the point it is dropped

When a declaration carries an initializer and lowering produces no initial value from it, lowering SHALL record a
diagnostic. A lowering that drops the value and reports nothing SHALL be a refusal in its own right
(`init-dropped`).

**This requirement replaced a different one, and the reason is the finding.** It was first written as a corpus
gate: "for every corpus POU that lowers with no diagnostics, every slot whose declaration carried an initializer
SHALL have either a non-default initial value or a statement in the init sequence." That was built over all three
storages and measured — **386 findings on 3,051 clean-lowering POUs, every one a false positive.** A slot at its
type's default is indistinguishable from a slot initialized TO its default, by construction, so the check cannot
be made downstream; and the escape hatch it needed re-derived each initializer with a second evaluator, which is
the disagreement `ir/evaluate.ts` exists to prevent. The invariant is real, the gate was the wrong instrument, and
what replaced it is a guard at the one line that creates the silence — covering every caller (frame, global,
layout field, routine local) with no corpus, no oracle and no second evaluator.

#### Scenario: an initializer is refused and the refusal does not reach the output

- **WHEN** a declaration's initial value fails to lower and no diagnostic was recorded
- **THEN** lowering refuses with `init-dropped` naming the variable, rather than leaving the slot at its type's
  default in a POU that reports nothing

#### Scenario: an initializer is deferred to the init step

- **WHEN** a declaration's initial value is not a constant and becomes an init-step statement
- **THEN** nothing is refused, because the value IS assigned — the slot's default is the state before the step
  runs, which is the measured semantics

#### Scenario: an initializer whose value is the type's default

- **WHEN** a declaration reads `x : TIME := T#0MS`
- **THEN** nothing is refused: the initializer lowered, and that its value equals the default is not a defect —
  this is the case the rejected corpus gate could not tell from a dropped one
