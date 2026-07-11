## MODIFIED Requirements

### Requirement: Machine-local state lives in the .git/volt sidecar

Volt's machine-local state SHALL live inside `.git/volt/` (so git never tracks it): `config.json`
(the bridge binding) and `ide-refs.json` (the optimistic-concurrency baseline). There SHALL be no
visible `.volt/` directory. The bridge port SHALL resolve from `--port`, then `VOLT_BRIDGE_PORT`,
then the workspace binding (the port recorded at `init` from the live bridge), falling back to `8555`.

#### Scenario: Machine-local state is never tracked
- **WHEN** a project is initialized with `volt init`
- **THEN** the bridge binding and IDE baseline are written under `.git/volt/` and never tracked — the tracked tree receives only the project scaffold (the `rust/` Cargo crate / `.gitignore` / `.gitattributes` / corpus), which `init` commits

## ADDED Requirements

### Requirement: init scaffolds a Cargo crate

`volt init` SHALL scaffold a **standard Cargo library crate** (not a Bun/TypeScript project) so the
workspace can compile and test the Rust the LSP transpiles from Structured Text, and so the engineer
can add Cargo crates. The crate SHALL live in a `rust/` subdirectory as a single plain package (no
Cargo workspace), so Cargo never treats the PLC `src/` (the IDE mirror) as Rust source and there is
nothing unusual for a non-Rust user. The scaffold SHALL be idempotent — existing files are kept unless
`force`.

#### Scenario: A plain Cargo crate is written that leaves the PLC src untouched
- **WHEN** `volt init` scaffolds a freshly bound workspace
- **THEN** `rust/Cargo.toml`, `rust/src/lib.rs`, and `rust/tests/*.rs` are written, and `cargo` never compiles the PLC `src/` tree

#### Scenario: The Bun harness is not written
- **WHEN** `volt init` scaffolds a workspace
- **THEN** no `package.json`, `bunfig.toml`, `tsconfig.json`, or `bun:test` example is written

### Requirement: The Cargo scaffold keeps the PLC-specific workspace aids

The Cargo scaffold SHALL retain the vendor-neutral, PLC-specific aids the Bun scaffold provided: the
`.vscode/settings.json` Structured-Text file associations (`.fb`/`.prg`/`.fun`/… → `structured-text`),
the language-reference corpus install, and the `.gitattributes` LF normalization. It SHALL point
rust-analyzer at the crate (`rust-analyzer.linkedProjects: ["rust/Cargo.toml"]`) so the editor works
from the repo root. The root `.gitignore` SHALL ignore Rust build output (`/rust/target/`). The README
SHALL describe the Cargo workflow (`cargo test`, adding crates in `Cargo.toml`).

#### Scenario: ST file associations survive the swap
- **WHEN** the Cargo scaffold is written
- **THEN** `.vscode/settings.json` still maps the kind extensions to `structured-text`, and `.gitignore` ignores `/rust/target/`
