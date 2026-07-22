# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Volt** — a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The repo is a standalone Bun monorepo of `volt-*` packages.

Volt is **opencode-independent**: [opencode](https://opencode.ai) (the open-source AI coding agent) is a **runtime dependency** — a user-provided install — not a fork. Volt makes the user's opencode PLC-aware by handing it one config dir via the `OPENCODE_CONFIG_DIR` env var (LSP + `volt` tool + agent + theme + permissions). We depend on opencode **one way**: the installed **binary** at runtime (it loads `opencode-config` and runs the `volt` tool + plugins). No `@opencode-ai/plugin` npm dependency — its `tool()` helper is just `(x) => x` + zod, so the tool exports the plain shape directly and the plugins use minimal local types. Nothing of opencode's source lives here.

> History: this repo began as a fork of opencode's monorepo. The `extract-clean-repo` / `minimize-opencode-fork` changes (see `openspec/`) removed all opencode source and re-rooted it as the standalone Volt repo. If you find a stray reference to `packages/opencode`, `packages/app`, `check-divergence`, or "the fork" — it's stale; fix it.

## Package map

Bun workspaces (no Turbo — task-running is bun-native `--filter`). All product code is in `packages/volt-*`:

- **`volt-cli`** (`@volt/cli`) — the single C# toolchain: the **`volt` CLI** (git-native PLC sync — `init/pull/push/status/build/show/merge`) **and** the in-IDE bridges (CODESYS / TwinCAT) **and** the tray connector, all over Windows **named pipes**. Shared `Volt.Engine`. (This absorbed the former `volt-bridge` + `volt-git`; the HTTP wire is gone.)
- **`volt-lsp-iec`** (`@volt/lsp-iec`) — TypeScript-native LSP for Structured Text.
- **`volt-control`** (`@volt/control`) — UI-agnostic core (status/pull/push/health/diagnostics) that powers both frontends.
- **`volt-desktop`** (`@volt/desktop`) — Electron shell: spawns the installed `opencode serve`, loads its GUI in a `WebContentsView`, adds Volt chrome + the IDE panel over `volt-control`.
- **`volt-vscode`** — VS Code extension (Marketplace-distributed): PLC language intelligence + drift coloring + the `volt-control` views.

The commercial side is **two packages, and they are not `volt-*`**:

- **`volt-www`** (`@volt/www`) — the public marketing site (static Vite/**React**), deployed at `www.${domain}`. Volt's public face.
- **`packages/console`** — the account console + **LLM gateway**: **vendored opencode source** (SolidStart/**SolidJS**), pinned at a release tag, deployed at the apex. Login, workspaces, Stripe billing, API keys, and the metered `/v1` gateway the agent routes through.

> **The vendored-console rule (read before touching `packages/console/*`):** **never edit opencode's source to customize it.** Every customization takes one of three shapes — a **Volt file beside** theirs (`i18n/volt.ts` overlays the strings; `routes/workspace/[id]/gateway/` is Volt's view), a **deletion** (the public-surface strip — Volt's proxy/redirect routes), or an **import** of their exported server code (Volt owns the presentation; opencode keeps the queries/actions, so they stay in sync). Editing the vendored dict to rebrand cost 26 conflicts on the very next bump — that is why the overlay exists. Two kinds of source edit are allowed, both narrow and both `VOLT:`-marked: (1) **framework entry points** that cannot be shadowed by a beside-file (`app.tsx`, `entry-server.tsx`, `ui.tsx`, `vite.config.ts`, `middleware.ts`, `routes/auth/logout.ts`); and (2) **minimal value-edits** where the fix is one string/URL/number inside vendored code and a beside-file can't reach it — kept *additive* (append, don't rewrite) or *localized* (one variable, line-level swaps) so upstream still merges (e.g. the Honeycomb allowlist gains Volt's `/v1/*` paths; `billing.ts` stops default-applying opencode's discount). Both kinds are a hand-merge on every bump, so keep them minimal. (This *was* CI-enforced by a `check-console-divergence` gate + a `DIVERGENCE.md` ledger; those were removed once the console stopped tracking upstream opencode — the rule is now a **convention** for clean merges, not a gate. If you ever resume bumping opencode, reinstate a divergence check.)
>
> Two traps that cost real money to learn: **"unlinked" is not "unexposed"** — SolidStart serves every file under `routes/**` by URL, so dormancy must be *proven*, not assumed (`/go` was the referral landing page, `/download` proxied opencode's binaries, `bench/submission.ts` was an unauthenticated public write). And **the console does not build on Windows** (a `vite:define` path bug), so a console change is compiled only at **deploy** time (`deploy.yml` runs `sst deploy`, which builds on Linux) — a build break (e.g. a deleted component a compiled-but-unlinked page still imports; typecheck won't catch it) surfaces there, post-merge, not in a PR gate. The two sites share **no components** (React vs SolidJS); only the design tokens port, via `style/volt-theme.css`.

**`opencode-config/`** (repo root) — the whole agent-facing layer shipped to opencode as ONE dir via `OPENCODE_CONFIG_DIR`: `opencode.json` (LSP registration + `volt` permission gates), `agent/volt.md`, `themes/volt.json`, `tool/volt.ts` (the `volt` CLI as a custom tool), `plugins/volt.tsx`. It's dependency-free — the tool bundles only `zod`; nothing here needs `@opencode-ai/plugin`, so the shipped dir loads with no npm/registry at runtime. Dev runs `OPENCODE_CONFIG_DIR=$PWD/opencode-config opencode`.

Each `volt-*` package has its own `README.md` — read it before deep work there.

## Tooling & common commands

Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

Standard workflows are root `bun run` scripts — prefer these over invoking `volt-scripts/*.ts` by path:

```bash
bun install                 # install workspace deps
bun run dev                 # the Volt-aware agent (OPENCODE_CONFIG_DIR=$PWD/opencode-config opencode)
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

The `volt` CLI is exposed to opencode two ways: as a first-class **custom tool** (`opencode-config/tool/volt.ts`, typed `command`+`args`, mutating verbs prompt for approval) and via gated **bash** (`volt …`, init/pull/push = `ask`). Verify with `opencode debug agent volt` (look for `tools.volt: true`).

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
dotnet test test/Volt.Engine.Tests/                      # shared engine (parsing/PLCopen/VG + push/fetch)
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
  - **the bridges** — one live IDE exposed over the pipe. **`Volt.Engine` holds everything shareable; only irreducible vendor glue lives in an IDE host (`Volt.Cli.Ide.Codesys` / `Volt.Cli.Ide.Twincat`, each = driver + pipe host).** The parity boundary is the pipe wire (not the driver), so both vendors serve byte-identical responses for the same project. See `packages/volt-cli/ARCHITECTURE.md` — read it before touching bridge code; it documents the Core layer stack (`Ide` contract → `Wire` → `Sync` → `Workspace`/`Graphical`) and the **load-bearing CODESYS↔Beckhoff asymmetries that must not be "unified"**.
  - **the `volt` CLI** — `init`, `pull`, `push`, `status`, `build`, `show`, `merge`. **Git-native, single-repo:** `init` makes the project root a git repo; the live IDE is modeled as a git **remote-tracking branch** (`refs/remotes/volt/ide`, shown in the graph as `volt/ide` — the IDE *is* a remote you fetch+merge on pull / push to on push), so `pull`/`push` reconcile through native `git merge` — no custom 3-way merge engine and no separate `.volt/` snapshot. Talks to the pipe host (one declarative `set`/`delete` push wire); the workspace binding stores the **vendor** (`codesys`/`twincat`), which names the pipe (`volt.bridge.codesys` / `volt.bridge.twincat`). `volt init --vendor <codesys|twincat>` binds; `VOLT_PIPE` names the pipe directly (dev/tests).
  - **the connector** — the tray supervisor that spawns the TwinCAT worker + launches CODESYS's in-proc host, and probes `health` over the pipe.
- **`packages/volt-lsp-iec`** (`@volt/lsp-iec`) — TypeScript-native LSP for Structured Text (nav, diagnostics, completion, hover, signature help, semantic tokens), driven by an embedded CODESYS language reference. Editable FBD/LD bodies are materialized as a textual **VG** form the LSP analyzes as its own first-class sublanguage (CFC/SFC are read-only) — see the VG language note below. Type-checking/codegen stay the IDE's job.
- **`packages/volt-vscode`** — VS Code extension: syntax + language intelligence for PLC languages, plus drift coloring (files the IDE changed vs. git changes).

### Protocol invariant: the item **name** is the identity

The whole wire is keyed by bare item name — `refs`, `fetch` `knownItems`, every push op, `structureVersion` (hash of sorted names), and the one-item-per-file layout. This is deliberate and load-bearing across `volt-cli` and `volt-vscode`. Same-name items collapse last-write-wins; this is fine for source items (IEC guarantees unique names) and only affects opaque non-source items the AI never edits. **Do not add a "duplicate name" guard that throws** — real projects legitimately repeat opaque names, and throwing breaks `/refs`.

### VG (graphical) language

Editable graphical bodies (FBD/LD) round-trip PlcOpen XML ⇄ a textual **VG** form; CFC/SFC are read-only. The VG language is specified in `packages/volt-cli/docs/vg-language.md` and `vg-diagnostics.md`. VG wires use inline `LET`. `packages/volt-cli/docs/ITEM_KINDS.md` documents the vendor-neutral item-type table (`Volt.Engine/Workspace/ItemKind` is the source of truth).

## opencode integration — one env var, additive, safe

- The **installer** sets two persistent user env vars: `OPENCODE_CONFIG_DIR` = the shipped `opencode-config`, and `PATH += <bin>` (so the config's bare-name `volt-lsp-iec` / `volt` commands resolve). This is the single mechanism — nothing per-spawn.
- **Additive & safe:** opencode always merges the user's own global config, and `OPENCODE_CONFIG_DIR` is just an *extra* merged directory. Auth lives in opencode's data dir (untouched). So the user's settings + provider keys are preserved; Volt's config merges on top. Uninstall removes the env vars → opencode reverts to vanilla.
- **opencode is a prerequisite** — Volt never bundles, updates, or uninstalls it. The CLI works without it (the agent lights up if/when opencode is present). There is exactly ONE place Volt will install it: an **opt-in wizard task in the installer** (`winget install --id SST.opencode`, `installer/Volt.iss`) — user-checked, the official package, triggered via the OS package manager. Everywhere else (the desktop's agent view, the VS Code extension's agent prompt) merely **reports that opencode is missing and links to opencode.ai/download** — they never install. Don't re-add an in-app installer: it's a second install path to maintain for a prerequisite Volt doesn't own.

## Conventions

- **Git (trunk-based, direct-push):** `dev` is the trunk and the only long-lived branch. Changes push **directly to `dev`** — **no PR required** (we move fast); only force-pushes and branch deletion are still rejected. CI runs on every push but is **advisory, not a merge gate** — you're trusted to keep it green, and a red push is a signal to fix forward, not a block. Short-lived feature branches + PRs remain available and are worth it for genuinely risky or large work, but they are optional, not the default. The **one version is git-derived and injected** — `volt-scripts/version.ts` takes the `X.Y.Z` base from `packages/volt-desktop/package.json` (the one number a human sets — git can't infer a patch-vs-feature bump) and the build number from the commit count, and `release.yml` **stamps that base into every `package.json`** at build (so you never hand-sync `volt-vscode`) and passes the full version via `VOLT_VERSION`. Two channels, one pipeline: **every push to `dev` auto-publishes a `X.Y.Z.<count>` prerelease** (the dev channel — `VOLT_UPDATE_CHANNEL=dev` on the connector tracks it), and **`bun run release`** tags the base `X.Y.Z` on `dev` (bare, no `v` — the updater compares the tag to the installed version) to cut the **stable** release. The `.vsix` stays 3-part (`vsce` rejects a 4-part version); the installer + connector carry the 4-part build. The other `volt-*` packages are private and unpublished, so their `version` is inert; **`packages/console/*` is deliberately NOT Volt's version** — it's the vendored opencode version (bump it only when tracking a new opencode). CI is **`ci.yml`**: one job per concern (`typecheck` / `lint` / `test` / `integration` / `openspec`) run on every push — **advisory** now (branch protection no longer requires any status check; they inform, they don't block). A check run is named after the **job**, not the workflow, so N jobs report N checks; these were five near-identical workflows until that was measured. Only the **path-filtered** `deploy` stays separate (a job can't override `on: paths`), plus `release`. CI jobs no longer gate anything, so renaming one changes only what reports, not what blocks — but keep the names stable so history stays readable. Conventional commit messages: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful scopes: `bridge`, `cli`, `lsp`.
- **Platform:** primary dev is Windows + PowerShell (the bridges and CODESYS tooling are Windows-only). Bun's Bash tool is also available for POSIX scripts. Bridge build/dev-loop scripts live in `packages/volt-cli/scripts/*.ps1`; repo-wide tooling (compat gate, dist, installer helpers) in `volt-scripts/`.
- **`.volt/`** is a CLI-managed PLC workspace binding (`.git/volt`); **`opencode-config/`** is the agent-config layer handed to opencode. Don't confuse them.
- **Source of truth for invariants is the code + each package's `README.md`/`ARCHITECTURE.md`** (e.g. `volt-cli/ARCHITECTURE.md`, `volt-lsp-iec/docs/`), not a parallel spec tree. **OpenSpec is `openspec/changes/` only** — in-flight proposals + the decision log (`openspec list`); the archived `specs/` capability tree was removed (it drifted) and its load-bearing invariants folded into the package docs.

## Tracking opencode (the compat gate)

Volt tracks opencode by **a compat test**, not by merging its source (and no longer by an npm dep — the `volt` tool/plugins carry no `@opencode-ai/plugin`; compatibility is purely against the installed **binary**'s config/tool/plugin contract). On an opencode binary bump, run:

```
bun run compat     # install → integration → lsp loads → tool loads (stops at first ✗)
```

It confirms the current opencode still loads Volt's config: deps resolve, the wiring is intact (`check-wiring`), and the LSP + `volt` tool actually load in the **installed** `opencode` (`verify-opencode` drives the real binary via `OPENCODE_CONFIG_DIR`). Exit 0 = Volt is compatible with this opencode. CI runs the key-free subset (typecheck + lint + integration) on every push/PR; `verify-opencode` needs an installed opencode + a configured provider, so it runs locally / on bumps. Full script map: `volt-scripts/README.md`.

Adding another vendor LSP: `packages/volt-lsp-iec/README.md` → "Adding another vendor LSP".
