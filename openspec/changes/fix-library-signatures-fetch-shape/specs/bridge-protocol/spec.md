## ADDED Requirements

### Requirement: Library signatures are delivered as regular fetch items, not a separate field

The bridge's `/fetch` response SHALL deliver referenced-library public signatures as ordinary items in the `changed`/`items` set — each a normal fetch item (name, folder, read-only source text, version) — so a consumer materializes them through the same path as any other file. The `/fetch` response SHALL NOT carry a bespoke top-level `librarySignatures` field. Library signatures SHALL remain read-only (never a push target).

#### Scenario: A library signature arrives as a normal changed item
- **WHEN** a verbose fetch includes referenced-library signatures
- **THEN** each signature appears in `changed` as a regular fetch item (its rendered declaration as source text), and the response has no separate `librarySignatures` key

#### Scenario: A strict client parses the response without a schema addition
- **WHEN** a client with a strict `/fetch` response schema (no `librarySignatures` field) pulls a project that references libraries
- **THEN** the pull succeeds — the signatures materialize as files with no client schema change
