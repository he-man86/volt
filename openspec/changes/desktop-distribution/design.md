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

## Install — one Volt installer; self-contained (zero external opencode)

`volt` is built **entirely from this repo** and bundles **our own Volt-branded opencode**, so it depends on
no externally-installed opencode. Bare `volt` spawns the *bundled* opencode (resolved beside the binary),
never a system one. One installer ships everything; CLI-only stays a later option for headless users.

```
PRIMARY — one Volt installer (desktop + CLI together)
   Volt-Setup.exe
     ├ installs the desktop app          (embeds our opencode + the PLC panel)
     ├ installs the CLI on PATH:  volt + opencode(ours) + volt-lsp-codesys   ← all from dist/volt/
     ├ registers LSP + tool in ~/.config/opencode/     (idempotent, on app/CLI startup)
     ├ installs the bridge connector into the IDE      (Beckhoff exe · CODESYS scripting dir)
     └ auto-updates via electron-updater               (REUSED from opencode — already configured)

SECONDARY (later) — CLI-only for headless/server users
   npm i -g volt   /   curl … | bash      (per-platform binaries, mirrors opencode-ai's publish.ts)
```

**Self-contained, not "relying on opencode":** our opencode build *is* part of this repo (the fork). Bundling
it is shipping our own product, not depending on a third party — and it stays additive (we build + bundle +
wrap opencode, never edit its source). The cost is install size (our opencode binary rides along); the win is
one Volt-branded install with no external prerequisite.

**Updates:** opencode's desktop already auto-updates via `electron-updater` (GitHub release feed in
`electron-builder.config.ts`). One installer → that one updater refreshes the app *and* the bundled CLI/LSP
together. No new update machinery. (CLI-only npm/curl installs self-update via their own channel.)

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
   `run`, `auth`, …) spawns the **bundled** opencode (resolved beside the binary, not from PATH); `volt
   <verb>` (init/pull/push/status/build/log/show/merge) runs the PLC CLI. One Volt-branded command, no
   external dependency.

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

5. **Self-contained, one installer (decided).** `volt` bundles our own Volt-branded opencode and spawns it
   beside the binary — zero external opencode dependency. PRIMARY distribution is **one installer** (desktop
   + CLI together), auto-updated by opencode's existing `electron-updater`. CLI-only (npm/curl) is a later
   secondary for headless users. Registration is idempotent into one shared `~/.config/opencode/`, so the
   bundled CLI and the desktop coexist cleanly.

## Branding (separate track, after the plumbing works)

GUI is Volt (logo `packages/ui`, name `packages/desktop`). The **TUI/CLI** still shows opencode — closed by
an additive `home_logo` plugin (`.opencode/plugins/volt.tsx`, `@opentui/solid`) bundled in the global config.
Polish, sequenced after a clean-machine install works.
