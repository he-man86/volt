## ADDED Requirements

### Requirement: One home per type concept

Every piece of type knowledge SHALL be defined ONCE and consumed from that one place by analysis, services, network
and transpile. That covers elementary facts, type construction, family predicates, literal typing, conversion-name
parsing, arithmetic result types, temporal units and string capacity; a consumer SHALL NOT keep its own list of type
names or families.

The one place is `src/types` for everything the TYPE SYSTEM owns, and the LOWEST LAYER THAT NEEDS THE FACT where
the layer stack forbids that. The duration ladder is the case that made the distinction necessary: the literal
PARSER needs it and `syntax` may not import `types`, so it lives in `syntax` and the printers above read it
downward. "In `src/types`" was the original wording and it names a folder where such a fact cannot be put.

A mirror in a target language is not a second home: the Rust prelude restates the duration ladder as source text
because Rust cannot import TypeScript. It SHALL name the measurements it mirrors.

#### Scenario: a literal's type agrees across features

- **WHEN** the LSP checks `b : BYTE := 300` and the transpiler lowers the same literal without context
- **THEN** both take the literal's type from `types/integerLiteralType` and agree it is INT

### Requirement: The layering guard sees every source folder

`scripts/check-layering.ts` SHALL assign a rank to every folder under `src/` and fail on an upward import, so no layer is
exempt by omission.

#### Scenario: a network import against the direction

- **WHEN** a file under `src/network` is imported by a lower layer
- **THEN** the layering lint reports it
