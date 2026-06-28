# language-server Specification

## Purpose
TBD - created by archiving change review-language-server. Update Purpose after archive.
## Requirements
### Requirement: Navigation and diagnostics, never type-checking

The language server SHALL provide navigation, hover, completion, signature help, semantic tokens,
and diagnostics, but SHALL NOT type-check or generate code — the CODESYS/TwinCAT compiler remains
authoritative. It speaks LSP 3.17 JSON-RPC over stdio and SHALL be spawned only with `--stdio`.

#### Scenario: The IDE compiler stays authoritative
- **WHEN** the LSP analyzes a project
- **THEN** it surfaces navigation + diagnostics but defers final type-checking/codegen to the IDE

### Requirement: The server is vendor-keyed

The server SHALL be named for the vendor ecosystem (`volt-lsp-codesys` covers CODESYS + the
CODESYS-derived TwinCAT). A structurally-different vendor (e.g. Siemens) SHALL be a sibling LSP, not
a new language inside this one. The active dialect SHALL be selected by
`initializationOptions.vendor` (`codesys | twincat | auto`), so a CODESYS project never suggests
TwinCAT-only names.

#### Scenario: Dialect gates vendor-only names
- **WHEN** `vendor` is `codesys`
- **THEN** TwinCAT-only reference entries are not offered in completion or hover

### Requirement: Parsing is error-tolerant

The parser SHALL be error-tolerant, so a half-typed file still yields symbols and diagnostics
rather than failing wholesale.

#### Scenario: A half-typed file still yields symbols
- **WHEN** a file is mid-edit with a syntax error
- **THEN** the server still returns document symbols and diagnostics for the valid portions

### Requirement: Diagnostic defaults mirror TwinCAT

A diagnostic check SHALL be enabled by default only if TwinCAT itself rejects the code; lints
stricter than the compiler SHALL ship off-by-default. Each check is individually gated by an enable flag.

#### Scenario: A stricter-than-compiler lint is off by default
- **WHEN** the default configuration is used
- **THEN** a lint that TwinCAT would accept is not reported unless explicitly enabled

### Requirement: The workspace is cross-indexed

The server SHALL cross-index the whole workspace so that types declared in unopened files resolve.

#### Scenario: A type in an unopened file resolves
- **WHEN** a file references a DUT declared in another, unopened file
- **THEN** go-to-definition and type resolution succeed

