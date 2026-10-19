## ADDED Requirements

### Requirement: the suite feeds input nobody types
The LSP suite SHALL include generated deep and long documents past the measured runtime limits, and SHALL assert the
server answers each with findings or one `not-analysed` error, on the shipped runtime.

#### Scenario: nesting past the stack
- **WHEN** a generated document nests parentheses past the shipped runtime's stack
- **THEN** the server answers it with one `not-analysed` error and keeps answering other documents
