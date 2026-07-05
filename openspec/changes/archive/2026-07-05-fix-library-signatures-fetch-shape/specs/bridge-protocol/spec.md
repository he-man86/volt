## ADDED Requirements

### Requirement: Library signatures are delivered as regular fetch items, not a separate field

The bridge's `/fetch` response SHALL deliver referenced-library public signatures as ordinary items in the `changed`/`items` set — each a normal fetch item (name, folder, read-only source text, version) — so a consumer materializes them through the same path as any other file. The `/fetch` response SHALL NOT carry a bespoke top-level `librarySignatures` field. Library signatures SHALL remain read-only (never a push target).

#### Scenario: A library signature arrives as a normal changed item
- **WHEN** a verbose fetch includes referenced-library signatures
- **THEN** each signature appears in `changed` as a regular fetch item (its rendered declaration as source text), and the response has no separate `librarySignatures` key

#### Scenario: A strict client parses the response without a schema addition
- **WHEN** a client with a strict `/fetch` response schema (no `librarySignatures` field) pulls a project that references libraries
- **THEN** the pull succeeds — the signatures materialize as files with no client schema change

### Requirement: The bridge returns only items with compiler ground truth

The `/refs` and `/fetch` responses SHALL contain only items the compiler can analyze. An object the IDE will not compile (excluded-from-build) SHALL be omitted from the response entirely — absent from `changed`, `items`, and the aggregate versions. A project POU CODESYS did not compile (dead/uncalled code), detectable only on a `verbose` fetch that ran a build, SHALL likewise be omitted. The response SHALL NOT carry `excludeFromBuild` or `deadCode` metadata fields, and consumers SHALL NOT write in-file ground-truth markers — because a file with no ground truth is never delivered, the LSP never analyzes it and cannot false-positive on it.

#### Scenario: An excluded-from-build object is not returned
- **WHEN** a project contains an object flagged "exclude from build"
- **THEN** neither `/refs` nor `/fetch` lists it (no `changed` entry, no `items` version), and the response carries no `excludeFromBuild` field

#### Scenario: A dead (uncompiled) POU is dropped on a verbose fetch
- **WHEN** a verbose fetch runs a build and a project POU is absent from the compiled model (uncalled)
- **THEN** that POU is omitted from `changed`/`items`, and the response carries no `deadCode` field
