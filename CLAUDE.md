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

The commercial side is **one package, and it is not `volt-*`**:

- **`volt-www`** (`@volt/www`) — the public marketing site (static Vite/**React**), deployed at the apex. Volt's public face, and its storefront: the buy button links to Polar checkout.

**Volt operates no backend.** It sells a €19/month subscription for the toolchain through [Polar](https://polar.sh), which is the **merchant of record** — payment, EU VAT, licence-key issuance, revocation on cancellation and the customer portal are all theirs. There is no database, no auth system, no dashboard and no Stripe integration. The CLI holds a licence key, caches a verdict, and enforces a free allowance of 3 bound projects locally; the connector keeps that cache warm but is never required. See `openspec/changes/sell-cli-subscription`.

> **There used to be a `packages/console`** — a vendored fork of opencode's SolidStart console running an LLM gateway, with PlanetScale, Upstash, R2, Honeycomb, an OpenAuth issuer, Stripe products and a 30-chunk model catalog. It is deleted, and with it the "vendored-console rule" that governed editing it. Volt no longer tracks opencode's console at all, so nothing in the commercial side needs merging on an opencode bump. If you find a reference to `packages/console`, the gateway, `ZEN_MODELS`, or "the vendored console" — it's stale; fix it.

**`opencode-config/`** (repo root) — the whole agent-facing layer shipped to opencode as ONE dir via `OPENCODE_CONFIG_DIR`: `opencode.json` (LSP registration + the `volt` permission gates), `themes/volt.json` + `tui.json` (theme only), and `tool/volt.ts` (the `volt` CLI as a custom tool). **Every interaction here has to earn its place** — an unnecessary coupling to someone else's product is a liability, not a feature. Three were removed for failing that test: `plugins/volt-auth.ts`, which logged in to the Volt gateway (deleted with the gateway itself — users now bring their own provider key); a `volt` primary agent that sat beside Build/Plan (the PLC guidance belongs in the tool description + the `st-reference` skill, where every agent gets it), and a `plugins/volt.tsx` that drew a Volt logo on the TUI home screen — the only thing coupling Volt to `@opentui/*` and an undocumented `slots.register`, able to break a user's TUI on an opencode bump, in exchange for branding. It's dependency-free — the tool bundles only `zod`; nothing here needs `@opencode-ai/plugin`, so the shipped dir loads with no npm/registry at runtime. Dev runs `OPENCODE_CONFIG_DIR=$PWD/opencode-config opencode`.

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

The `volt` CLI is exposed to opencode two ways, and BOTH need gating — they are different permission keys. The **custom tool** (`opencode-config/tool/volt.ts`, typed `command`+`args`) asks under `permission.volt`; **bash** (`volt …`) asks under `permission.bash`. Declaring only the bash rules left the tool falling through to opencode's default `*: allow`, so `volt push` ran unattended in Build/Plan — the config now carries `"volt": "ask"` too. Verify with `opencode debug agent build`: `tools.volt: true` AND a resolved `{permission: volt, action: ask}`; `bun run compat` asserts both.

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
- **opencode is a prerequisite Volt never installs** — it neither bundles, updates, nor installs it. The CLI works without it (the agent lights up if/when opencode is present). Everywhere opencode is missing (the desktop's agent view, the VS Code extension's agent prompt) Volt merely **reports it and links to opencode.ai/download** — the user installs it themselves. (An opt-in winget task in the installer once offered to install it; it was removed so Volt owns **no** opencode install path — one less thing to maintain for a prerequisite Volt doesn't own. Don't re-add an in-app or installer-driven opencode install.)

## Conventions

- **Git (trunk-based, direct-push):** `dev` is the trunk and the only long-lived branch. Changes push **directly to `dev`** — **no PR required** (we move fast); only force-pushes and branch deletion are still rejected. CI runs on every push but is **advisory, not a merge gate** — you're trusted to keep it green, and a red push is a signal to fix forward, not a block. Short-lived feature branches + PRs remain available and are worth it for genuinely risky or large work, but they are optional, not the default. The **one version is git-derived and injected** — `volt-scripts/version.ts` takes the `X.Y.Z` base from `packages/volt-desktop/package.json` (the one number a human sets — git can't infer a patch-vs-feature bump) and the build number from the commit count, and `release.yml` **stamps that base into every `package.json`** at build (so you never hand-sync `volt-vscode`) and passes the full version via `VOLT_VERSION`. One version scheme, two channels by PROMOTION (no branches, no separate stable number): **every push to `dev` auto-publishes a `X.Y.Z.<count>` prerelease** (the dev channel — `VOLT_UPDATE_CHANNEL=dev` tracks it), already tagged. A **release promotes one of those builds to prod** — **`bun run release [version]`** (or Actions → the **`promote`** workflow → Run workflow) points a chosen dev build at the stable channel: `promote.yml` re-checks it's a green-CI published prerelease, runs the install/uninstall/lifecycle gates against **its own** installer, then flips its GitHub release `prerelease → latest`. The released version IS the detailed `X.Y.Z.<count>` build you promoted — monotonic (a former 3-part stable tag sorted BELOW every 4-part dev build, i.e. `0.0.1` = `0.0.1.0` < `0.0.1.842`, so a dev→stable switch read as a downgrade and never updated). `release.ts` only triggers the workflow (via `gh`); the gating + flip run in CI, nothing installs locally. The `.vsix` stays 3-part `<maj>.<min>.<count>` (`vsce` rejects a 4-part version); the installer + connector carry the full 4-part build. The other `volt-*` packages are private and unpublished, so their `version` is inert. CI is **`ci.yml`**: one job per concern (`typecheck` / `lint` / `test` / `integration` / `openspec`) run on every push — **advisory** now (branch protection no longer requires any status check; they inform, they don't block). A check run is named after the **job**, not the workflow, so N jobs report N checks; these were five near-identical workflows until that was measured. Only the **path-filtered** `deploy` stays separate (a job can't override `on: paths`), plus `release`. CI jobs no longer gate anything, so renaming one changes only what reports, not what blocks — but keep the names stable so history stays readable. Conventional commit messages: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful scopes: `bridge`, `cli`, `lsp`.
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
