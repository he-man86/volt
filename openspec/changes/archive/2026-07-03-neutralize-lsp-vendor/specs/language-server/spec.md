## ADDED Requirements

### Requirement: The LSP is one vendor-neutral IEC engine with an evidence-backed dialect layer

The language server SHALL be a single binary that serves both CODESYS and TwinCAT through a runtime
`vendor` setting (`codesys | twincat | auto`) — there SHALL NOT be a separate per-vendor LSP for
CODESYS vs TwinCAT (they are the same IEC 61131-3 language). The package name SHALL be vendor-neutral.

Every vendor-gated behavior (the `wrong-vendor-pragma` check, the CODESYS-only `__`-operator check, and
each `codesys`/`twincat`-tagged reference-catalog entry) SHALL be justified by evidence that both vendors
do NOT accept the item. An item both vendors accept SHALL be tagged `shared`, not vendor-specific, so it
raises no `wrong-vendor` diagnostic.

#### Scenario: One LSP serves both vendors
- **WHEN** a workspace is CODESYS or TwinCAT
- **THEN** the same LSP binary analyzes it, differing only by the runtime `vendor` setting — no separate executable

#### Scenario: A construct both vendors accept is not flagged
- **WHEN** source uses a pragma / operator / identifier that both CODESYS and TwinCAT accept
- **THEN** the LSP raises no `wrong-vendor-pragma` or vendor-only-operator diagnostic for it (it is tagged `shared`)

#### Scenario: A genuinely dialect-specific construct is still flagged
- **WHEN** source uses a construct only one vendor accepts (e.g. a CODESYS-only `__`-operator under a TwinCAT project)
- **THEN** the LSP flags it, backed by recorded ground truth that the active vendor rejects it
