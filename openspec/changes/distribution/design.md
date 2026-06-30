# Distribution design — mirror opencode

**Principle: reuse opencode's distribution machinery verbatim, parameterized for Volt. Don't invent.**
opencode already solves CLI + desktop distribution and updates. Volt's job is to point those mechanisms at
Volt's releases and carry the minimal PLC / LSP / bridge additions *inside* opencode's existing shapes.

## Platform — Windows only

Volt targets **Windows only** — the CODESYS / TwinCAT IDEs and the C# bridges are Windows-only. Dropped as
N/A (opencode's *other-platform* CLI channels): mac/linux builds, the npm wrapper + postinstall, `curl | bash`,
brew/AUR, standalone `volt upgrade`. Volt reuses only opencode's build pipeline + electron-builder +
electron-updater.

## Delivery — one installer + the extension

Volt ships **one all-inclusive installer** plus the VS Code extension; Windows-only, both connect to the same
IDE bridge.

**1. The Volt installer — everything in one.** The Volt electron app (NSIS, oneClick) bundles the agent (our
opencode build) + the LSP + the `volt` CLI + the self-contained connector; `connector.nsh` launches the
connector, registers its login item, **and adds `resources\volt\bin` to PATH** (so the terminal `volt` + the
extension work off the same install). The advanced/terminal user installs the same thing and lives in `volt` +
the extension, ignoring the GUI. Auto-updates via **electron-updater → `he-man86/volt`** (opencode's mechanism,
unmodified — only the feed is re-pointed), so the GUI + CLI + bridge update together. **Published: v0.1.0.**

**2. VS Code extension — `volt-vscode`.** A **thin launcher**: opens `volt` (from the install) in a side
terminal — the agent is a prerequisite, never bundled or downloaded — plus PLC language support (syntax / VG /
drift) + the LSP + sync. Distributed via a docs download link (the `.vsix`) or the Marketplace.

**Why not a separate CLI installer?** We built one (`~/.volt`) and removed it. opencode splits CLI/desktop for
headless/cross-platform reasons (servers, CI, SSH) that don't exist for Volt — Windows-only, and the bridge
talks to a live GUI IDE on the *same* workstation. The desktop is a superset that already puts `volt` on PATH,
so a 2nd installer only created collisions (two `volt` on PATH, shared `VoltConnector.exe`/Run-key →
uninstalling one broke the other). One installer is simpler **and** clearer.

```
  Volt installer ──▶ GUI + `volt` (on PATH) + LSP + connector ──▶ connector (HTTP 8555/8556) ──▶ CODESYS / TwinCAT
  VS Code extension ──▶ runs `volt` from the install in a side terminal
  updates: electron-updater ← he-man86/volt   (one feed; GUI + CLI + bridge update together)
```

## What opencode already does (and we reuse)

| Concern        | opencode mechanism                                                        | Volt reuse                  |
|----------------|---------------------------------------------------------------------------|-----------------------------|
| CLI binary     | `script/build.ts` → per-platform binaries (`bun --compile`)               | build ours the same way     |
| npm            | `script/publish.ts` → `opencode-ai` wrapper (bin, postinstall, `optionalDependencies`) | — N/A (Windows-only) |
| curl           | root `install` script (downloads the release binary, modifies PATH)       | — N/A (the one installer covers it) |
| brew / AUR / Docker | `publish.ts` (formula / PKGBUILD / image)                            | — N/A (Windows-only)        |
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

## The installer — everything in one (no npm/curl)

The one installer is the electron-builder desktop NSIS (`bun volt-scripts/build-installer.ts`): it bundles the
`volt` binary + LSP (`dist/volt/bin`) + the self-contained connector and puts `volt` on PATH. No npm wrapper /
postinstall / `optionalDependencies` / `curl | bash` — those are opencode's *other-platform* mechanisms, N/A
for a single-target Windows install. The LSP/tool registration is **not** a global step: `volt init` writes
the `lsp` block + the `volt` tool into the **project's** `.opencode/` (project-local — decision #4), so nothing
lands in the shared `~/.config/opencode` and Volt coexists with stock opencode.

## Desktop — mirror opencode's electron app

Unchanged from opencode except: branding seams (done); **⚠ re-point the electron-updater feed to Volt's
repo** (else it self-updates back to stock opencode); bundle + register the LSP for the embedded opencode.

## Updates — mirror opencode

**Release repo: `he-man86/volt`** (public; prod releases on the *source* repo, exactly like opencode's prod
on `anomalyco/opencode`). Beta is unused — not split into a separate repo (opencode uses `opencode-beta`).

- **CLI:** `volt upgrade` reuses opencode's method-aware `installation/` logic, pointed at `he-man86/volt`.
- **Desktop:** electron-updater feed → `he-man86/volt` (done, 2.9). ⚠ This re-point is the load-bearing change.
- **Connector:** rides the **desktop** update (the desktop re-deploys it on app update — one updater for desktop
  users); **extension** users self-update it from `he-man86/volt` (its own lane) or re-run the installer. The
  **CODESYS in-proc lib can't hot-swap** → needs a "restart CODESYS to finish" prompt either way.
- **Compatibility:** all three share the name-keyed HTTP wire → add a `protocolVersion` to the connector's
  `/health`, checked on connect; on mismatch the flow nudges the lagging side to update.

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
4. **The LSP is the one real addition** to opencode's recipe: `volt init` writes the `lsp` block + the `volt`
   tool into the **project's** `.opencode/` (project-local, never the shared `~/.config/opencode`) — so Volt
   coexists with stock opencode and nothing global rots on uninstall. Replaces the old global `setup()`.
5. **One installer, not opencode's CLI/desktop split.** opencode separates CLI and desktop for headless/cross-platform
   reasons Volt doesn't have (Windows-only; the bridge needs a live GUI IDE on the same machine). So Volt ships
   one all-inclusive installer (GUI + `volt` on PATH + bridge + LSP) + the thin extension — we built a separate
   CLI installer, then removed it (a 2nd installer only collided with the desktop on the shared `volt` PATH +
   connector identity).

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
