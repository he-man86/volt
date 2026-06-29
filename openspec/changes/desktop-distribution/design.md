# Distribution design

How every Volt artifact is built, installed, and wired — across the CLI, LSP, bridges, and desktop app.
All product code is `packages/volt-*`; the installer is the only thing that touches the user's machine.

## Components — 3 binaries + 1 app

| Artifact                   | Package            | Role                                                |
|----------------------------|--------------------|-----------------------------------------------------|
| `volt[.exe]`               | volt-git           | CLI — bare `volt` → agent, `volt <verb>` → PLC sync |
| `volt-lsp-codesys[.exe]`   | volt-lsp-codesys   | Structured Text / FBD LSP (no node needed)          |
| `bridge/`                  | volt-bridge        | C# IDE connectors (Beckhoff exe / CODESYS lib)      |
| Volt app                   | desktop            | Electron GUI — embeds opencode + the PLC panel      |

## Build — one command

```
bun volt-scripts/dist.ts
        │
        ▼
   dist/volt/                          (gitignored, built fresh per release)
   ├─ bin/volt[.exe]                   ← bun --compile  (volt-git)
   ├─ bin/volt-lsp-codesys[.exe]       ← bun --compile  (volt-lsp-codesys)
   └─ bridge/                          ← dotnet build:all (volt-bridge)
```

## Install — the desktop installer is the vehicle

```
Volt installer (NSIS, from electron-builder)
   │  bundles dist/volt/  →  resources/volt/        (extraResources)
   │
   ├─▶ PATH += resources/volt/bin                   →  `volt`, `volt pull` in any terminal
   ├─▶ ~/.config/opencode/opencode.jsonc            →  lsp.volt-lsp-codesys = resources/volt/bin/volt-lsp-codesys
   │   ~/.config/opencode/tool/volt.ts              →  tool VOLT_BIN = resources/volt/bin/volt
   │        (written by the app on startup, idempotent — NOT a `volt setup` CLI verb)
   └─▶ bridge/  →  IDE                              →  Beckhoff: copy exe · CODESYS: scripting dir
```

## Runtime — how the pieces talk

```
TERMINAL
  volt              →  opencode (agent)   →  loads volt-lsp-codesys   (LSP)
  volt pull / push  →  volt-git           →  bridge  →  IDE

DESKTOP  (Volt.exe)
  embedded opencode (sidecar)             →  loads volt-lsp-codesys   (LSP, same global config)
  renderer PLC panel  →  volt-control IPC →  volt[.exe]  →  bridge  →  IDE
```

## Key decisions

1. **`volt` is one entry point.** Dispatcher in volt-git `bin.ts`: bare `volt` (and any non-PLC command —
   `run`, `auth`, …) delegates to opencode; `volt <verb>` (init/pull/push/status/build/log/show/merge) runs
   the PLC CLI. One Volt-branded command.

2. **Registration is the installer/app's job, not a CLI verb.** The app writes the global LSP + tool config
   on startup (idempotent merge), pointing at the bundled binaries. The `volt setup` CLI verb is **removed** —
   a CLI editing the user's global config is what caused the duplicate-`volt`-tool collision (global +
   repo `.opencode` both registering `volt`).

3. **One compiled `volt[.exe]`, three consumers.** Replaces the current node `volt.js` bundle. Used by:
   the terminal (PATH), `volt-control`'s IPC (`setBundledCli` → the exe, for the desktop panel), and the
   LSP tool's `VOLT_BIN`. One artifact instead of two packagings of the same code.

4. **The LSP works on stock opencode.** It's pure config (`lsp` block) + a self-contained binary — verified
   to load and deliver diagnostics on the official opencode build, no fork dependency. The desktop just
   ships + registers it.

## Branding (separate track, after the plumbing works)

GUI is Volt (logo `packages/ui`, name `packages/desktop`). The **TUI/CLI** still shows opencode — closed by
an additive `home_logo` plugin (`.opencode/plugins/volt.tsx`, `@opentui/solid`) bundled in the global config.
Polish, sequenced after a clean-machine install works.
