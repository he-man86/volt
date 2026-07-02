## ADDED Requirements

### Requirement: Diagnostics skip build-excluded objects

The LSP SHALL NOT emit semantic diagnostics for an item whose `excludeFromBuild` flag is `true`. Such
objects are never compiled by the IDE, so their references are never checked and have no ground truth;
diagnosing them produces false positives against code the toolchain itself ignores. Excluded items
SHALL still be parsed, indexed, and materialized — only diagnostics are gated. Consequently, the
coverage invariant "a clean-compiling project yields zero diagnostics" holds over **built** objects
only; the coverage harness and its ratchet SHALL measure precision over built objects and report
excluded-object counts separately, never ratcheting them.

#### Scenario: An excluded object produces no diagnostics
- **WHEN** an item is flagged `excludeFromBuild: true` and its body references identifiers declared nowhere
- **THEN** the LSP emits no unresolved-identifier (or other semantic) diagnostics for that item

#### Scenario: A built sibling is still fully checked
- **WHEN** a built item (`excludeFromBuild: false`) has a genuine unresolved reference
- **THEN** the LSP still reports it — exclusion never suppresses diagnostics on built objects

### Requirement: Graphical CFC/SFC bodies are not diagnosed and carry no read-only marker

The LSP SHALL treat a CFC/SFC body as a comment-only informational marker (no `READONLY <LANG>`
detection): it produces no diagnostics because it parses as a comment, and no code path classifies a
body as "read-only" from its content. Read-only *access* for POU languages is not a concept the LSP
models; graphical bodies are simply not analyzed and are edited in the IDE.

#### Scenario: A graphical body yields no diagnostics without special detection
- **WHEN** a POU (or inlined method) body is the CFC/SFC informational marker comment
- **THEN** the LSP produces no diagnostics for it and does not tag it read-only from content
