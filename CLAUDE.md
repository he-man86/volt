# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is a fork of **opencode** (the open-source AI coding agent) that adds **Volt**: a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The `volt-*` packages are the work that lives here; the rest is upstream opencode and is rarely touched. When in doubt, you are almost certainly working in a `volt-*` package.

`AGENTS.md` (style guide, commit conventions, testing rules) and `CONTEXT.md` (V2 session-runtime domain language) are authoritative and apply to upstream opencode code — read them before editing `packages/opencode` / `packages/core` / `packages/llm` etc. The conventions below extend them for Volt.

## Monorepo package map (opencode host)

How the host fits together: **one backend, two frontends.** `opencode` is the binary; it composes `core + server + llm + tui + sdk + plugin`. The **TUI** (terminal) and the **GUI** (`app`, wrapped by `desktop` or served as web) are two frontends over the same HTTP server. Volt work is almost always in `packages/volt-*` — this map is for understanding the host you integrate into.

**Backend / runtime** (the `opencode` binary composes these):
- `opencode` (`packages/opencode`) — **the `opencode` binary**: agent runtime + CLI, embeds the HTTP server, launches the TUI. The main entry.
- `@opencode-ai/core` — shared domain logic (the V2 session runtime; see `CONTEXT.md`).
- `@opencode-ai/server` — HTTP **API layer** (routes/handlers/auth/cors) that every frontend calls.
- `@opencode-ai/llm` — schema-first **LLM/provider** abstraction (one typed request/response/event/tool language).
- `@opencode-ai/plugin` — **plugin + custom-tool SDK**; what `.opencode/tool/*.ts` and TUI plugins (`.opencode/plugins/*.tsx`) import (`tool()`, `tui()`).
- `@opencode-ai/sdk` — typed **client SDK** the GUI uses to talk to the server.
- `@opencode-ai/schema` — shared schema/type definitions (agent, command, filesystem, …).
- `@opencode-ai/tui` — **terminal UI** renderer (opentui + solid). TUI plugins/slots (`home_logo`, …) live here.
- `@opencode-ai/http-recorder` · `@opencode-ai/script` — test HTTP record/replay; shared repo scripts.

**GUI frontend stack** (web + desktop share this):
- `@opencode-ai/app` — **the GUI** (Solid web/desktop UI); talks to the server via the SDK. `bun dev:web` serves it in a browser.
- `@opencode-ai/ui` — shared GUI components — **the logo (`logo.tsx`) lives here.**
- `@opencode-ai/session-ui` — session-view UI components used by `app`.
- `@opencode-ai/desktop` — **Electron shell**: loads `app` in a window + spawns the `opencode` server as a sidecar; owns app name/window/updater.
- `@opencode-ai/web` (docs/marketing site, Astro) · `@opencode-ai/storybook` (component preview).

**Cloud / infra — rarely relevant to Volt:** `console/*` (cloud console), `stats/*` (analytics), `@opencode-ai/{enterprise,function,slack}`, `@opencode-ai/cli` (separate `lildax` binary, *not* the opencode entry), `@opencode-ai/{effect-sqlite-node,effect-drizzle-sqlite}` (Effect SQLite adapters).

