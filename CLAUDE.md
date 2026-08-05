# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Volt** — a toolchain for managing IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text. The repo is a standalone Bun monorepo of `volt-*` packages.

**Volt depends on no AI agent, and installs itself into none.** It ships no agent, launches none, and writes into no other vendor's configuration. Agents reach Volt through the **`volt` CLI on PATH** — that is the whole integration for Claude Code, Cursor, Windsurf and anything else with a terminal. Hosts that can also run a language server register it through their OWN mechanism (the `volt-vscode` extension for the VS Code family; a plugin for Claude Code), and Claude Desktop — no terminal, no editor — connects over MCP. The installer publishes `PATH` and nothing else. See `packages/volt-web/app/docs/agents.mdx` for the per-host guide.

> History, twice over. This repo began as a fork of opencode's monorepo; the `extract-clean-repo` / `minimize-opencode-fork` changes removed all opencode source. What survived was an `opencode-config/` directory Volt shipped into opencode's environment via `OPENCODE_CONFIG_DIR` — LSP registration, a `volt` custom tool, a theme, permission gates — plus a compat gate (`bun run compat`, `verify-opencode.ts`) that existed solely to catch opencode changing that contract. **All of it is deleted.** It was one product's config format, installed into that product's environment, for a dependency Volt did not own. If you find a reference to `opencode-config`, `OPENCODE_CONFIG_DIR`, `verify-opencode`, `bun run compat`, `packages/opencode`, `packages/app`, `check-divergence`, or "the fork" — it's stale; fix it.

## Package map

Bun workspaces (no Turbo — task-running is bun-native `--filter`). All product code is in `packages/volt-*`:

- **`volt-cli`** (`@volt/cli`) — the single C# toolchain: the **`volt` CLI** (git-native PLC sync — `init/pull/push/status/build/show/merge`) **and** the in-IDE bridges (CODESYS / TwinCAT) **and** the tray connector, all over Windows **named pipes**. Shared `Volt.Engine`. (This absorbed the former `volt-bridge` + `volt-git`; the HTTP wire is gone.)
- **`volt-lsp-iec`** (`@volt/lsp-iec`) — TypeScript-native LSP for Structured Text.
- **`volt-control`** (`@volt/control`) — UI-agnostic core (status/pull/push/health/diagnostics) that powers both frontends.
- **`volt-desktop`** (`@volt/desktop`) — the standalone desktop app: an Electron window whose whole content is the IDE panel over `volt-control` (connection / sync / diagnostics). It embeds no editor and no agent, opens from its own exe or the connector's tray, and remembers the last workspace it was bound to (`recent.ts` — without that memory a returning user is offered a brand-new workspace every launch).
- **`volt-vscode`** — editor extension for the VS Code family (VS Code / Cursor / Windsurf): PLC language intelligence + drift coloring + the `volt-control` views.

**The two frontends surface the same three things** — IDE Connection, IDE Sync, Diagnostics — deliberately. The extension had a fourth "Agent & Settings" view holding an opencode launcher and two shortcuts into VS Code's own settings; it was deleted. Don't re-add a view whose content is a link.

The commercial side is **one package, and it is not `volt-*`**:

- **`volt-web`** (`@volt/web`) — the public website, deployed at the apex. Volt's public face, and its storefront: the buy button links to Polar checkout. **React Router in framework mode with `ssr: false`** — every route is prerendered to HTML at build (`react-router.config.js`), so it deploys as a `StaticSite` with no Worker and no origin, consistent with Volt running no backend. The `prerender` list IS the sitemap: a route missing from it has no HTML for a crawler or a cold load. Copy lives in `app/content.js`, never in JSX. `app/config.js` exports **`COMING_SOON`** — while true, the download and buy CTAs render a disabled "Coming soon" control instead of a dead link. The three `legal.*` routes are **known-stale** (they still describe a hosted gateway, accounts and Stripe) and must be rewritten before Volt takes money.

