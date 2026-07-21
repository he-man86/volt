## ADDED Requirements

### Requirement: Diagnostics are delivered on exactly one channel

The server SHALL NOT push diagnostics (`textDocument/publishDiagnostics`) to a client that advertises pull
diagnostics (`textDocument.diagnostic`); such a client receives them only via the pull channel
(`textDocument/diagnostic` · `workspace/diagnostic`). A client without pull support SHALL receive them via push.
A `didChangeConfiguration` SHALL cause each client kind to observe the updated diagnostics (a push re-publish, or a
`DiagnosticRefreshRequest` prompting a re-pull).

#### Scenario: A pull-capable client is not double-served
- **WHEN** a client initializes with `textDocument.diagnostic` capability, opens a document with an error, and pulls
- **THEN** the pull response contains the diagnostic AND the server has sent NO `publishDiagnostics` for that document

### Requirement: Every semantic diagnostic carries its compiler code

A diagnostic produced by a semantic check SHALL expose the CODESYS `Cnnnn` it mirrors as its LSP `code`, with a
`codeDescription` link to that code's documentation. Codes with no catalog mapping (graphical `VG_*`, raw parse
errors) MAY fall back to their internal identifier. No two diagnostics on a document SHALL share the same
`(range, code)`.

#### Scenario: A diagnostic shows the recognizable code, once
- **WHEN** a document triggers exactly one occurrence of a mapped check (e.g. inout-own-access → C0371)
- **THEN** the client receives a single diagnostic whose `code` is `C0371` and whose `codeDescription` links to its docs

### Requirement: LSP requests stay within a latency budget on real projects

Diagnostics and go-to-definition on the largest corpus project, after a single-character edit, SHALL complete
within a documented latency budget. A request that exceeds the budget is a defect (a regression to root-cause),
not a threshold to raise. Symbol indexing SHALL be incremental — a single-file edit re-indexes that file, not the
whole project — and the incremental index SHALL produce output identical to a full rebuild.

#### Scenario: An edit does not rebuild the world
- **WHEN** one document in a large project is edited by one character and diagnostics are requested
- **THEN** only the changed file (plus cross-file re-links) is re-indexed, the response is within budget, and its
  diagnostics equal those a full-project rebuild would produce
