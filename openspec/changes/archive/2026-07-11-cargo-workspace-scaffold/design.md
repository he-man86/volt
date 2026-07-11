## Context

`writeWorkspaceScaffold` (`packages/volt-git/src/scaffold.ts`) writes a Bun/TS harness on
`volt init`: `.vscode/settings.json`, `README.md`, `bunfig.toml`, `package.json`, `tsconfig.json`,
`tests/example.test.ts`. The PLC source lives in `src/` (the IDE mirror; the whole wire is keyed on
`src/…` names). The Bun `tsconfig` even excludes `src/` so the two coexist.

The direction is Rust: the LSP will **transpile Structured Text → Rust**, and the workspace's job is to
compile/test that Rust (`cargo test`) and let the engineer add Cargo crates. So the harness should be a
Cargo workspace, not a Bun project.

## Goals / Non-Goals

**Goals:**
- `volt init` scaffolds a Cargo workspace that coexists with the untouched PLC `src/`.
- A home for LSP-transpiled Rust + a place for the engineer's Rust tests + the ability to add crates.
- Preserve the PLC-specific aids (ST file associations, corpus, LF normalization) and idempotency.

**Non-Goals:**
- The transpiler itself (ST → Rust) — out of scope; this only gives its output a compile target.
- Requiring a Rust toolchain at `init` time — init only writes files; `cargo` runs when the engineer
  chooses.
- Changing `src/`, the sync engine, the bridge, or the agent-config unify model.

## Decisions

**D1 — One plain Cargo crate in `rust/`, no workspace (simplicity wins).** The user asked for the
setup not to be overcomplicated. A single, standard library crate in `rust/` — literally what
`cargo new --lib rust` produces — is the least there is to understand: "your Rust lives in `rust/`."
The PLC `src/` is never touched because Cargo only compiles `.rs` under the crate dir, and the crate
dir is `rust/`, not the repo root. *Alternatives rejected:* a **virtual workspace** (root
`[workspace]` + member) — makes `cargo test` work at the repo root but adds a second `Cargo.toml` and
the "workspace" concept, which reads as overcomplicated to a non-Rust user; a single root crate with
`[lib] path = "rust/lib.rs"` — one manifest but an unusual override; moving the PLC `src/` (load-bearing,
impossible). Trade-off accepted: `cargo test` runs from `rust/` (or `--manifest-path rust/Cargo.toml`),
which is the normal way people meet a Cargo project; `.vscode` wires rust-analyzer to it so the editor
just works from the repo root.

**D2 — `library` crate named from the PLC project.** Crate name via the existing
`toPackageName(plcProjectName)` sanitizer. It's a **library** crate — transpiled function blocks/DUTs
map to Rust structs/impls (library-shaped), and tests exercise the library. It can grow `[[bin]]`
targets later. If the transpiler eventually needs multiple crates, `rust/` can be promoted to a
workspace then — but not before it's actually needed.

**D3 — Transpiled Rust lands in `rust/src/`.** `rust/src/lib.rs` seeds as a placeholder with a doc
comment stating the LSP writes generated modules here. The generated-module wiring is the transpiler's
concern (future change); the scaffold just establishes the crate.

**D4 — Rust tests in `rust/tests/`.** One example integration test (`rust/tests/smoke.rs`) replaces
`tests/example.test.ts` — the parity "wired up" check, now `cargo test`.

**D5 — Ignore `/rust/target/`.** `.gitignore` ignores Cargo build output at `/rust/target/` and drops
`/node_modules/` (no JS project). `Cargo.lock` is left to the user's first `cargo` run (init never
invokes cargo). The `.opencode/*` ignore entries stay (agent-config hygiene).

**D6 — `.vscode/settings.json` keeps ST associations, swaps TS hints.** The file-association block is
untouched (still essential — `.prg` is widely mis-claimed). Drop `typescript.tsdk`; the watcher/search
excludes point at `/target` instead of `node_modules`. No rust-analyzer dependency is assumed.

**D7 — edition 2021.** Safe, universally supported. Revisit if the transpiler needs newer.

## Risks / Trade-offs

- **No Rust toolchain on the engineer's machine** → `cargo test` fails until they install rustup.
  Mitigation: init never invokes `cargo` (only writes files); the README says install rustup to build.
  Same posture as the Bun scaffold (which needed `bun install`).
- **Cargo auto-discovery surprises** → mitigated by the virtual manifest with no root `[package]`;
  add a scaffold test asserting `cargo metadata`/layout never lists the PLC `src/`.
- **Churn for existing Bun-scaffolded workspaces** → this only affects *new* `volt init` runs; idempotency
  means existing files aren't overwritten without `force`. A migration note can go in the README.

## Open Questions

- If the transpiler later needs multiple crates, promote `rust/` to a workspace at that point — not now
  (keeps today's setup simple).
- Whether to seed any starter dependency (e.g. a fixed-point/decimal crate for IEC numerics) or leave
  `[dependencies]` empty for the user — leaning empty (YAGNI) until the transpiler needs one.