**Volt operates no backend.** It sells a €19/month subscription for the toolchain through [Polar](https://polar.sh), which is the **merchant of record** — payment, EU VAT, licence-key issuance, revocation on cancellation and the customer portal are all theirs. There is no database, no auth system, no dashboard and no Stripe integration. The CLI holds a licence key, caches a verdict, and enforces a free allowance of 3 bound projects locally; the connector keeps that cache warm but is never required. See `openspec/changes/sell-cli-subscription`.

> **There used to be a `packages/console`** — a vendored fork of opencode's SolidStart console running an LLM gateway, with PlanetScale, Upstash, R2, Honeycomb, an OpenAuth issuer, Stripe products and a 30-chunk model catalog. It is deleted, and with it the "vendored-console rule" that governed editing it. If you find a reference to `packages/console`, the gateway, `ZEN_MODELS`, or "the vendored console" — it's stale; fix it.

**There is no agent-config directory at the repo root**, and adding one back is the mistake to avoid. `opencode-config/` used to live here — LSP registration, a `volt` custom tool, a theme, permission gates — shipped into the user's opencode via `OPENCODE_CONFIG_DIR`. **Every interaction with someone else's product has to earn its place**; that whole directory failed the test, exactly as three of its own contents had before it (a gateway-auth plugin, a `volt` primary agent, and a TUI logo plugin that coupled Volt to `@opentui/*` for branding). The replacement is not a different config directory — it is *no* config directory: hosts register Volt themselves, and the installer publishes `PATH`. When a new host appears, the answer is a published artifact (an extension in a registry, a plugin in a marketplace) or a documented snippet the user pastes — never a file Volt writes into their config.

Each `volt-*` package has its own `README.md` — read it before deep work there.

## Tooling & common commands

Package manager is `bun@1.3.14`. Lint is **oxlint**; format is Prettier (`semi: false`, `printWidth: 120`).

Standard workflows are root `bun run` scripts — prefer these over invoking `scripts/*.ts` by path:

```bash
bun install                 # install workspace deps
bun run build               # build the TS packages (bun --filter; the C# bridge builds in `dist`)
bun run build:installer     # the product → dist/release/Volt-win-Setup.exe (payload + electron + Inno)
bun run test:install        # THE install gate: install/uninstall/update ×N on a real machine (Windows)
bun run check               # wiring check: built binaries + source-extension + product-version parity
bun run typecheck           # tsgo --noEmit across all volt packages
bun run lint                # oxlint
```

All of these live in `scripts/` (product-level orchestration across all packages) — **`scripts/README.md`
maps every script**; keep it accurate. `build:installer` internally runs `build-payload.ts` (the `dist/volt/`
payload); that stage has no `bun run` on purpose — it's a step, not a destination.

**Gating mutating verbs is the HOST's job, not Volt's.** `volt pull/push/init/merge` write to a live PLC, so an
agent should confirm before running them — but that confirmation belongs in the host's permission system (Claude
Code's `.claude/settings.json`, an MCP client's tool-approval prompt), configured by the user. Volt ships no
approval layer of its own and annotates rather than enforces. There used to be a two-key permission gate in
`opencode-config/opencode.json` (`permission.volt` for the custom tool, `permission.bash` for the shell) — it went
with the config directory.

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
dotnet test test/Volt.Cli.Connector.Tests/                 # connector core: session model, reconciler, TC supervisor
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

## Agent hosts — PATH, and nothing else

There are only **three delivery mechanisms** across every host that matters, and Volt already owns two:

| Mechanism | Reaches |
|---|---|
| `volt` + `volt-lsp-iec` on **PATH** | every host with a terminal — Claude Code, Cursor, Windsurf, VS Code |
| the **`volt-vscode` extension** (VS Code Marketplace + Open VSX) | VS Code, Cursor, Windsurf, VSCodium — one `.vsix`, no fork-specific build |
| a **plugin / MCP entry** the user installs | Claude Code (`lspServers`), Claude Desktop (MCP — its only door; no terminal, no editor) |

