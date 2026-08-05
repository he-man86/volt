# @volt/desktop

> The Volt desktop app — connection, sync and diagnostics for one PLC workspace. The desktop sibling of `volt-vscode`.

A standalone Electron app. It opens from its own executable (Start Menu → **Volt**, or `desktop\Volt.exe`) or from
the connector's tray, and it depends on nothing but the connector. There is no embedded browser, no bundled editor
and no agent runtime: Volt's chrome **is** the window.

> This app used to wrap the installed opencode's served GUI in a `WebContentsView`, with the active workspace
> following opencode's GUI route. That coupling is gone — Volt no longer integrates with opencode at all. The
> workspace is now chosen explicitly and remembered (`recent.ts`), and agents reach Volt through the `volt` CLI on
> PATH rather than through this window. See `packages/volt-web/app/docs/agents.mdx` for the host integrations.

## How it works

- **The window** — a frameless titlebar, a thin icon rail on the right, and the IDE panel filling everything else.
  The rail navigates between the panel's three sections (it does not show/hide anything): **IDE Connection**
  (pick a detected project → set up → connect/disconnect), **IDE Sync** (drift + pull/push/build), **Diagnostics**
  (headless LSP collector). IDE Connection leads the panel and owns every connection affordance; IDE Sync only
  answers "what changed" — the same split as the VS Code extension. Sync carries pull/push/build plus **force pull
  / force push** (confirmed first), and a merge in progress offers **Finish / Abort** inline. What the desktop
  deliberately does NOT have is the per-file merge editor (take-a-side) and click-to-diff — those need an editor,
  which is what `volt-vscode` is for. Bridge *lifecycle* (spawning/activating) is still the connector's job, never
  this shell.
  - **The panel is a pure renderer of `@volt/control`'s view-model** — no shell-side connection/vendor logic, so
    both frontends show identical data. Decisions (the create-vs-reconnect picker partition, matching-project-first
    ordering, onboarding state) come from control (`connectSurface`, `onboardingMode`, `projectWorkspace`);
    `shell.html` maps them to DOM + copy. **The UI is vendor-blind** — a project is identified by its NAME only (no
    `"CODESYS · "` prefix/badge); `vendor` lives strictly below the wire (pipe name, LSP arg, binding identity).
- **Which workspace is open** — chosen explicitly, then remembered. On launch the app re-binds the last workspace
  it was bound to (`recent.ts`, stored under `userData`); otherwise it starts unbound on the connection surface,
  which offers both **create a workspace from a detected IDE project** and **open an existing Volt workspace**.
  `VOLT_WORKSPACE` is a dev override. The memory is load-bearing, not a convenience: unlike VS Code there is no
  open folder to fall back on, so without it a returning user would be offered a brand-new workspace every launch
  while their real one sat unreachable.
  - **The bridge connection follows the bound workspace** (over the `connector-session-model`) — binding
    **declares an interest** in it (`enterWorkspace`), releasing it **drops** the interest (`leaveWorkspace`), and
    app quit `shutdownSession()`s the whole session (via `before-quit`, bounded ~1.5s); the same shared
    `@volt/control` lifecycle VS Code drives from `activate`/`deactivate`. The connector serves a project iff ≥1
    live session wants it, so **one project open in two UIs no longer disconnects each other** (see
    `openspec/changes/connector-session-model/`). Manual Connect/Disconnect stay as an override.

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
| `src/main.ts` | Electron main: the window + lifecycle, tool paths, the diff popup, workspace restore |
| `src/panel.ts` | the IDE-panel data feed — projects `@volt/control`'s view-model to the renderer; bind/unbind |
| `src/commands.ts` | pull/push/build/init/connect + open-a-workspace — Electron dialogs over the shared flows |
| `src/recent.ts` | the last bound workspace (why the app knows where to reopen) — unit-tested without Electron |
| `preload.cjs` | exposes `window.volt` (the `@volt/control` IPC contract) to the shell renderer |
| `shell.html` | the whole UI — frameless titlebar, icon rail, IDE panel (DOM, no framework) |
| `assets/` | Volt brand icons (window/taskbar `.ico` + marks for packaging) |
| `electron-builder.yml` | electron-builder **`--dir`** config — brands `Volt.exe` only; it builds no installer (Inno packs it) |

**`productName: "Volt"` in `package.json` is load-bearing — don't drop it as a duplicate of `electron-builder.yml`.**
Electron's `app.getName()` reads `productName` before `name`, and it derives `userData` from it. Without it the
name is `@volt/desktop`, and Electron writes its caches to a literal `%APPDATA%\@volt\desktop\`. With it, they
land in `%APPDATA%\Volt\` — which is also where `recent.ts` stores the last workspace. See `installer/README.md`
for every location Volt writes.

## Packaging

The shell runs from source with `bun run start`. The shipped app is built by `bun scripts/build-installer.ts` into
**one Inno Setup installer** (`dist/release/Volt-win-Setup.exe`, see `installer/Volt.iss`) bundling the desktop GUI +
`volt` CLI + LSP + tray connector. electron-builder (see `electron-builder.yml`) runs in `--dir` mode only —
it brands `Volt.exe`, not an installer, and no `electron-updater` is wired. Env/shortcut setup and the **auto-update
loop are owned by the always-running C# connector** (`VoltConnector.exe`, which the installer launches and the login
item restarts); `configureTools()` resolves the bundled `volt`/LSP `.exe`s from the packaged resources. The VS Code
extension ships as an opt-in wizard task per detected editor (VS Code / Windsurf / Cursor).

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the shared TS core this renders.
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — the editor sibling frontend.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance and architecture.
