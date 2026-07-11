## 1. Rewrite the scaffold (Bun → single Cargo crate in rust/)

- [x] 1.1 In `packages/volt-git/src/scaffold.ts`, replace the Bun file set with: `rust/Cargo.toml` (library crate named via `toPackageName`, edition 2021, empty `[dependencies]`), `rust/src/lib.rs` (placeholder + doc comment: "LSP-transpiled Rust lands here"), `rust/tests/smoke.rs` (example `cargo test`).
- [x] 1.2 Drop the Bun emitters: `package.json`, `bunfig.toml`, `tsconfig.json`, `tests/example.test.ts` and their helper functions.
- [x] 1.3 Update `.vscode/settings.json`: keep the ST file associations; drop `typescript.tsdk`; add `rust-analyzer.linkedProjects: ["rust/Cargo.toml"]`; point watcher/search excludes at `rust/target`.
- [x] 1.4 Rewrite `readme()` for the Cargo workflow (Rust lives in `rust/`, `cargo test`, add crates in `rust/Cargo.toml`, install rustup to build; `src/` is the IDE mirror).
- [x] 1.5 Keep `ScaffoldReport`, the `force`/idempotency behavior, and `toPackageName` unchanged.

## 2. gitignore + init wording

- [x] 2.1 In `packages/volt-git/src/workspace/files.ts`, `ensureGitignore` ignores `/rust/target/` (remove `/node_modules/`); keep the `.opencode/*` entries.
- [x] 2.2 Update `init.ts` JSDoc/comment: "scaffold the Bun project" → "scaffold the Cargo crate".

## 3. Tests

- [x] 3.1 Update `packages/volt-git` scaffold/init tests: assert `rust/Cargo.toml` + `rust/src/lib.rs` + `rust/tests/smoke.rs` are written; assert none of `package.json`/`bunfig.toml`/`tsconfig.json` are.
- [x] 3.2 Assert `.gitignore` contains `/rust/target/` and the tracked tree still gets `.gitattributes` + corpus.
- [x] 3.3 Assert `rust/Cargo.toml` parses as a single `[package]` (no `[workspace]`), so `src/` is never a Cargo target.

## 4. Verify

- [x] 4.1 `bun typecheck` + `bun test` in `packages/volt-git`.
- [x] 4.2 Manual: `volt init` a bound project → confirm the Cargo workspace is written, `src/` is untouched, and (with rustup installed) `cargo test` passes on the scaffold.
- [x] 4.3 `bun run volt-scripts/check-divergence.ts` — still purely additive.

## 5. Spec sync

- [x] 5.1 Archive-time: fold the `ide-sync` delta (Cargo-workspace scaffold; `/target/` gitignore) into `openspec/specs/ide-sync/spec.md`.
