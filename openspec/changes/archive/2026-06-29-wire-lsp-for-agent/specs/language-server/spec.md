## ADDED Requirements

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