**Volt product (the fork — where ~all your work lives):** `volt-bridge` (`@opencode-ai/volt-bridges`), `volt-cli`, `volt-lsp-st` (`@opencode-ai/volt-lsp`), `volt-vscode` — detailed under "Volt architecture" below. Planned commercial layer: `volt-web` (Volt's own landing site — *scaffold*, see `packages/volt-web/README.md`).

**Volt-as-a-SaaS principle (white-label opencode):** *own what's purely Volt's, sync what is the product.* The public **landing page** is fully owned (`volt-web`, modeled on `console/app`'s homepage — never synced). The **agent GUI** (`packages/app`/`ui`/`desktop`) and the **backend** (`console-core` billing/auth/email) are **reused and kept in sync** with upstream — customized only via minimal branding seams (logo, app name) and Volt's own `infra/` SST config (your Stripe/SES/DB). Never fork `packages/app` — it's opencode's core product, improved daily.

**Branding/UI reach (recurring question):** TUI logo/panels are additive via `@opencode-ai/tui` plugin slots; the **GUI logo** (`packages/ui`), **GUI components** (`packages/app`), and **app name** (`packages/desktop`) have no plugin hook → deliberate (minimal) upstream seams.

## Tooling & common commands

Monorepo: **Bun** workspaces + **Turbo**. Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

```bash
bun install                 # install (postinstall patches node-pty)
bun typecheck               # turbo typecheck across all packages
bun lint                    # oxlint
bun run volt-scripts/check-divergence.ts          # enforce the fork surface (run after every upstream merge)
bun run volt-scripts/check-volt-integration.ts    # confirm the volt wiring still works
bun volt-scripts/dev.ts                           # opencode TUI from source with the volt LSP attached (.st)
bun volt-scripts/verify-lsp.ts                    # prove the volt LSP loads in opencode (non-interactive)
bun volt-scripts/verify-volt-tool.ts              # prove the volt CLI tool loads in opencode (non-interactive)
```

The `volt` CLI is exposed to opencode two ways: as a first-class **custom tool** (`.opencode/tool/volt.ts`, typed `command`+`args`, mutating verbs prompt for approval) and via gated **bash** (`volt …`, init/pull/push = `ask`). Verify the tool with `opencode debug agent volt` (look for `tools.volt: true`).

`bun run dev` does **not** load the volt LSP — it forces opencode's cwd to `packages/opencode`, so the repo-root-relative LSP path can't resolve. Use `bun volt-scripts/dev.ts` (passes the repo root as the project dir). See `packages/volt-lsp-st/ADDING-A-NEW-LSP.md` for the why + the launch matrix (CLI/TUI/desktop).

Each `volt-*` package has its own `README.md` with package-level detail — read it before deep work in that package.

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
- **Additive files:** `.opencode/opencode.json` (LSP registration + `volt` permission gates — opencode **deep-merges** this over upstream's pristine `opencode.jsonc`, so config is additive, not a seam), `.opencode/agent/volt.md`, `.opencode/themes/volt.json` (Volt brand theme), `.opencode/tool/volt.ts` (the `volt` CLI as a custom tool — opencode scans `.opencode/tool/` only), `packages/volt-*/turbo.json` (per-package test tasks via `extends: ["//"]`, so root `turbo.json` stays pristine), `volt-scripts/*`, `CLAUDE.md`, plus committed dev tooling `.claude/` (BMAD skills) and `_bmad/` (BMAD framework). (Language-reference skills are **generated** into a consumer's `.claude/skills/` by `volt init` — see `packages/volt-lsp-st/ADDING-A-NEW-LSP.md`.)
- **The only modified upstream files (4 seams):** `bun.lock` (volt deps; regenerated by `bun install`), `.opencode/tui.json` (one line: select the Volt brand theme), `.husky/pre-push` (typecheck scoped to volt-*), `.gitignore` (`/memory` junction). All near-static — the config/test seams were eliminated via the merge-layers above.

**Extension-point map — where each future addition goes (route everything here to stay conflict-free):**
| Addition | Additive home | |
|---|---|---|
| LSP / permission / mcp / model config | `.opencode/opencode.json` (the growing config layer — never edit `.jsonc`) | ✅ |
| Custom tool · agent · theme | `.opencode/tool/*.ts` · `.opencode/agent/*.md` · `.opencode/themes/*.json` | ✅ |
| **Graphical Volt panel in the TUI** | `.opencode/plugins/volt.tsx` (plugin API: routes/slots/keybinds; allowlist it in `check-divergence.ts`) | ✅ |
| **Desktop (Electron) panel · logo · app name** | none — `packages/desktop` / `packages/ui/.../logo.tsx` are **not** plugin-extensible | ⚠️ deliberate seam |

Build graphical features as a **TUI plugin** or in fork-owned `volt-vscode` to stay additive; an opencode **desktop** panel/logo is the only growth that requires a documented upstream seam.

`bun run volt-scripts/check-divergence.ts` enforces this — it fails if any upstream file outside those 4 seams is modified/deleted, **or if a new file is added outside `packages/volt-*`, `volt-scripts/`, `.claude/`, `_bmad/`, `CLAUDE.md`, or the `.opencode/{agent,themes,tool}/…` + `.opencode/opencode.json` additive allowlist.** It's the always-accurate map of where the fork's changes live; run it after every upstream merge. (It diffs committed `HEAD` vs `upstream/dev`, so commit your changes before relying on it.)

### Syncing upstream (runbook)
1. `git fetch upstream`
2. `git switch -c sync/upstream-dev-<date> <current integration tip>`
3. `git merge upstream/dev` — conflicts only ever appear in the 4 seams
4. `bun install` — resolves the `bun.lock` seam
5. `bun run volt-scripts/check-divergence.ts` — confirm the surface is unchanged
6. `bun run volt-scripts/check-volt-integration.ts` — confirm the wiring still works

Adding another LSP: `packages/volt-lsp-st/ADDING-A-NEW-LSP.md`. Bundle the fork as a version-pinned patch against an opencode release: `bun run volt-scripts/export-overlay.ts`.
