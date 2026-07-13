# Distribution design — one installer, connector-hosted updates (Velopack)

**One installer for all Volt apps (except the VS Code extension), and updates driven by the always-running C#
connector.** Windows-only. opencode is an optional, user-provided runtime we never bundle or update.

## Why this shape

- **One installer, not two lanes.** A single install delivers everything: the desktop GUI, the `volt` CLI (on
  PATH), the `volt-lsp-iec` LSP, the tray connector, and `volt-config`. A terminal user installs the same thing
  and lives in `volt` + the tray, ignoring the window. (The VS Code extension stays Marketplace-only.)
- **Updates must come from the connector, not the GUI.** electron-updater only checks when the Electron window
  is *open* — a tray/terminal user who never opens it would never update. The **connector is the one process
  alive in every configuration**, so it hosts auto-update.
- **opencode is optional.** No install-time gate. If it's absent the desktop shows a graceful "install opencode
  for the agent" panel (already in `main.ts`); the PLC tools (`volt`, LSP, bridge) work regardless.

## Updater — Velopack, hosted in the connector

**Velopack 1.2** is the standard modern .NET installer+updater (successor to Squirrel, by the same author). It
is both the **installer** (`vpk pack` → one setup .exe) and the **update framework** the connector calls — no
hand-rolled update logic, GitHub-releases-native (no appcast host, no mandatory signing), delta updates.

- **Install:** `vpk pack` bundles the whole Volt payload as one Velopack app → `%LocalAppData%\Volt` with a
  stable `current\` dir. mainExe = **VoltConnector.exe** (so Velopack's lifecycle hooks + the update loop run in
  C#).
- **Env wiring in C# (`VoltEnv.cs`), via Velopack hooks** — replaces the retired NSIS/PowerShell installer:
  `OnAfterInstall`/`OnAfterUpdate` set `OPENCODE_CONFIG_DIR` + add `bin` to PATH + register start-at-login;
  `OnBeforeUninstall` reverts them + stops bridge workers.
- **Auto-update loop (`Updater.cs`)** — market-normal (VS Code / Electron) flow: the always-on connector
  checks `he-man86/volt` on startup + every 6 h and **downloads in the background**, then the tray surfaces it —
  a one-time **toast** ("Volt <ver> is ready…") + a **"Restart to update to <ver>"** menu item, so the user
  picks the moment. It also applies automatically on the next natural restart (`SetAutoApplyOnStartup`), so
  nothing forces a mid-session restart. No-op unless Velopack-installed (dev + any embedded copy stay inert);
  touches only the Volt app dir — **never opencode**.
- **Tray menu** shows the installed **version** (`Updater.CurrentVersion`) in its header.
- **GUI shortcut:** the OnAfterInstall hook creates the Start Menu "Volt" shortcut → the Electron `Volt.exe`
  (the connector auto-starts via its login item, so it needs no user shortcut).

```
one installer (vpk) ──▶ %LocalAppData%\Volt\current\ : Volt.exe (GUI) + volt CLI + LSP + connector + config
 connector (always-on) ──▶ Velopack UpdateManager ← he-man86/volt   (GUI + CLI + connector update together)
 opencode ── user-provided, optional, its own updater (untouched)
 VS Code extension ── Marketplace (not in the installer)
```

## Payload layout (Velopack packDir)

`vpk pack --mainExe VoltConnector.exe` over an assembled staging dir → `current\`:
```
current\
  VoltConnector.exe + connector files      (mainExe: hooks + update loop)
  bin\  volt.exe, volt-lsp-iec.exe          (→ PATH)
  volt-config\                              (→ OPENCODE_CONFIG_DIR)
  docs\                                     (ST reference corpus)
  desktop\ Volt.exe + electron runtime      (electron-builder --dir output; Start Menu shortcut target)
```
`VoltEnv` resolves `bin`/`volt-config` relative to the connector exe, so it survives the stable `current\` path
across updates. The connector stays **self-contained** (its own .NET runtime bundled) → no `--framework`, no
runtime download at setup (offline-safe). Its files sit at the packDir root alongside the sibling subdirs.

## Build pipeline (`volt-scripts/build-app.ts`)

1. `bun volt-scripts/dist.ts` → `dist/volt/{bin,connector,volt-config,docs}` (already exists).
2. `electron-builder --dir` (new minimal `packages/volt-desktop/electron-builder.config.ts`, Win, branded,
   **no nsis/publish** — Velopack owns install+update) → the unpacked Electron app.
3. Assemble the staging layout above; `vpk pack --packId Volt --packTitle Volt --mainExe VoltConnector.exe
   --icon … --shortcuts None` → `dist/release/Volt-win-Setup.exe` + the release feed. (`--shortcuts None`: the
   connector auto-starts via its login item; its install hook creates the GUI shortcut.)
4. Publish the release assets to `he-man86/volt` (`vpk upload github`), which the connector's UpdateManager
   reads. (Full auto-update is only exercisable against a published release — like electron-updater was.)

## opencode integration — unchanged, one env var

`OPENCODE_CONFIG_DIR` (set by the connector's install hook) is an *extra* merged config dir; opencode keeps the
user's own global config + provider keys (data dir untouched) and merges Volt's LSP + `volt` tool + agent +
theme on top. No `autoupdate` in the bundle. Uninstall reverts the env → opencode is vanilla again.

## Retired by this design
- The two-lane NSIS model + standalone `volt-cli.nsi` + `build-cli-installer.ts` + `connector.nsh` +
  `volt-path.ps1` / `volt-extension.ps1` (env wiring is now C# in `VoltEnv.cs`; install+update is Velopack).
- electron-updater as the desktop updater, and the hard opencode prerequisite.
- **Dropped earlier already:** volt:// deep-links, installer-side extension sideloading, code-signing (later),
  mac/linux · npm · curl|bash · brew/AUR (Windows-only).
