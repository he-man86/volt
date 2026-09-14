## ADDED Requirements

### Requirement: One home per type concept

Every piece of type knowledge SHALL be defined once in `src/types` and consumed from there by analysis, services, network and transpile.
That covers elementary facts, type construction, family predicates, literal typing, conversion-name parsing, arithmetic
result types, temporal units and string capacity; a consumer SHALL NOT keep its own list of type names or families.

#### Scenario: a literal's type agrees across features

- **WHEN** the LSP checks `b : BYTE := 300` and the transpiler lowers the same literal without context
- **THEN** both take the literal's type from `types/integerLiteralType` and agree it is INT

### Requirement: The layering guard sees every source folder

`scripts/check-layering.ts` SHALL assign a rank to every folder under `src/` and fail on an upward import, so no layer is
exempt by omission.

#### Scenario: a network import against the direction

- **WHEN** a file under `src/network` is imported by a lower layer
- **THEN** the layering lint reports it
