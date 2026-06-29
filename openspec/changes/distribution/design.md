# Distribution design — mirror opencode

**Principle: reuse opencode's distribution machinery verbatim, parameterized for Volt. Don't invent.**
opencode already solves CLI + desktop distribution and updates. Volt's job is to point those mechanisms at
Volt's releases and carry the minimal PLC / LSP / bridge additions *inside* opencode's existing shapes.

## Platform — Windows only

Volt targets **Windows only** — the CODESYS / TwinCAT IDEs and the C# bridges are Windows-only. Dropped as
N/A (opencode's *other-platform* CLI channels): mac/linux builds, the npm wrapper + postinstall, `curl | bash`,
brew/AUR, standalone `volt upgrade`. Volt reuses only opencode's build pipeline + electron-builder +
electron-updater.

## Delivery — two flows

Volt ships **two ways**; both are Windows-only and both connect to the same IDE bridge.

**1. Desktop — one install with everything.** The Volt electron app (NSIS installer) bundles the agent (our
opencode build) + the LSP + the CLI and registers the LSP on first run. Auto-updates via electron-updater →
`he-man86/volt`. **Published: v0.1.0.** For standalone users (no VS Code).

**2. VS Code extension — `volt-vscode`.** Bundles the LSP (`dist/lsp-server.js`) + the CLI (`dist/cli.js`) +
PLC language support (syntax / VG / drift coloring) + the agent in the editor. Distributed via a **download
link in the docs** (the `.vsix`) or the VS Code Marketplace. For engineers who edit in VS Code — one extension
= editing + LSP + sync + agent, no npm, no desktop.

**Shared prerequisite — the connector** (both flows connect to it over HTTP, neither hosts it). It's a
**background gateway** running on Windows that connects to the live IDE and exposes it over a small HTTP wire
(8555/8556) — CODESYS via an in-proc lib, TwinCAT via a standalone background `.exe`. It's installed and runs
**separately** from the desktop app and the extension; both just *talk to* it.

```
                   ┌─────────────────────────────┐
  Flow 1 (desktop) │ Volt.exe: agent + LSP + CLI │──┐
                   └─────────────────────────────┘  │   HTTP 8555/8556
                   ┌─────────────────────────────┐  ├──▶  connector  ──▶  CODESYS / TwinCAT
  Flow 2 (vscode)  │ volt-vscode: LSP+CLI+agent  │──┘   (background Windows gateway, shared)
                   └─────────────────────────────┘
```

## What opencode already does (and we reuse)

| Concern        | opencode mechanism                                                        | Volt reuse                  |
|----------------|---------------------------------------------------------------------------|-----------------------------|
| CLI binary     | `script/build.ts` → per-platform binaries (`bun --compile`)               | build ours the same way     |
| npm            | `script/publish.ts` → `opencode-ai` wrapper (bin, postinstall, `optionalDependencies`) | mirror → `volt` wrapper |
| curl           | root `install` script (downloads the release binary, modifies PATH)       | mirror → Volt install URL   |
| brew / AUR / Docker | `publish.ts` (formula / PKGBUILD / image)                            | mirror later, Volt repo     |
| CLI update     | `opencode upgrade` — method-aware via `installation/`                     | `volt upgrade`, reuse logic |
| Desktop        | electron-builder + electron-updater (GitHub feed)                         | reuse, **re-point feed**    |
| Release host   | `anomalyco/opencode` GitHub releases                                       | **Volt's own repo**         |

## Components

| Artifact            | Built like               | Role                                                              |
|---------------------|--------------------------|-------------------------------------------------------------------|
| `volt` binary       | opencode `build.ts`      | **our opencode build + the PLC dispatcher** — one binary: agent commands run opencode, `volt <verb>` runs PLC |
| `volt-lsp-codesys`  | `bun --compile`          | ST/FBD LSP — registered, never invoked by the user                |
| `bridge/`           | `dotnet build:all`       | C# IDE connectors                                                  |
| Volt desktop        | electron-builder         | opencode's app + branding + embedded LSP                          |

## CLI distribution — mirror `opencode-ai`

```
build.ts (ours)  →  per-platform `volt` binaries  →  GitHub release (Volt repo)
                                                          │
publish.ts (mirror)  →  npm `volt` wrapper:               ▼
   bin: { volt }                                    npm i -g volt   |   curl …|bash   |   brew install volt
   postinstall: link binary  +  register LSP              (npm owns PATH + the binary; the ONE Volt addition
   optionalDependencies: volt-{os}-{arch}                  is the postinstall line that writes the LSP block
                                                           into ~/.config/opencode/)
```

The **only** Volt addition to opencode's npm recipe is one postinstall line: register the LSP (+ tool).
Everything else — the wrapper, `optionalDependencies`, the placeholder bin, `os`/`cpu` filtering — is
opencode's `publish.ts` verbatim, renamed.

## Desktop — mirror opencode's electron app

Unchanged from opencode except: branding seams (done); **⚠ re-point the electron-updater feed to Volt's
repo** (else it self-updates back to stock opencode); bundle + register the LSP for the embedded opencode.

## Updates — mirror opencode

**Release repo: `he-man86/volt`** (public; prod releases on the *source* repo, exactly like opencode's prod
on `anomalyco/opencode`). Beta is unused — not split into a separate repo (opencode uses `opencode-beta`).

- **CLI:** `volt upgrade` reuses opencode's method-aware `installation/` logic, pointed at `he-man86/volt`.
- **Desktop:** electron-updater feed → `he-man86/volt` (done, 2.9). ⚠ This re-point is the load-bearing change.

## Key decisions

1. **`volt` = our opencode build + PLC dispatcher, ONE in-process binary** (validated). The dispatcher's
   else-branch does a dynamic `import()` of opencode's `src/index.ts`, which reads `process.argv` at module
   top, runs the CLI, and `process.exit()`s. `bun --compile` bundles opencode in, so `volt` is one
   self-contained binary (our opencode + the PLC verbs) — no spawn, no external opencode. Additive: volt-git
   imports opencode's entry, never edits it. *Impl notes:* resolve the import via an `opencode` dep or a
   relative path; the volt build must pass opencode's `--conditions=browser`; the binary is opencode-sized
   (expected). One leak: opencode's yargs `scriptName` is `"opencode"`, so `--help` text still says opencode
   until branding (2.14).
2. **Mirror, don't invent.** Reuse `build.ts`, `publish.ts`, the `install` script, `electron-updater`,
   `opencode upgrade`. Parameterize for Volt; carry PLC/LSP/bridge inside those shapes.
3. **⚠ Re-point every feed to Volt's GitHub repo** (npm tag, install URL, brew/AUR source, electron-updater).
   The single most load-bearing change — miss it and installs/updates pull stock opencode.
4. **The LSP is the one real addition** to opencode's recipe: one postinstall line (CLI) / one startup call
   (desktop) writing the `lsp` block into `~/.config/opencode/`. Replaces the `volt setup` CLI verb (removed).
5. **Separate CLI and desktop** (like opencode) — npm/curl for the CLI, electron for the app. Not one
   installer. Simpler: each piece is opencode's, reused.

## Volt-specific, unavoidable (kept minimal, ride inside opencode's shapes)

- PLC dispatcher (volt-git) — compiled into the `volt` binary.
- `volt-lsp-codesys` — registered by postinstall (CLI) / startup (desktop), shipped alongside the binary.
- bridge connector — IDE-side install (Beckhoff exe / CODESYS scripting dir).

## Branding (additive)

GUI logo + app name: done (seams). TUI logo: `home_logo` plugin. Deep string rebrand of opencode internals is
non-additive → out of scope; the binary name `volt` + the logo carry the brand.

## Build scripts

- `volt-scripts/build.ts` — the **volt binary** build. Mirrors opencode's `script/build.ts` (solid JSX plugin,
  TUI worker entrypoints, tree-sitter/version/models defines) with `volt.ts` as the entry. Runs from
  `packages/opencode` so opencode's relative paths resolve; re-port when opencode's `build.ts` changes.
  *(Web-UI embed skipped for now → `volt web` not wired; the TUI + commands work.)*
- `volt-scripts/dist.ts` — orchestrates a local bundle: calls `build.ts` (volt) + compiles `volt-lsp-codesys`
  + the bridges into `dist/volt/`. Dev convenience; the **release** path is the mirrored `publish.ts` over
  `build.ts`'s per-platform output.
