# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Volt** — a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The repo is a standalone Bun monorepo of `volt-*` packages.

Volt is **opencode-independent**: [opencode](https://opencode.ai) (the open-source AI coding agent) is a **runtime dependency** — a user-provided install — not a fork. Volt makes the user's opencode PLC-aware by handing it one config dir via the `OPENCODE_CONFIG_DIR` env var (LSP + `volt` tool + agent + theme + permissions). We depend on opencode **one way**: the installed **binary** at runtime (it loads `volt-config` and runs the `volt` tool + plugins). No `@opencode-ai/plugin` npm dependency — its `tool()` helper is just `(x) => x` + zod, so the tool exports the plain shape directly and the plugins use minimal local types. Nothing of opencode's source lives here.

> History: this repo began as a fork of opencode's monorepo. The `extract-clean-repo` / `minimize-opencode-fork` changes (see `openspec/`) removed all opencode source and re-rooted it as the standalone Volt repo. If you find a stray reference to `packages/opencode`, `packages/app`, `check-divergence`, or "the fork" — it's stale; fix it.

## Package map

Bun workspaces (no Turbo — task-running is bun-native `--filter`). All product code is in `packages/volt-*`:

- **`volt-cli`** (`@volt/cli`) — the single C# toolchain: the **`volt` CLI** (git-native PLC sync — `init/pull/push/status/build/show/merge`) **and** the in-IDE bridges (CODESYS / TwinCAT) **and** the tray connector, all over Windows **named pipes**. Shared `Volt.Cli.Core`. (This absorbed the former `volt-bridge` + `volt-git`; the HTTP wire is gone.)
- **`volt-lsp-iec`** (`@volt/lsp-iec`) — TypeScript-native LSP for Structured Text.
- **`volt-control`** (`@volt/control`) — UI-agnostic core (status/pull/push/health/diagnostics) that powers both frontends.
- **`volt-desktop`** (`@volt/desktop`) — Electron shell: spawns the installed `opencode serve`, loads its GUI in a `WebContentsView`, adds Volt chrome + the IDE panel over `volt-control`.
- **`volt-vscode`** — VS Code extension (Marketplace-distributed): PLC language intelligence + drift coloring + the `volt-control` views.

The commercial side is **two packages, and they are not `volt-*`**:

- **`volt-www`** (`@volt/www`) — the public marketing site (static Vite/**React**), deployed at `www.${domain}`. Volt's public face.
- **`packages/console`** — the account console + **LLM gateway**: **vendored opencode source** (SolidStart/**SolidJS**), pinned at a release tag, deployed at the apex. Login, workspaces, Stripe billing, API keys, and the metered `/v1` gateway the agent routes through.

> **The vendored-console rule (read before touching `packages/console/*`):** **never edit opencode's source to customize it.** Every customization takes one of three shapes — a **Volt file beside** theirs (`i18n/volt.ts` overlays the strings; `routes/workspace/[id]/gateway/` is Volt's view), a **deletion declared in `DROPPED`**, or an **import** of their exported server code (Volt owns the presentation; opencode keeps the queries/actions, so they stay in sync). Editing the vendored dict to rebrand cost 26 conflicts on the very next bump — that is why the overlay exists. Two kinds of source edit are allowed, both narrow and both `VOLT:`-marked: (1) **framework entry points** that cannot be shadowed by a beside-file (`app.tsx`, `entry-server.tsx`, `ui.tsx`, `vite.config.ts`, `middleware.ts`, `routes/auth/logout.ts`); and (2) **minimal value-edits** where the fix is one string/URL/number inside vendored code and a beside-file can't reach it — kept *additive* (append, don't rewrite) or *localized* (one variable, line-level swaps) so upstream still merges (e.g. the Honeycomb allowlist gains Volt's `/v1/*` paths; `billing.ts` stops default-applying opencode's discount). Both kinds are a hand-merge on every bump, so each edit needs a justification in `volt-scripts/check-console-divergence.ts`'s `ALLOW` **and** `DIVERGENCE.md`. `bun volt-scripts/check-console-divergence.ts` enforces that every divergent file is one of them.
>
> Two traps that cost real money to learn: **"unlinked" is not "unexposed"** — SolidStart serves every file under `routes/**` by URL, so dormancy must be *proven*, not assumed (`/go` was the referral landing page, `/download` proxied opencode's binaries, `bench/submission.ts` was an unauthenticated public write). And **the console does not build on Windows** (a `vite:define` path bug), so `console-build` on Linux CI is the only place a console change is compiled before it reaches `dev` — typecheck will not catch a deleted component that a compiled-but-unlinked page still imports. The two sites share **no components** (React vs SolidJS); only the design tokens port, via `style/volt-theme.css`.

**`volt-config/`** (repo root) — the whole agent-facing layer shipped to opencode as ONE dir via `OPENCODE_CONFIG_DIR`: `opencode.json` (LSP registration + `volt` permission gates), `agent/volt.md`, `themes/volt.json`, `tool/volt.ts` (the `volt` CLI as a custom tool), `plugins/volt.tsx`. It's dependency-free — the tool bundles only `zod`; nothing here needs `@opencode-ai/plugin`, so the shipped dir loads with no npm/registry at runtime. Dev runs `OPENCODE_CONFIG_DIR=$PWD/volt-config opencode`.

Each `volt-*` package has its own `README.md` — read it before deep work there.

## Tooling & common commands

Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

Standard workflows are root `bun run` scripts — prefer these over invoking `volt-scripts/*.ts` by path:

```bash
bun install                 # install workspace deps
bun run dev                 # the Volt-aware agent (OPENCODE_CONFIG_DIR=$PWD/volt-config opencode)
bun run build               # build the TS packages (bun --filter; the C# bridge builds in `dist`)
bun run build:installer     # the product → dist/release/Volt-win-Setup.exe (payload + electron + Inno)
bun run test:install        # install → verify → uninstall → verify-clean smoke gate (Windows)
bun run compat              # opencode compat gate: integration → lsp-loads → tool-loads (run on an opencode bump)
bun run typecheck           # tsgo --noEmit across all volt packages
bun run lint                # oxlint
```

All of these live in `volt-scripts/` (product-level orchestration across all packages) — **`volt-scripts/README.md`
maps every script**; keep it accurate. `compat`'s sub-steps are runnable alone when one fails
(`bun volt-scripts/{check-wiring,verify-opencode}.ts`). `build:installer` internally runs
`build-payload.ts` (the `dist/volt/` payload); that stage has no `bun run` on purpose — it's a step, not a
destination.

The `volt` CLI is exposed to opencode two ways: as a first-class **custom tool** (`volt-config/tool/volt.ts`, typed `command`+`args`, mutating verbs prompt for approval) and via gated **bash** (`volt …`, init/pull/push = `ask`). Verify with `opencode debug agent volt` (look for `tools.volt: true`).

Per-package work for the TS packages (run from the package dir, e.g. `packages/volt-lsp-iec`):

```bash
bun typecheck               # tsc/tsgo --noEmit — ALWAYS use this, never raw `tsc`
bun test                    # bun test runner
bun test path/to/file.test.ts          # single test file
bun test -t "name of the test"         # single test by name
bun run build               # tsc -> dist/ (volt-lsp-iec is compiled before publish)
```

Tests cannot run from the repo root (guard `do-not-run-tests-from-root`) — always `cd` into the package.

### The C# toolchain (`packages/volt-cli`)

`volt-cli` is one .NET solution — the CLI, the two in-IDE bridges, the connector, and the shared Core. Build/test
with `dotnet`; the TS e2e parity suite runs with `bun`:

```bash
# from packages/volt-cli
dotnet build Volt.Cli.sln -c Release                       # the whole toolchain (all TFMs)
dotnet test test/Volt.Cli.Tests/                           # pipe transport + ported sync + black-box CLI
dotnet test test/Volt.Cli.Core.Tests/                      # shared Core (parsing/PLCopen/VG + push/fetch)
bun test test/e2e                                          # TS e2e parity suite (drives a live bridge over the pipe)
pwsh scripts/build-cli.ps1                                 # publish volt.exe + pipe workers + the connector bundle
```

Headless CODESYS dev/test loop (Windows/PowerShell): `pwsh packages/volt-cli/scripts/codesys-pipe.ps1 up|down|logs`
loads the in-proc pipe host into a headless CODESYS against its **own copy** of a fixture project (never the
engineer's live IDE); then run `bun test test/e2e` with `VOLT_PIPE=volt.bridge.codesys`.

## Volt architecture (big picture)

Volt mirrors a git-like workflow for PLC code. The data path is:

```
live PLC IDE  ──named pipe──  volt-cli (C#)  ──>  git repo of text files
 CODESYS / TwinCAT   in-IDE bridge + CLI       analyzed by volt-lsp-iec
                     init/pull/push/build       edited in volt-vscode
```

- **`packages/volt-cli`** (`@volt/cli`) — the whole toolchain in one C# solution over Windows **named pipes** (no HTTP):
  - **the bridges** — one live IDE exposed over the pipe. **`Volt.Cli.Core` holds everything shareable; only irreducible vendor glue lives in an IDE host (`Volt.Cli.Ide.Codesys` / `Volt.Cli.Ide.Twincat`, each = driver + pipe host).** The parity boundary is the pipe wire (not the driver), so both vendors serve byte-identical responses for the same project. See `packages/volt-cli/ARCHITECTURE.md` — read it before touching bridge code; it documents the Core layer stack (`Ide` contract → `Wire` → `Sync` → `Workspace`/`Graphical`) and the **load-bearing CODESYS↔Beckhoff asymmetries that must not be "unified"**.
  - **the `volt` CLI** — `init`, `pull`, `push`, `status`, `build`, `show`, `merge`. **Git-native, single-repo:** `init` makes the project root a git repo; the live IDE is modeled as a git **remote-tracking branch** (`refs/remotes/volt/ide`, shown in the graph as `volt/ide` — the IDE *is* a remote you fetch+merge on pull / push to on push), so `pull`/`push` reconcile through native `git merge` — no custom 3-way merge engine and no separate `.volt/` snapshot. Talks to the pipe host (one declarative `set`/`delete` push wire); resolves the vendor pipe from the workspace binding (CODESYS `volt.bridge.codesys`, Beckhoff `volt.bridge.beckhoff`; the legacy `8556`/`8555` ports still select the vendor via `--port` / `VOLT_BRIDGE_PORT`, or `VOLT_PIPE` names the pipe directly).
  - **the connector** — the tray supervisor that spawns the TwinCAT worker + launches CODESYS's in-proc host, and probes `health` over the pipe.
- **`packages/volt-lsp-iec`** (`@volt/lsp-iec`) — TypeScript-native LSP for Structured Text (nav, diagnostics, completion, hover, signature help, semantic tokens), driven by an embedded CODESYS language reference. Editable FBD/LD bodies are materialized as a textual **VG** form the LSP analyzes as its own first-class sublanguage (CFC/SFC are read-only) — see the VG language note below. Type-checking/codegen stay the IDE's job.
- **`packages/volt-vscode`** — VS Code extension: syntax + language intelligence for PLC languages, plus drift coloring (files the IDE changed vs. git changes).

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `refs`, `fetch` `knownItems`, every push op, `structureVersion` (hash of sorted names), and the one-item-per-file layout. This is deliberate and load-bearing across `volt-cli` and `volt-vscode`. Same-name items collapse last-write-wins; this is fine for source items (IEC guarantees unique names) and only affects opaque non-source items the AI never edits. **Do not add a "duplicate name" guard that throws** — real projects legitimately repeat opaque names, and throwing breaks `/refs`.

### VG (graphical) language

Editable graphical bodies (FBD/LD) round-trip PlcOpen XML ⇄ a textual **VG** form; CFC/SFC are read-only. The VG language is specified in `packages/volt-cli/docs/vg-language.md` and `vg-diagnostics.md`. VG wires use inline `LET`. `packages/volt-cli/docs/ITEM_KINDS.md` / `item-kinds.json` define the vendor-neutral item-type table.

## opencode integration — one env var, additive, safe

- The **installer** sets two persistent user env vars: `OPENCODE_CONFIG_DIR` = the shipped `volt-config`, and `PATH += <bin>` (so the config's bare-name `volt-lsp-iec` / `volt` commands resolve). This is the single mechanism — nothing per-spawn.
- **Additive & safe:** opencode always merges the user's own global config, and `OPENCODE_CONFIG_DIR` is just an *extra* merged directory. Auth lives in opencode's data dir (untouched). So the user's settings + provider keys are preserved; Volt's config merges on top. Uninstall removes the env vars → opencode reverts to vanilla.
- **opencode is a prerequisite** — Volt never bundles, updates, or uninstalls it. The CLI works without it (the agent lights up if/when opencode is present). There is exactly ONE place Volt will install it: an **opt-in wizard task in the installer** (`winget install --id SST.opencode`, `installer/Volt.iss`) — user-checked, the official package, triggered via the OS package manager. Everywhere else (the desktop's agent view, the VS Code extension's agent prompt) merely **reports that opencode is missing and links to opencode.ai/download** — they never install. Don't re-add an in-app installer: it's a second install path to maintain for a prerequisite Volt doesn't own.

## Conventions

- **Git (trunk-based, mirrors opencode):** `dev` is the protected trunk and the only long-lived branch. Every change lands via a **short-lived feature branch → PR into `dev`**; direct pushes and force-pushes to `dev` are rejected, and CI must be green to merge. Delete the branch after merge; cut releases by tagging `dev` with the **bare** version `X.Y.Z` (matching `packages/volt-desktop/package.json`; no `v` prefix — the connector's auto-updater compares the tag to the installed version), which triggers `release.yml` to build + publish the single Inno Setup installer. **Volt ships ONE version:** `packages/volt-desktop/package.json` is the source of truth, and `packages/volt-vscode/package.json` must carry the same number (the installer sideloads that `.vsix`; the extension also self-publishes to the Marketplace, which is why they're separate files). Bump both together — `bun run release` and `release.yml` both refuse a mismatch. The other `volt-*` packages are private and unpublished, so their `version` is inert; **`packages/console/*` is deliberately NOT Volt's version** — it's the vendored opencode version (bump it only when tracking a new opencode). CI is **`ci.yml` = the PR gate**: one job per concern (`typecheck` / `lint` / `test` / `integration` / `openspec`) — exactly the checks `dev` branch protection requires, and nothing else. A check run is named after the **job**, not the workflow, so N jobs report N checks; these were five near-identical workflows until that was measured. Only the **path-filtered** ones stay separate (`console-build`, `console-symmetry`, `deploy` — a job can't override `on: paths`), plus tag-triggered `release`. **The job IDs in `ci.yml` are the required contexts** — renaming one silently blocks every PR on a check that never reports, until branch protection is updated. Conventional commit messages/PR titles: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful scopes: `bridge`, `cli`, `lsp`.
- **Platform:** primary dev is Windows + PowerShell (the bridges and CODESYS tooling are Windows-only). Bun's Bash tool is also available for POSIX scripts. Bridge build/dev-loop scripts live in `packages/volt-cli/scripts/*.ps1`; repo-wide tooling (compat gate, dist, installer helpers) in `volt-scripts/`.
- **`.volt/`** is a CLI-managed PLC workspace binding (`.git/volt`); **`volt-config/`** is the agent-config layer handed to opencode. Don't confuse them.
- **Source of truth for invariants is the code + each package's `README.md`/`ARCHITECTURE.md`** (e.g. `volt-cli/ARCHITECTURE.md`, `volt-lsp-iec/docs/`), not a parallel spec tree. **OpenSpec is `openspec/changes/` only** — in-flight proposals + the decision log (`openspec list`); the archived `specs/` capability tree was removed (it drifted) and its load-bearing invariants folded into the package docs.

## Tracking opencode (the compat gate)

Volt tracks opencode by **a compat test**, not by merging its source (and no longer by an npm dep — the `volt` tool/plugins carry no `@opencode-ai/plugin`; compatibility is purely against the installed **binary**'s config/tool/plugin contract). On an opencode binary bump, run:

```
bun run compat     # install → integration → lsp loads → tool loads (stops at first ✗)
```

It confirms the current opencode still loads Volt's config: deps resolve, the wiring is intact (`check-wiring`), and the LSP + `volt` tool actually load in the **installed** `opencode` (`verify-opencode` drives the real binary via `OPENCODE_CONFIG_DIR`). Exit 0 = Volt is compatible with this opencode. CI runs the key-free subset (typecheck + lint + integration) on every push/PR; `verify-opencode` needs an installed opencode + a configured provider, so it runs locally / on bumps. Full script map: `volt-scripts/README.md`.

Adding another vendor LSP: `packages/volt-lsp-iec/README.md` → "Adding another vendor LSP".
