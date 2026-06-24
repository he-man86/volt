# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a fork of **opencode** (the open-source AI coding agent) that adds **Volt**: a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The `volt-*` packages are the work that lives here; the rest is upstream opencode and is rarely touched. When in doubt, you are almost certainly working in a `volt-*` package.

`AGENTS.md` (style guide, commit conventions, testing rules) and `CONTEXT.md` (V2 session-runtime domain language) are authoritative and apply to upstream opencode code — read them before editing `packages/opencode` / `packages/core` / `packages/llm` etc. The conventions below extend them for Volt.

## Tooling & common commands

Monorepo: **Bun** workspaces + **Turbo**. Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

```bash
bun install                 # install (postinstall patches node-pty)
bun typecheck               # turbo typecheck across all packages
bun lint                    # oxlint
```

Per-package work (run from the package dir, e.g. `packages/volt-cli`):

```bash
bun typecheck               # tsc/tsgo --noEmit — ALWAYS use this, never raw `tsc`
bun test                    # bun test runner
bun test path/to/file.test.ts          # single test file
bun test -t "name of the test"         # single test by name
bun run build               # tsc -> dist/ (volt-cli, volt-lsp-st are compiled before publish)
```

Tests cannot run from the repo root (guard `do-not-run-tests-from-root`) — always `cd` into the package.

### The C# bridges (`packages/volt-bridge`)

The bridges are .NET, not TypeScript. Build/test with `dotnet`:

```bash
# from packages/volt-bridge
dotnet build src/Volt.Bridge.Codesys/Volt.Bridge.Codesys.csproj -c Release    # net48 in-proc CODESYS lib
dotnet build src/Volt.Bridge.Beckhoff/Volt.Bridge.Beckhoff.csproj -c Release  # net8 standalone TwinCAT exe
bun run build:all           # build both bridges
dotnet test test/Volt.Bridge.Tests/                                            # C# unit tests
bun test                    # the package's TS-side e2e tests (test/e2e/**)
```

Headless CODESYS dev/test loop (Windows/PowerShell): `pwsh volt-scripts/codesys-bridge.ps1 up|test|down|restart|status|logs`. This runs against its **own headless copy** of a fixture project, never the engineer's live IDE.

## Volt architecture (big picture)

Volt mirrors a git-like workflow for PLC code. The data path is:

```
live PLC IDE  ──HTTP──  bridge (C#)  ──HTTP wire──  volt-cli (TS)  ──>  .volt/ workspace (text files)
 CODESYS / TwinCAT       per-vendor                  init/pull/push          analyzed by volt-lsp-st
                                                      status/build/merge       edited in volt-vscode
```

- **`packages/volt-bridge`** — C# bridges exposing one live IDE over a small HTTP wire. **`Volt.Bridge.Core` holds everything shareable; only irreducible vendor glue lives in a bridge.** The parity boundary is the HTTP wire (not the driver), so both vendors serve byte-identical responses for the same project. See `packages/volt-bridge/ARCHITECTURE.md` — read it before touching bridge code; it documents the Core layer stack (`Ide` contract → `Wire` → `Sync` → `Workspace`/`Graphical`) and the **load-bearing CODESYS↔Beckhoff asymmetries that must not be "unified"**.
- **`packages/volt-cli`** — the `volt` command (`init`, `pull`, `push`, `status`, `build`, `merge`, `show`, `log`). Talks to a bridge over HTTP; materializes the project into a `.volt/` workspace of one-item-per-file text and a snapshot for three-way merge. Resolves the bridge port from the workspace binding (CODESYS `8556`, Beckhoff `8555`; override via `--port` or `VOLT_BRIDGE_PORT`).
- **`packages/volt-lsp-st`** (`@opencode-ai/volt-lsp`) — TypeScript-native LSP for Structured Text (nav, diagnostics, completion, hover, signature help, semantic tokens), driven by an embedded CODESYS language reference. Graphical bodies (FBD/LD/SFC/CFC) are transpiled to ST at pull time, so the LSP analyzes a single source language. Type-checking/codegen stay the IDE's job.
- **`packages/volt-vscode`** — VS Code extension: syntax + language intelligence for PLC languages, plus drift coloring (files the IDE changed vs. git changes).

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `/refs`, `/fetch` `knownItems`, every push op, `structureVersion` (hash of sorted names), and the one-item-per-file layout. This is deliberate and load-bearing across the bridge, `volt-cli`, and `volt-vscode`. Same-name items collapse last-write-wins; this is fine for source items (IEC guarantees unique names) and only affects opaque non-source items the AI never edits. **Do not add a "duplicate name" guard that throws** — real projects legitimately repeat opaque names, and throwing breaks `/refs`.

