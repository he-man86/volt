## ADDED Requirements

### Requirement: Type facts and type policy each have a single source of truth

The language server SHALL encode each elementary-type fact (canonical name, family, bit width, signedness,
value range, numeric widening rank, aliases) in exactly ONE place, and SHALL derive every dependent view (which
names are numeric, which are isolated, date/time family membership, canonicalization) from it rather than
re-listing them. Type-compatibility policy (assignability, narrowing, arithmetic result type, conversion-source
validity) SHALL likewise live in one module built on that table, consumed by every check and query that needs
it — not re-implemented per consumer, and not owned by the reference (hover-content) layer.

#### Scenario: A new elementary fact is added in one place

- **WHEN** an elementary type's range, family, or rank must change or a type is added
- **THEN** it is edited in the single type-facts table and every dependent check/query reflects it, with no
  second list to keep in sync

#### Scenario: Compatibility is decided by one relation

- **WHEN** any check or query asks whether two types are compatible (assignment, argument, conversion, binary
  operator)
- **THEN** it consults the one compatibility module, so the same type pair yields the same verdict everywhere

### Requirement: Navigation and display resolve through shared services

Symbol resolution under the cursor and symbol-kind display SHALL be shared services, so all navigation and
display queries agree. Go-to-definition, hover, references, rename, and highlight SHALL resolve the symbol
under the cursor through the same resolution service; a symbol's human-readable kind label SHALL come from one
function used by every query.

#### Scenario: Definition and references resolve the same symbol

- **WHEN** the cursor is on an identifier and both go-to-definition and find-references run
- **THEN** they resolve to the same symbol via the shared resolution service (no per-query drift)

#### Scenario: One kind label everywhere

- **WHEN** the same symbol is shown in hover and in completion
- **THEN** both display the same human-readable kind label (e.g. "function block"), from one shared mapper

#### Scenario: Call hierarchy is as precise as references

- **WHEN** incoming calls are computed for a method that shares its name with other methods
- **THEN** only genuine callers of THAT symbol are returned (type-aware, matching find-references precision),
  not every same-named call
