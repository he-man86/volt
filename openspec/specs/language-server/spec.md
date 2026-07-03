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

The server SHALL be named for the vendor ecosystem (`volt-lsp-iec` covers CODESYS + the
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
project**, not only inside the Volt dev repo. The agent toolchain — LSP + `volt` tool + agent + theme
+ permissions — SHALL be handed to opencode as one read-only config dir via the **`OPENCODE_CONFIG_DIR`**
env var (set by the desktop shell and the `volt` binary), with that config's bin dir prepended to
`PATH` so its bare-name `volt-lsp-iec` command resolves **outside the Volt repo** (published /
global / bundled — never a repo-relative path). `volt init` SHALL NOT write a per-project `.opencode/`;
it only binds the IDE project and installs vendor skills. An agent editing `.st` in a bound PLC
project MUST receive the LSP's diagnostics through its tool loop.

#### Scenario: Agent gets PLC diagnostics in a consumer project
- **WHEN** the agent edits a `.st` file in an end-user PLC project (not the Volt repo)
- **THEN** the volt LSP is running and its diagnostics are surfaced to the agent — it is not writing ST blind from training data

#### Scenario: The command resolves by bare name, not a repo-relative path
- **WHEN** opencode opens a PLC project whose directory is not the Volt repo
- **THEN** the LSP command resolves via the `OPENCODE_CONFIG_DIR` bin on `PATH` (published/global/bundled), not via `./packages/volt-lsp-iec/...`

### Requirement: LSP diagnostics cover what the bridge rejects

The LSP's diagnostics SHALL flag any Structured Text that the bridge will reject on push, so the agent's
write-time feedback predicts push success (invariant: LSP diagnostics ⊇ bridge rejections). Where Volt
chooses to accept a form (e.g. signature-only interface methods), the bridge SHALL accept it too — the
LSP and bridge MUST agree on validity.

#### Scenario: A bridge-rejected form is caught at write time
- **WHEN** the agent writes ST the bridge would reject (e.g. an interface `METHOD` with no `END_METHOD`, if Volt keeps that strict)
- **THEN** the LSP reports a diagnostic for it — or, if Volt accepts the form, the bridge accepts it too (no divergence)

### Requirement: Diagnostics skip build-excluded objects

The LSP SHALL NOT emit semantic diagnostics for an item whose `excludeFromBuild` flag is `true`. Because
the LSP analyzes files on disk with no live bridge, that flag reaches it as the in-file
`(* @volt-exclude-from-build *)` marker written on pull (see workspace-file-extensions "Build-excluded
source is marked in content, not a side manifest"), not a separate manifest. Such
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