### VG (graphical) language

Editable graphical bodies (FBD/LD) round-trip PlcOpen XML ⇄ a textual **VG** form; CFC/SFC are read-only. The VG language is specified in `packages/volt-bridge/docs/vg-language.md` and `vg-diagnostics.md`. VG wires use inline `LET`. `packages/volt-bridge/ITEM_KINDS.md` / `item-kinds.json` define the vendor-neutral item-type table.

## Conventions specific to this fork

- **Git:** default branch is `dev` (not `main` — local `main` may not exist; diff against `dev`/`origin/dev`). Conventional commit messages/PR titles: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful Volt scopes: `bridge`, `cli`, `lsp`.
- **Platform:** primary dev is Windows + PowerShell (the bridges and CODESYS tooling are Windows-only). Bun's Bash tool is also available for POSIX scripts. `volt-scripts/*.ps1` drive the bridges and installers (fork scripts live in `volt-scripts/`; upstream's stay in `script/`).
- The repo retains upstream's package name `opencode` and the `.opencode/` config (LSP wiring for `volt-lsp-st`, and `ask` permission gates on `volt init/pull/push`). Don't confuse `.opencode/` (opencode agent config) with `.volt/` (a CLI-managed PLC workspace).

## Fork surface & upstream sync

Volt is **purely additive** — all product code lives in `packages/volt-*`, and integration uses opencode's extension points (auto-discovered files + config), **never edits to opencode source**. The complete divergence from upstream:

- **Product:** `packages/volt-{bridge,cli,lsp-st,vscode}` — auto-included via the `packages/*` workspace glob (no registration needed).
- **Additive files:** `.opencode/agent/volt.md`, `.opencode/themes/volt.json` (Volt brand theme), `volt-scripts/*` (all fork tooling/installers; upstream's `script/` stays pristine), `CLAUDE.md`. (Language-reference skills are **generated** into a consumer's `.claude/skills/` by `volt init`, not committed here — see `packages/volt-lsp-st/ADDING-A-NEW-LSP.md`.)
- **The only modified upstream files (6 seams):** `bun.lock` (volt deps), `.opencode/opencode.jsonc` (LSP registration + `volt` permission gates), `.opencode/tui.json` (select the Volt brand theme), `turbo.json` (volt test tasks), `.husky/pre-push` (typecheck scoped to volt-*), `.gitignore` (`/memory` junction).

`bun run volt-scripts/check-divergence.ts` enforces this — it fails if any upstream file outside those 6 seams is modified/deleted, **or if a new file is added outside `packages/volt-*`, `volt-scripts/`, `CLAUDE.md`, `.opencode/agent/volt.md`, or `.opencode/themes/volt.json`.** It's the always-accurate map of where the fork's changes live; run it after every upstream merge.

### Syncing upstream (runbook)
1. `git fetch upstream`
2. `git switch -c sync/upstream-dev-<date> <current integration tip>`
3. `git merge upstream/dev` — conflicts only ever appear in the 6 seams
4. `bun install` — resolves the `bun.lock` seam
5. `bun run volt-scripts/check-divergence.ts` — confirm the surface is unchanged
6. `bun run volt-scripts/check-volt-integration.ts` — confirm the wiring still works

Adding another LSP: `packages/volt-lsp-st/ADDING-A-NEW-LSP.md`. Bundle the fork as a version-pinned patch against an opencode release: `bun run volt-scripts/export-overlay.ts`.
