## ADDED Requirements

### Requirement: The disconnect gate has exactly one owner

Whether a bridge refuses sync operations SHALL be decided by one component. A gate set by one client SHALL NOT
be cleared by another component's periodic reconcile as a side effect of unrelated state, and the owning
component SHALL be named in `packages/volt-cli/ARCHITECTURE.md`.

#### Scenario: A paused bridge is not silently resumed

- **WHEN** a client pauses a bridge and a reconcile cycle then runs while some session still declares interest
  in that project
- **THEN** the bridge's gate state is whatever its owner says it is, and any transition is the result of an
  explicit request rather than a side effect

#### Scenario: Two answers to "is this project served" are reconciled

- **WHEN** the connector's session model and a directly-connected CLI disagree about whether a project is served
- **THEN** the disagreement resolves to one answer by a stated rule, and the rule is recorded rather than
  emerging from whichever component acted last

### Requirement: A test harness drives the product's reconciler, not its own

A harness that exists to make an end-to-end test non-mock SHALL exercise the product's own decision code. It
SHALL NOT re-implement a decision the product owns, and in particular SHALL NOT implement different trigger
semantics from the component it stands in for.

#### Scenario: The harness and the product disagree

- **WHEN** a harness re-implements a reconcile the product ships
- **THEN** the harness is changed to call the product's implementation, so an end-to-end test cannot pass
  against behaviour the product rejects

### Requirement: The parked conflict-resolve failures are the acceptance criterion

The two `lifecycle/conflict-resolve` end-to-end tests SHALL pass in suite order with their assertions
unchanged. They pass in isolation today and fail in suite order. Editing them to accommodate this change SHALL
be treated as evidence that the change is wrong.

#### Scenario: The suite passes in order

- **WHEN** the full TwinCAT end-to-end suite is run after this change
- **THEN** `conflict-resolve` passes in suite order as well as alone, with its assertions unchanged
