# @volt/desktop

> The Volt desktop app — an Electron shell that wraps the **installed** opencode's GUI and adds Volt chrome + the IDE panel. The desktop sibling of `volt-vscode`.

Volt is opencode-independent: this shell does **not** bundle opencode. It spawns the user's installed `opencode serve`, reads the `listening on http://…` URL it prints, and loads that GUI in a `WebContentsView`. Volt owns a frameless titlebar + a collapsible icon rail + a right-side IDE panel; opencode's GUI is the inner content pane.

## How it works

- **Spawn + attach** — on launch, `main.ts` spawns `opencode serve` (`OPENCODE_BIN`, default `opencode` on PATH), parses the printed URL, and loads it in a `WebContentsView`. No opencode packages are bundled — opencode is a provisioned runtime.
- **IDE panel** — the rail + panel render over `@volt/control` (the same UI-agnostic core `volt-vscode` uses — *share the logic, not the pixels*): **IDE Connection** (pick a detected project → set up → connect/disconnect), **IDE Sync** (drift + pull/push/build), **Diagnostics** (headless LSP collector). IDE Connection leads the panel and owns every connection affordance; IDE Sync only answers "what changed" — the same split as the VS Code extension. Sync carries pull/push/build plus **force pull / force push** (confirmed first), and a merge in progress offers **Finish / Abort** inline. What the desktop deliberately does NOT have is the per-file merge editor (take-a-side) and click-to-diff — those need an editor, which is what `volt-vscode` is for. Bridge *lifecycle* (spawning/activating) is still the connector's job, never this shell.
  - **The panel is a pure renderer of `@volt/control`'s view-model** — no shell-side connection/vendor logic, so both frontends show identical data. Decisions (the create-vs-reconnect picker partition, matching-project-first ordering, onboarding state) come from control (`connectSurface`, `onboardingMode`, `projectWorkspace`); `shell.html` maps them to DOM + copy. **The UI is vendor-blind** — a project is identified by its NAME only (no `"CODESYS · "` prefix/badge); `vendor` lives strictly below the wire (pipe name, LSP arg, binding identity). The one shell-specific exception is the opencode binding below.
- **Active workspace follows opencode (STICKY, releases on home)** — opencode's server has **no queryable "current project"** and is **session-scoped**: until you start a chat, opencode reports its `global` scope for both its home screen *and* every new-session draft, and it only reveals a plaintext project directory once a session exists (the `?directory=` on GET requests is encrypted). All verified live — see `openspec/changes/desktop-connection-flow/observations.md`. So the shell sniffs the GUI's requests and **binds to a real project directory** when opencode reveals one, rebinding when you work in a different project. The request stream **never releases** (it can't tell home from a draft — both are `global`). The one release is driven off the **GUI's actual URL**: when opencode navigates to its home route (`/`), `watchHomeNavigation` drops the binding so the panel doesn't show a stale project on the homepage. `VOLT_WORKSPACE` is a dev override; `VOLT_BIND_DEBUG=1` logs every request's `dir → classification`. The bind decision is the pure reducer in `binding.ts`.
- **Agent config** — the installed opencode is made Volt-aware by the installer-set `OPENCODE_CONFIG_DIR` (points at the shipped `opencode-config`); this shell sets **no** per-spawn env.

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
| `src/main.ts` | Electron main: spawn opencode, wrap its GUI, host Volt chrome + the IDE panel; classify opencode's requests into an active-project signal and bind/release on it |
| `src/binding.ts` | the pure bind/unbind/hold reducer (`dir`/`none`/`unknown` → action) — the workspace-binding lifecycle, unit-tested without Electron |
| `preload.cjs` | exposes `window.volt` (the `@volt/control` IPC contract) to the shell renderer |
| `shell.html` | the Volt chrome — frameless titlebar, icon rail, IDE panel (DOM, no framework) |
| `assets/` | Volt brand icons (window/taskbar `.ico` + marks for packaging) |
| `electron-builder.yml` | electron-builder **`--dir`** config — brands `Volt.exe` only; it builds no installer (Inno packs it) |

**`productName: "Volt"` in `package.json` is load-bearing — don't drop it as a duplicate of `electron-builder.yml`.**
Electron's `app.getName()` reads `productName` before `name`, and it derives `userData` from it. Without it the
name is `@volt/desktop`, and Electron writes its caches to a literal `%APPDATA%\@volt\desktop\`. With it, they
land in `%APPDATA%\Volt\`. The electron-builder key only brands the packaged `.exe`; this one sets the runtime
path. See `installer/README.md` for every location Volt writes.

## Packaging

The shell runs from source with `bun run start`. The shipped app is built by `bun volt-scripts/build-installer.ts` into
**one Inno Setup installer** (`dist/release/Volt-win-Setup.exe`, see `installer/Volt.iss`) bundling the desktop GUI +
`volt` CLI + LSP + tray connector + config. electron-builder (see `electron-builder.yml`) runs in `--dir` mode only —
it brands `Volt.exe`, not an installer, and no `electron-updater` is wired. Env/shortcut setup and the **auto-update
loop are owned by the always-running C# connector** (`VoltConnector.exe`, which the installer launches and the login
item restarts); `configureTools()` resolves the bundled `volt`/LSP `.exe`s from the packaged resources. The VS Code
extension is Marketplace-distributed, and the installer also ships the `.vsix` as an opt-in wizard task per detected
editor (VS Code / Windsurf / Cursor).

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the shared TS core this renders.
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — the editor sibling frontend.
- [`../../CLAUDE.md`](../../CLAUDE.md) — repo-wide guidance and architecture.
