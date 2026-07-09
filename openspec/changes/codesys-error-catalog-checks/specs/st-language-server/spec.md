## ADDED Requirements

### Requirement: Offline diagnostics are traceable to the CODESYS error catalog

The set of offline semantic diagnostics the LSP emits SHALL be driven by, and traceable to, the CODESYS compiler-error catalog (codes `C0001`–`C0587`). A structured catalog SHALL exist that records, for every code, its exact compiler message template(s), a category, a minimal repro, and a coverage status of exactly one of `covered` (an existing check mirrors it), `checkable` (offline-analyzable — a check SHALL be implemented), or `ide-only` (needs a live build or library resolution — out of LSP scope). Each diagnostic the LSP emits that mirrors a catalog code SHALL carry that `Cnnnn` code as metadata (not as the LSP's own `code`, which stays in the `volt-lsp-iec` namespace). Adopting the catalog SHALL NOT weaken the existing zero-false-positive guarantee or the "IDE stays authoritative" rule: an FP-prone code SHALL be implemented as an opt-in lint (default off), never an always-on check.

#### Scenario: Every emitted diagnostic maps to a catalog code

- **WHEN** the LSP emits an offline diagnostic that mirrors a CODESYS error
- **THEN** the catalog records that code as `covered` and the emitted diagnostic carries the mirrored `Cnnnn` code as metadata

#### Scenario: A checkable code without a check is a visible gap

- **WHEN** a catalog code is triaged `checkable` but no check implements it yet
- **THEN** its catalog status makes the gap explicit (it is not silently absent), and closing it is a unit of implementation work

#### Scenario: An FP-prone catalog code is opt-in, not always-on

- **WHEN** a catalog code cannot be checked offline without false positives (e.g. it depends on unloaded library types)
- **THEN** its check is registered as an opt-in lint that is off by default, and the corpus zero-false-positive gate stays green with the check off

### Requirement: Catalog-mirrored messages are conformance-verified against both IDEs

For any diagnostic the LSP shares with the compilers, the message text SHALL be verified byte-identical against how the live IDE actually builds — captured from the CODESYS (`:8556`) and TwinCAT (`:8555`) `/build` output, which emits each diagnostic as `Cnnnn: <message>`. Wording that has not yet been recorded against a live build SHALL be marked `PROVISIONAL` in the catalog and in the message builder. Per-vendor wording differences SHALL be represented as data in the vendor-keyed message builders, not as unverified guesses; where a vendor does not emit a given diagnostic, that SHALL be recorded rather than assumed.

#### Scenario: A recorded message is locked byte-for-byte

- **WHEN** a check's message has been recorded from a live build for a vendor
- **THEN** the message builder reproduces it exactly for that vendor and the catalog marks it verified (not `PROVISIONAL`)

#### Scenario: Unrecorded wording is provisional

- **WHEN** a check is implemented but its message has not been recorded against a live build
- **THEN** the message is marked `PROVISIONAL` and the code is flagged as awaiting a conformance recording

#### Scenario: A repro reproduces the exact code and message

- **WHEN** a catalog entry's minimal repro is compiled by the live IDE
- **THEN** the build emits the entry's recorded `Cnnnn` code and message, confirming the entry is accurate
