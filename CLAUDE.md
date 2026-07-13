# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Volt** — a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The repo is a standalone Bun monorepo of `volt-*` packages.

Volt is **opencode-independent**: [opencode](https://opencode.ai) (the open-source AI coding agent) is a **runtime dependency** — a user-provided install — not a fork. Volt makes the user's opencode PLC-aware by handing it one config dir via the `OPENCODE_CONFIG_DIR` env var (LSP + `volt` tool + agent + theme + permissions). We depend on opencode two ways: the installed **binary** at runtime, and **`@opencode-ai/plugin`** (from npm) that the `volt` tool imports. Nothing of opencode's source lives here.

> History: this repo began as a fork of opencode's monorepo. The `extract-clean-repo` / `minimize-opencode-fork` changes (see `openspec/`) removed all opencode source and re-rooted it as the standalone Volt repo. If you find a stray reference to `packages/opencode`, `packages/app`, `check-divergence`, or "the fork" — it's stale; fix it.

## Package map

Bun workspaces + Turbo. All product code is in `packages/volt-*`:

- **`volt-bridge`** (`@opencode-ai/volt-bridge`) — the C# bridges + connector: one live IDE (CODESYS / TwinCAT) over a small HTTP wire.
- **`volt-git`** (`@opencode-ai/volt-git`) — the **`volt` CLI**: git-native PLC sync (`init/pull/push/status/build/log/show/merge`).
- **`volt-lsp-iec`** (`@opencode-ai/volt-lsp-iec`) — TypeScript-native LSP for Structured Text.
- **`volt-control`** (`@opencode-ai/volt-control`) — UI-agnostic core (status/pull/push/health/diagnostics) that powers both frontends.
- **`volt-desktop`** (`@opencode-ai/volt-desktop`) — Electron shell: spawns the installed `opencode serve`, loads its GUI in a `WebContentsView`, adds Volt chrome + the IDE panel over `volt-control`.
- **`volt-vscode`** — VS Code extension (Marketplace-distributed): PLC language intelligence + drift coloring + the `volt-control` views.

The commercial landing site is **not in this repo** — it was removed pending a fresh implementation; the plan lives in `openspec/changes/commercial-landing/` (it will re-enter once opencode's private `console-*` deps are resolved).

**`volt-config/`** (repo root) — the whole agent-facing layer shipped to opencode as ONE dir via `OPENCODE_CONFIG_DIR`: `opencode.json` (LSP registration + `volt` permission gates), `agent/volt.md`, `themes/volt.json`, `tool/volt.ts` (the `volt` CLI as a custom tool), `plugins/volt.tsx`. `@opencode-ai/plugin` is vendored into it (npm) so the tool loads with no registry at runtime. Dev runs `OPENCODE_CONFIG_DIR=$PWD/volt-config opencode`.

Each `volt-*` package has its own `README.md` — read it before deep work there.

## Tooling & common commands

Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

Standard workflows are root `bun run` scripts — prefer these over invoking `volt-scripts/*.ts` by path:

```bash
bun install                 # install workspace deps
bun run dev                 # the Volt-aware agent (OPENCODE_CONFIG_DIR=$PWD/volt-config opencode)
bun run build               # build the TS packages (turbo; the C# bridge builds in `dist`)
bun run dist                # the release bundle → dist/volt/ (both exes + volt-config + .vsix + connector)
bun run compat              # opencode compat gate: integration → lsp-loads → tool-loads (run on an opencode bump)
bun run typecheck           # turbo typecheck across all volt packages
bun run lint                # oxlint
```

`compat` and `dist` are implemented in `volt-scripts/` (product-level orchestration across all packages); the
gate's sub-steps are runnable alone when one fails (`bun volt-scripts/{check-volt-integration,verify-lsp,verify-volt-tool}.ts`).

The `volt` CLI is exposed to opencode two ways: as a first-class **custom tool** (`volt-config/tool/volt.ts`, typed `command`+`args`, mutating verbs prompt for approval) and via gated **bash** (`volt …`, init/pull/push = `ask`). Verify with `opencode debug agent volt` (look for `tools.volt: true`).

Per-package work (run from the package dir, e.g. `packages/volt-git`):

```bash
bun typecheck               # tsc/tsgo --noEmit — ALWAYS use this, never raw `tsc`
bun test                    # bun test runner
bun test path/to/file.test.ts          # single test file
bun test -t "name of the test"         # single test by name
bun run build               # tsc -> dist/ (volt-git, volt-lsp-iec are compiled before publish)
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

Headless CODESYS dev/test loop (Windows/PowerShell): `pwsh packages/volt-bridge/scripts/codesys-bridge.ps1 up|test|down|restart|status|logs`. This runs against its **own headless copy** of a fixture project, never the engineer's live IDE.

## Volt architecture (big picture)

Volt mirrors a git-like workflow for PLC code. The data path is:

```
live PLC IDE  ──HTTP──  bridge (C#)  ──HTTP wire──  volt-git (TS)  ──>  git repo of text files
 CODESYS / TwinCAT       per-vendor                  init/pull/push          analyzed by volt-lsp-iec
                                                      status/build/log         edited in volt-vscode
```

- **`packages/volt-bridge`** — C# bridges exposing one live IDE over a small HTTP wire. **`Volt.Bridge.Core` holds everything shareable; only irreducible vendor glue lives in a bridge.** The parity boundary is the HTTP wire (not the driver), so both vendors serve byte-identical responses for the same project. See `packages/volt-bridge/ARCHITECTURE.md` — read it before touching bridge code; it documents the Core layer stack (`Ide` contract → `Wire` → `Sync` → `Workspace`/`Graphical`) and the **load-bearing CODESYS↔Beckhoff asymmetries that must not be "unified"**.
- **`packages/volt-git`** (`@opencode-ai/volt-git`) — the `volt` command (`init`, `pull`, `push`, `status`, `build`, `log`, `show`, `merge`). **Git-native, single-repo:** `init` makes the project root a git repo; the live IDE is modeled as a git **remote-tracking branch** (`refs/remotes/volt/ide`, shown in the graph as `volt/ide` — the IDE *is* a remote you fetch+merge on pull / push to on push), so `pull`/`push` reconcile through native `git merge` — no custom 3-way merge engine and no separate `.volt/` snapshot. Talks to a bridge over HTTP (one declarative `set`/`delete` push wire); resolves the bridge port from the workspace binding (CODESYS `8556`, Beckhoff `8555`; override via `--port` or `VOLT_BRIDGE_PORT`). See `packages/volt-git/README.md`.
- **`packages/volt-lsp-iec`** (`@opencode-ai/volt-lsp-iec`) — TypeScript-native LSP for Structured Text (nav, diagnostics, completion, hover, signature help, semantic tokens), driven by an embedded CODESYS language reference. Editable FBD/LD bodies are materialized as a textual **VG** form the LSP analyzes as its own first-class sublanguage (CFC/SFC are read-only) — see the VG language note below. Type-checking/codegen stay the IDE's job.
- **`packages/volt-vscode`** — VS Code extension: syntax + language intelligence for PLC languages, plus drift coloring (files the IDE changed vs. git changes).

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `/refs`, `/fetch` `knownItems`, every push op, `structureVersion` (hash of sorted names), and the one-item-per-file layout. This is deliberate and load-bearing across the bridge, `volt-git`, and `volt-vscode`. Same-name items collapse last-write-wins; this is fine for source items (IEC guarantees unique names) and only affects opaque non-source items the AI never edits. **Do not add a "duplicate name" guard that throws** — real projects legitimately repeat opaque names, and throwing breaks `/refs`.

### VG (graphical) language

Editable graphical bodies (FBD/LD) round-trip PlcOpen XML ⇄ a textual **VG** form; CFC/SFC are read-only. The VG language is specified in `packages/volt-bridge/docs/vg-language.md` and `vg-diagnostics.md`. VG wires use inline `LET`. `packages/volt-bridge/ITEM_KINDS.md` / `item-kinds.json` define the vendor-neutral item-type table.

## opencode integration — one env var, additive, safe

- The **installer** sets two persistent user env vars: `OPENCODE_CONFIG_DIR` = the shipped `volt-config`, and `PATH += <bin>` (so the config's bare-name `volt-lsp-iec` / `volt` commands resolve). This is the single mechanism — nothing per-spawn.
- **Additive & safe:** opencode always merges the user's own global config, and `OPENCODE_CONFIG_DIR` is just an *extra* merged directory. Auth lives in opencode's data dir (untouched). So the user's settings + provider keys are preserved; Volt's config merges on top. Uninstall removes the env vars → opencode reverts to vanilla.
- **opencode is a prerequisite** — Volt never bundles, downloads, updates, or uninstalls it. The desktop precheck aborts if `opencode` is absent; the CLI works without it (the agent lights up if/when opencode is present).

## Conventions

- **Git:** default branch is `dev`. Conventional commit messages/PR titles: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful scopes: `bridge`, `cli`, `lsp`.
- **Platform:** primary dev is Windows + PowerShell (the bridges and CODESYS tooling are Windows-only). Bun's Bash tool is also available for POSIX scripts. Bridge build/dev-loop scripts live in `packages/volt-bridge/scripts/*.ps1`; repo-wide tooling (compat gate, dist, installer helpers) in `volt-scripts/`.
- **`.volt/`** is a CLI-managed PLC workspace binding (`.git/volt`); **`volt-config/`** is the agent-config layer handed to opencode. Don't confuse them.
- Design, invariants, roadmap, and the decision log live in **OpenSpec** (`openspec/specs/` + `openspec/changes/`; run `openspec list`). **`VOLT-DESIGN.md`** / **`VOLT-PLAN.md`** are slim pointers.

## Tracking opencode (the compat gate)

Volt tracks opencode by **dependency version + a compat test**, not by merging its source. On an opencode version bump (or `@opencode-ai/plugin` bump), run:

```
bun volt-scripts/sync.ts     # install → integration → lsp loads → tool loads (stops at first ✗)
```

It confirms the current opencode still loads Volt's config: deps resolve, the wiring is intact (`check-volt-integration`), and the LSP + `volt` tool actually load in the **installed** `opencode` (`verify-lsp` / `verify-volt-tool` drive the real binary via `OPENCODE_CONFIG_DIR`). Exit 0 = Volt is compatible with this opencode. `volt-ci.yml` runs the key-free subset (typecheck + lint + integration) on every push/PR; the provider-dependent verifiers run locally / on bumps.

Adding another vendor LSP: `packages/volt-lsp-iec/README.md` → "Adding another vendor LSP".
