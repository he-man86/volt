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

## Install — two independent paths that coexist (mirrors opencode)

opencode ships the **CLI** via package managers (`npm i -g opencode-ai` with per-platform binaries as
`optionalDependencies`; `curl … | bash` that modifies PATH; brew/AUR) and the **desktop** as a separate
Electron installer. Volt mirrors this: a user installs **either or both**; they share one global config.

```
CLI install  (mirror opencode: curl | npm | brew)        DESKTOP install  (electron installer)
  curl -fsSL https://volt.dev/install | bash               Volt-Setup.exe
     or  npm i -g volt                                         │ installs the app
        │ per-platform volt + volt-lsp-codesys                 │ bundles the same binaries (extraResources)
        ├─▶ PATH += install dir                                └─▶ register LSP/tool   (app startup)
        └─▶ register LSP/tool in ~/.config/opencode/                  in ~/.config/opencode/
                       │                                                    │
                       └──────────────►  ~/.config/opencode/  ◄────────────┘
                                         shared · idempotent merge · either/both write it
   bridge/ → IDE  (Beckhoff exe · CODESYS scripting dir) — ships with whichever install touches the IDE
```

**opencode dependency (open decision).** Bare `volt` delegates to `opencode`, so the *CLI-only* install
needs opencode on the machine. Two options:
- **(a) peer install** — `volt` requires opencode (the user installs it via opencode's own channel). Lazy,
  matches today's dispatcher. The desktop already embeds opencode, so only the CLI-only case is affected.
- **(b) `volt` *is* opencode** — a Volt-branded opencode build with the PLC verbs built in. One binary, no
  delegation, no dependency. More build work; the clean end state.

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

5. **CLI and desktop are independent installs that coexist** (mirrors opencode). The CLI ships via package
   managers (curl/npm/brew); the desktop is a separate Electron installer. Registration is **idempotent**
   into one shared `~/.config/opencode/`, so having both on a machine Just Works — neither clobbers the
   other. This replaces the earlier "desktop bundles everything" assumption.

## Branding (separate track, after the plumbing works)

GUI is Volt (logo `packages/ui`, name `packages/desktop`). The **TUI/CLI** still shows opencode — closed by
an additive `home_logo` plugin (`.opencode/plugins/volt.tsx`, `@opentui/solid`) bundled in the global config.
Polish, sequenced after a clean-machine install works.