- The **installer** sets exactly one persistent user env var: `PATH += <bin>`. That single step is the whole integration for every terminal-capable agent. Uninstall removes it.
- **Volt writes into no other vendor's configuration.** Not `~/.claude/settings.json`, not `~/.cursor/mcp.json`, not `%APPDATA%\Claude\claude_desktop_config.json`. Those files belong to their products and are rewritten by them; silently editing one is unreviewable and unrevertable by the user. Host wiring ships as a **published artifact** (extension in a registry, plugin in a marketplace) or a **documented snippet the user pastes** — see `packages/volt-web/app/docs/agents.mdx`.
- **Volt installs no agent.** It neither bundles, updates, nor installs one, and it launches none. (An opt-in winget task once offered to install opencode; it was removed, then the whole opencode integration followed. Don't re-add an in-app or installer-driven agent install.)
- If pasting a snippet ever proves to be real friction, the escalation is a user-invoked `volt setup --host <name>` that prints or applies it — deliberate and reversible. Never the installer.

## Conventions

- **Git (trunk-based, direct-push):** `dev` is the trunk and the only long-lived branch. Changes push **directly to `dev`** — **no PR required** (we move fast); only force-pushes and branch deletion are still rejected. CI runs on every push but is **advisory, not a merge gate** — you're trusted to keep it green, and a red push is a signal to fix forward, not a block. Short-lived feature branches + PRs remain available and are worth it for genuinely risky or large work, but they are optional, not the default. The **one version is git-derived and injected** — `scripts/version.ts` takes the `X.Y.Z` base from `packages/volt-desktop/package.json` (the one number a human sets — git can't infer a patch-vs-feature bump) and the build number from the commit count, and `release.yml` **stamps that base into every `package.json`** at build (so you never hand-sync `volt-vscode`) and passes the full version via `VOLT_VERSION`. One version scheme, two channels by PROMOTION (no branches, no separate stable number): **every push to `dev` auto-publishes a `X.Y.Z.<count>` prerelease** (the dev channel — `VOLT_UPDATE_CHANNEL=dev` tracks it), already tagged. A **release promotes one of those builds to prod** — **`bun run release [version]`** (or Actions → the **`promote`** workflow → Run workflow) points a chosen dev build at the stable channel: `promote.yml` re-checks it's a green-CI published prerelease, runs the install/uninstall/lifecycle gates against **its own** installer, then flips its GitHub release `prerelease → latest`. The released version IS the detailed `X.Y.Z.<count>` build you promoted — monotonic (a former 3-part stable tag sorted BELOW every 4-part dev build, i.e. `0.0.1` = `0.0.1.0` < `0.0.1.842`, so a dev→stable switch read as a downgrade and never updated). `release.ts` only triggers the workflow (via `gh`); the gating + flip run in CI, nothing installs locally. The `.vsix` stays 3-part `<maj>.<min>.<count>` (`vsce` rejects a 4-part version); the installer + connector carry the full 4-part build. The other `volt-*` packages are private and unpublished, so their `version` is inert. CI is **`ci.yml`**: one job per concern (`typecheck` / `lint` / `test` / `integration` / `openspec`) run on every push — **advisory** now (branch protection no longer requires any status check; they inform, they don't block). A check run is named after the **job**, not the workflow, so N jobs report N checks; these were five near-identical workflows until that was measured. Only the **path-filtered** `deploy` stays separate (a job can't override `on: paths`), plus `release`. CI jobs no longer gate anything, so renaming one changes only what reports, not what blocks — but keep the names stable so history stays readable. Conventional commit messages: `type(scope): summary` with types `feat|fix|docs|chore|refactor|test`. Useful scopes: `bridge`, `cli`, `lsp`.
- **Platform:** primary dev is Windows + PowerShell (the bridges and CODESYS tooling are Windows-only). Bun's Bash tool is also available for POSIX scripts. Bridge build/dev-loop scripts live in `packages/volt-cli/scripts/*.ps1`; repo-wide tooling (the wiring check, dist, installer helpers) in `scripts/`.
- **`.volt/`** is a CLI-managed PLC workspace binding (`.git/volt`) — the only Volt-owned config directory there is. Volt has no agent-config directory (see above) and writes none into a user's home.
- **Source of truth for invariants is the code + each package's `README.md`/`ARCHITECTURE.md`** (e.g. `volt-cli/ARCHITECTURE.md`, `volt-lsp-iec/docs/`), not a parallel spec tree. **OpenSpec is `openspec/changes/` only** — in-flight proposals + the decision log (`openspec list`); the archived `specs/` capability tree was removed (it drifted) and its load-bearing invariants folded into the package docs.

## The wiring check

```
bun run check      # built binaries + source-extension parity + product-version parity
```

Offline and key-free, so CI runs it on every push. It asserts the writable-source extension set agrees across
every runtime that declares it (C#, the LSP, volt-control, and four separate places in the VS Code manifest) —
a new source kind can't be added in one place and silently missed in another.

> This replaced `bun run compat`, a two-step gate whose real purpose was `verify-opencode.ts`: driving the
> installed opencode binary to confirm it still loaded Volt's config layer. Both are deleted with the integration
> they tested. **There is no third-party contract left to track** — that is the point of the removal, not a gap
> in coverage. Full script map: `scripts/README.md`.

Adding another vendor LSP: `packages/volt-lsp-iec/README.md` → "Adding another vendor LSP".
