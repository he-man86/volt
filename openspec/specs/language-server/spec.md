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

### Requirement: The LSP is wired into the agent's session for a consumer PLC project

The volt LSP SHALL be available to the AI agent when it edits Structured Text in an **end-user PLC
project**, not only inside the Volt dev repo. `volt init` SHALL register the LSP in the consumer
project's opencode config with a command path that **resolves outside the Volt repo** (e.g. the
published `@opencode-ai/volt-lsp-codesys`, a global install, or a bundled binary). An agent editing
`.st`/`.itf`/… in a bound PLC project MUST receive the LSP's diagnostics through its tool loop.

#### Scenario: Agent gets PLC diagnostics in a consumer project
- **WHEN** the agent edits a `.st` file in an end-user PLC project (not the Volt repo)
- **THEN** the volt LSP is running and its diagnostics are surfaced to the agent — it is not writing ST blind from training data

#### Scenario: The repo-relative path is not relied upon outside the repo
- **WHEN** opencode opens a PLC project whose directory is not the Volt repo
- **THEN** the LSP command still resolves (published/global/bundled), not via `./packages/volt-lsp-codesys/...`

### Requirement: LSP diagnostics cover what the bridge rejects

The LSP's diagnostics SHALL flag any Structured Text that the bridge will reject on push, so the agent's
write-time feedback predicts push success (invariant: LSP diagnostics ⊇ bridge rejections). Where Volt
chooses to accept a form (e.g. signature-only interface methods), the bridge SHALL accept it too — the
LSP and bridge MUST agree on validity.

#### Scenario: A bridge-rejected form is caught at write time
- **WHEN** the agent writes ST the bridge would reject (e.g. an interface `METHOD` with no `END_METHOD`, if Volt keeps that strict)
- **THEN** the LSP reports a diagnostic for it — or, if Volt accepts the form, the bridge accepts it too (no divergence)

