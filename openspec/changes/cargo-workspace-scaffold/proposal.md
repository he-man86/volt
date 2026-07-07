## Why

`volt init` scaffolds a **Bun/TypeScript** dev harness (`package.json`, `bunfig.toml`, `tsconfig.json`,
a `bun:test` example) alongside the PLC `src/`, on the premise that engineers write Bun tests next to
their PLC code. But the real direction is different: the Volt LSP is heading toward **transpiling
Structured Text → Rust**, and the value in the workspace is Rust — compiling/testing the transpiled
output with `cargo test` and pulling in Cargo crates that benefit the project. A Bun harness is the
wrong toolchain for that; engineers get a JS project they don't use and no home for the Rust the LSP
will emit. Swap the scaffold to a **Cargo workspace**.

## What Changes

- **BREAKING (scaffold):** `volt init` SHALL scaffold a **standard Cargo library project** (not a Bun
  project) — kept deliberately simple for the user: one crate, no workspace, no unusual config.
- **A single, plain Cargo crate in a `rust/` folder** — exactly what `cargo new --lib` produces — so
  the load-bearing PLC `src/` (the IDE mirror, keyed across the whole wire) is never touched by Cargo,
  and there is nothing unusual for a non-Rust user to understand ("your Rust lives in `rust/`"):
  - `rust/Cargo.toml` → the crate (named from the PLC project), with an empty `[dependencies]` the user
    grows.
  - `rust/src/lib.rs` → the home for LSP-transpiled Rust (placeholder to start).
  - `rust/tests/smoke.rs` → an example `cargo test` — the parity replacement for the Bun example test.
  - `.vscode/settings.json` gains `rust-analyzer.linkedProjects: ["rust/Cargo.toml"]` so opening the
    repo root just works in the editor.
- **Drop the Bun files** the Cargo harness replaces: `package.json`, `bunfig.toml`, `tsconfig.json`,
  `tests/example.test.ts`, and the `@tsconfig/bun` / `@types/bun` / `typescript` dev-deps.
- **`.gitignore`** SHALL ignore Rust build output (`/rust/target/`) instead of `/node_modules/`.
- **Keep the PLC-specific, vendor-neutral pieces**: `.vscode/settings.json`'s Structured-Text file
  associations (still essential — `.prg` etc. are widely mis-claimed), the language-reference corpus
  install, the `.gitattributes` LF normalization, and the `.git/volt/` binding. `.vscode/settings.json`
  swaps its TypeScript hints for rust-analyzer-friendly ones.
- **README** SHALL describe the Cargo workflow (`cargo test`, add crates in `Cargo.toml`) instead of
  `bun install`/`bun test`.
- Idempotency and the `force` behavior SHALL be preserved.

## Capabilities

### New Capabilities
<!-- none — this reshapes the existing ide-sync scaffold -->

### Modified Capabilities
- `ide-sync`: The "project scaffold" the tracked tree receives changes from a Bun project
  (`package.json`/tsconfig/bunfig) to a **single standard Cargo crate under `rust/`**. The
  `.gitignore`/`.gitattributes`/corpus requirements are unchanged except `.gitignore` now ignores
  `/rust/target/`.

## Impact

- **`packages/volt-git/src/scaffold.ts`** — rewrite `writeWorkspaceScaffold` to emit the Cargo
  workspace files instead of the Bun files; `ScaffoldReport`/idempotency shape unchanged.
- **`packages/volt-git/src/workspace/files.ts`** — `ensureGitignore` adds `/target/` (drops
  `/node_modules/`).
- **`packages/volt-git/src/init.ts`** — comment/JSDoc wording ("scaffold the Bun project" → "scaffold
  the Cargo workspace"); flow unchanged.
- **Tests** — `packages/volt-git` scaffold/init tests that assert `package.json`/tsconfig get updated to
  assert `Cargo.toml` + the member crate.
- **Spec** — `openspec/specs/ide-sync/spec.md` scaffold scenario updated (see Modified Capabilities).
- **No change** to the bridge, the sync engine, `src/` layout, or the agent-config unify model. The
  transpiler itself is out of scope — this only gives its output a place to live and compile.
