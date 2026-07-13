# @volt/desktop

> The Volt desktop app — an Electron shell that wraps the **installed** opencode's GUI and adds Volt chrome + the IDE panel. The desktop sibling of `volt-vscode`.

Volt is opencode-independent: this shell does **not** bundle opencode. It spawns the user's installed `opencode serve`, reads the `listening on http://…` URL it prints, and loads that GUI in a `WebContentsView`. Volt owns a frameless titlebar + a collapsible icon rail + a right-side IDE panel; opencode's GUI is the inner content pane.

## How it works

- **Spawn + attach** — on launch, `main.ts` spawns `opencode serve` (`OPENCODE_BIN`, default `opencode` on PATH), parses the printed URL, and loads it in a `WebContentsView`. No opencode packages are bundled — opencode is a provisioned runtime.
- **IDE panel** — the rail + panel render over `@volt/control` (the same UI-agnostic core `volt-vscode` uses — *share the logic, not the pixels*): **IDE Sync** (drift + pull/push/build), **Diagnostics** (headless LSP collector), **Bridge** (health/port). Bridge lifecycle is the connector's job, never this shell.
- **Active workspace follows opencode** — the shell sniffs the GUI's `x-opencode-directory` request header (or `?directory=`) and binds that project — no folder picker (like VS Code's open folder). `VOLT_WORKSPACE` is a dev override.
- **Agent config** — the installed opencode is made Volt-aware by the installer-set `OPENCODE_CONFIG_DIR` (points at the shipped `volt-config`); this shell sets **no** per-spawn env.

## Prerequisites

- **Installed opencode** on PATH (or `OPENCODE_BIN` pointing at the real `opencode.exe`). On Windows the PATH entry is a `.cmd` shim Node can't `spawn` directly, so the installer sets `OPENCODE_BIN` to the `.exe`. Absent → the window shows an "Install opencode" message.

## Build & run

```bash
bun run build     # bundle src/main.ts → main.mjs (bun build; electron external)
bun run dev       # same, in --watch
bun run start     # build, then launch electron
bun run typecheck # tsgo --noEmit
```

## Layout

| Path | Role |
|---|---|
| `src/main.ts` | Electron main: spawn opencode, wrap its GUI, host Volt chrome + the IDE panel, follow the active project |
| `preload.cjs` | exposes `window.volt` (the `@volt/control` IPC contract) to the shell renderer |
| `shell.html` | the Volt chrome — frameless titlebar, icon rail, IDE panel (DOM, no framework) |
| `assets/` | Volt brand icons (window/taskbar `.ico` + marks for packaging) |

## Status

The shell runs from source (`bun run start`). **Packaging is not done here** — the electron-builder config + NSIS installer (which also resolves the bundled tool paths for `configureTools`) are the `distribution` change; see `openspec/changes/distribution/`.

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the shared TS core this renders.
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — the editor sibling frontend.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance and architecture.
