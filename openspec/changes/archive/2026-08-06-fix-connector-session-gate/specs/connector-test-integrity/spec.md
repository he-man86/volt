## ADDED Requirements

### Requirement: A test harness drives the product's decision code

A harness that exists to make an end-to-end test non-mock SHALL exercise the product's own implementation of any
decision under test. It SHALL NOT contain a second implementation of a decision the product owns, and SHALL NOT
implement different trigger semantics from the component it stands in for.

#### Scenario: The harness re-implements a product decision

- **WHEN** a harness computes an interest-to-serving reconcile itself rather than calling the product's
  `Reconciler`
- **THEN** it is changed to call the product's implementation, so no end-to-end test can pass against behaviour
  the product rejects

#### Scenario: Driving the real implementation changes the outcome

- **WHEN** replacing the harness's copy with the product's implementation changes what an end-to-end test
  observes
- **THEN** that difference is a product finding, recorded and fixed on its own terms with a test that fails
  first — never absorbed by adjusting the harness back
