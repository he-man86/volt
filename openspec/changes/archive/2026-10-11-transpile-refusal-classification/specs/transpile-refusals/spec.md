## ADDED Requirements

### Requirement: every refusal names what it asks of the user

Every code the transpiler refuses with SHALL be one of `invalid` (CODESYS refuses the ST too), `not-modelled` (valid ST, not
built) or `not-measured` (valid ST no recording decides), each decided per call site by evidence — the fixtures whose lowering
reaches the site and what the vendor did with them, and the corpora — never by reading alone. A site no evidence decided is
asked first (a fixture, recorded). A site valid ST reaches is never `invalid`. A code whose sites refuse two kinds is split,
one code per kind. A code no fixture, no corpus POU and no written ST reaches is Volt's own gap and is `not-modelled`.

#### Scenario: a refused construct
- **WHEN** lowering refuses a body
- **THEN** its diagnostic's kind is `invalid`, `not-modelled` or `not-measured`; the registry has no other kind

#### Scenario: valid ST reaches a refusal
- **WHEN** a vendor-built fixture or a corpus POU lowers to a refusal site
- **THEN** that site's code is `not-modelled` or `not-measured`, not `invalid` (codes classified before this change are
  named where they still break this, until a change re-reads them)

#### Scenario: one code, two kinds
- **WHEN** one code's sites refuse both invalid ST and valid ST
- **THEN** the code is split, each half with its own kind and its own recording (a site that cannot tell the two apart —
  `pointer-value` at `loadValue`, not given the destination type — is named as mixed in the registry and kept `not-modelled`)
