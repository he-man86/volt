# Design: one shipped config dir, handed to opencode via `OPENCODE_CONFIG_DIR`

The whole Volt agent layer — LSP, the `volt` tool, the agent persona, the brand theme, TUI branding,
permission gates, and the update channel — ships as **one read-only directory** that the installed app hands
to opencode through the **`OPENCODE_CONFIG_DIR`** environment variable. There is no per-project `.opencode/`:
`volt init` only binds the IDE and installs vendor skills.

## How opencode consumes it (mapped to the docs)

opencode's config model is documented at <https://opencode.ai/docs/config/>. The relevant contracts:

- **Config sources, low→high precedence** (docs): remote (`.well-known/opencode`) → global
  (`~/.config/opencode/opencode.json`) → `OPENCODE_CONFIG` (a file) → **project `opencode.json`** →
  **`.opencode/` directories** → `OPENCODE_CONFIG_CONTENT` (inline) → managed files → macOS managed prefs.
- **`lsp` key** (docs): `true` enables built-ins; an **object** enables built-ins plus overrides/custom
  servers (`{ "<id>": { command, extensions, … } }`). This is the shape Volt uses for `volt-lsp-codesys`.
- **`OPENCODE_CONFIG_DIR`** (docs): a custom config directory "searched for agents, commands, modes, and
  plugins" — i.e. the plural subdirs `agents/ commands/ modes/ plugins/ skills/ tools/ themes/`.

**One nuance the docs undersell — and the load-bearing part of this design:** the docs describe
`OPENCODE_CONFIG_DIR` only as a source of *agents/commands/modes/plugins*, but the code gives it the **full
`.opencode` treatment**, including `opencode.json` itself:

- `config/config.ts:424` — `if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)` → loads that
  dir's `opencode.json` (so `lsp`, `permission`, `autoupdate` all apply), on top of `tool/ agent/ plugin/
  themes/`.
- `core/global.ts:64` — `config: Flag.OPENCODE_CONFIG_DIR ?? Path.config`: the env dir **replaces the global
  config slot**, so even global-keyed loaders read from it.
- `config/paths.ts:26-39` — `directories()` returns `[Global.Path.config (= our dir), <project .opencode
  dirs>, ~/.opencode, OPENCODE_CONFIG_DIR (deduped)]`; the loader merges them **last-wins**.

Two consequences fall straight out of that ordering, and both are verified against the live `/config` endpoint
(not assumed):

1. **The LSP is detected with zero project files.** `GET /config` on a project with no `.opencode/` returns
   `lsp: { "volt-lsp-codesys": … }`. (LSP servers still attach *lazily* — `/lsp` stays `[]` until a `.st`
   file is read; that is opencode's "activates as files are read", not a missing config.)
2. **Users can still customize.** Volt's dir loads **first** (as the global slot); a user's project
   `.opencode/` loads **after** and deep-merges over it (`OPENCODE_DISABLE_PROJECT_CONFIG` is never set). So
   customization is optional, never required, and always wins over the Volt baseline.

## The shipped dir (`resources/volt/volt-config/`)

```
volt-config/
  opencode.json        # autoupdate: "notify"
                       # lsp: { "volt-lsp-codesys": { command: ["volt-lsp-codesys","--stdio"], extensions:[…] } }
                       # permission: { bash: { "volt init*"|"volt pull*"|"volt push*"|"volt merge*": "ask" } }
  tui.json             # theme: "volt"  +  plugin: ["./plugins/volt.tsx"]  (see plugin note below)
  tool/volt.ts         # the volt CLI as a custom tool — bundled to tool/volt.js at dist (plugin inlined)
  agent/volt.md        # the Volt agent persona
  themes/volt.json     # brand theme
  plugins/volt.tsx     # TUI branding — the home_logo slot (Volt logo)
```

Sibling of the dir, beside the binaries: `resources/volt/bin/{volt,volt-lsp-codesys}.exe` (on `PATH`) and
`resources/volt/docs/` (the ST reference corpus that `volt init` copies into a project's `.claude/skills/`).

### Why the branding plugin is *declared*, not auto-scanned

opencode's plugin auto-scan is `config/plugin.ts:21` → `{plugin,plugins}/*.{ts,js}` — it **does not match
`.tsx`**. The `home_logo` slot needs JSX, so it must be `.tsx`. Hence `plugins/volt.tsx` is registered by an
explicit `plugin: ["./plugins/volt.tsx"]` entry in `tui.json` rather than relying on the scan. (The custom
tool has no such issue — the tool scan is `tool/registry.ts:174` → `{tool,tools}/*.{js,ts}`, and the tool
ships as a self-contained `.js`.)

## Path resolution — bare-name, ships static

The LSP and tool commands are bare names (`volt-lsp-codesys`, `volt`). opencode spawns LSP servers through
**cross-spawn** (`lsp.ts:174` → launch), which PATH/PATHEXT-resolves a bare command on Windows; the launcher
prepends `resources/volt/bin` to `PATH`. So the dir carries **no machine-specific paths** and ships
**static** — no first-run write, no npm/registry step (`@opencode-ai/plugin` is vendored/inlined into the
bundled tool at dist time).

## Wiring `OPENCODE_CONFIG_DIR`

- **Desktop:** `desktop/src/main/index.ts` sets `OPENCODE_CONFIG_DIR = resources/volt/volt-config` and
  prepends `resources/volt/bin` to `PATH` (the sidecar's `createSidecarEnv` inherits it).
- **CLI/TUI:** the `volt` binary (`volt-git/src/volt.ts`) sets the same env from the sibling dir before
  handing off to the opencode entry in-process.

## What stays per-project (`volt init`)

- `.git/volt/config.json` — the IDE binding (genuinely per-project).
- `.claude/skills/*-reference/` — vendor-specific ST language reference, copied from `resources/volt/docs`.

Everything the old `writeOpencodeConfig` produced (`.opencode/opencode.json`, `tool/volt.ts`, `package.json`,
the `bun/npm install`) is gone.

## Related seams that ride the same dir/env

- **Updater** — opencode's self-updater is hardcoded to opencode's npm/GitHub feed. Behind `VOLT_UPDATE_REPO`
  (set by `volt.ts`; the desktop sets `OPENCODE_DISABLE_AUTOUPDATE` and uses electron-updater instead) it
  tracks `he-man86/volt` releases and runs the Volt installer. `autoupdate: "notify"` in the dir makes it
  prompt rather than auto-run.
- **Corpus** — `volt init`'s `installCorpus` reads `docs/` beside the executable
  (`dirname(process.execPath)/../docs`) since `bun --compile` can't embed an fs-read tree.

## Supersedes

`harden-opencode-integration` Step 0's plugin-vendoring task folds in here (the plugin is inlined into the
bundled tool). The `<spinner>` + channel work there is unaffected.
