## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution — Windows only, three channels (mirror opencode + Volt's layer)

See `design.md`. Windows-only. **Three delivery channels, each = an opencode channel + Volt's layer (bridge +
PLC LSP + PLC commands):** (1) **desktop app** — one all-inclusive install (GUI + CLI + LSP + bridge);
(2) **CLI installer** — `volt` on PATH + LSP + self-contained bridge (the curl-install equivalent, for the
advanced CLI + VS Code user); (3) **`volt-vscode` extension** — thin launcher that runs `volt` in a side
terminal (the agent is a prerequisite from #1 or #2). All connect to the same IDE **bridge**.

### Build (done)
- [x] 2.1 `volt` is one entry — bare → agent, `volt <verb>` → PLC (dispatcher in volt-git)
- [x] 2.2 In-process binary — `src/volt.ts` (PLC → `bin.ts`, else → `import("opencode/index")`); validated against the live bridge
- [x] 2.3 `volt-scripts/build.ts` mirrors opencode's `build.ts` (solid plugin + TUI workers + defines) — clean build, TUI included
- [x] 2.4 `dist.ts` orchestrates `build.ts` (volt) + compiles the LSP binary → `dist/volt/bin`

### Flow 1 — Desktop (one install with everything)
- [x] 2.5 electron-updater feed (beta + prod) → `he-man86/volt`
- [x] 2.6 Desktop self-contained — bundle `dist/volt/bin` (extraResources) + register LSP/tool on production startup
- [x] 2.7 Published **v0.1.0** (fresh version line; unsigned)
- [x] 2.8 Desktop NSIS adds `resources/volt/bin` to PATH (`connector.nsh` + bundled `volt-path.ps1`) → terminal `volt` from the desktop install — **live-verified** (prod update-in-place: PATH added, helper bundled, connector running)
- [ ] 2.9 Point `volt-control`'s `setBundledCli` at the bundled `volt` (unify the panel's `volt.js` onto the exe)
- [ ] 2.10 Runtime-verify — install on a clean profile, `volt init` a project, confirm the LSP attaches from the project `.opencode/`

### Channel #2 — CLI installer (NEW — done + tested)
- [x] 2.10a Standalone NSIS (`volt-scripts/cli-installer/volt-cli.nsi` + `build-cli-installer.ts`, makensis from electron-builder's NSIS cache) → installs `volt` + LSP + the self-contained connector to `%USERPROFILE%\.volt`, adds `.volt\bin` to PATH (idempotent `volt-path.ps1`), launches+registers the connector, ships an uninstaller. **Tested:** install (files + PATH + `volt --version`=0.1.0) → uninstall (files + PATH + Run-key all removed).
- [x] 2.10b **Desktop-detection guard** — keys off `Programs\Volt\resources\volt\bin\volt.exe` (constant across the Volt/Dev/Beta channels; same path `resolveAgentExe` checks); bows out if the desktop is present (alternatives — no PATH/connector collision). **Tested:** desktop present → aborts, no `.volt` created.

### Flow 2 — VS Code extension (`volt-vscode`)
- [x] 2.11 Extension bundles LSP (`dist/lsp-server.js`) + CLI (`dist/cli.js`) + PLC language support — built (`.vsix` exists, v1.21.20)
- [x] 2.12 **Agent in the editor** — DONE, mirrors opencode's extension: **Quick Launch** ("Volt: Open Agent" — opens/focuses the agent terminal) + **New Session**. The agent binary is a **prerequisite** (the desktop install or the CLI installer — both put `volt` on PATH; `resolveAgentExe` resolves the desktop binary, else `volt` on PATH) — the extension *launches* it, never bundles or downloads it. (Dropped the standalone `volt-win-x64.exe` artifact — the CLI installer is the standalone channel now.) Follow-ons for full opencode parity: Windows-safe keybindings, context-awareness (share selection/tab), `@File#Lx-y` reference shortcuts.
- [~] 2.13 Publish — Marketplace listing (**publisher `volt-ai`**, since `volt` is likely taken) + **download links in the docs**: the `.vsix` + the **CLI installer** (`Volt-CLI-Setup-<ver>-x64.exe` — supersedes the old standalone connector zip; carries `volt` + LSP + the self-contained bridge). Both ready; the Marketplace publish needs a publisher token, and the doc links go live with the release.

### Shared
- [x] 2.14 Removed the `volt setup` CLI verb **and** the global `setup()` — `volt init` now writes the LSP + `volt` tool into the **project** `.opencode/` (coexists with stock opencode; nothing global to clean)
- [ ] 2.15 Connector **standalone installer** — background Windows gateway (CODESYS in-proc lib / TwinCAT standalone `.exe`), HTTP 8555/8556
- [ ] 2.15b Desktop **bundles + chains** the connector installer + re-deploys it on app update (one-install UX)
- [ ] 2.15c Connector **self-update** lane (extension users) + `protocolVersion` on `/health` (compat gate) + CODESYS "restart CODESYS" prompt
- [ ] 2.16 Branding — `home_logo` plugin committed (NEEDS visual verify + bundling into the global config for shipped) · `scriptName`/`opencode.ai` constants remain

### Dropped / deferred
- **Code-signing** — skipped for now (opencode ships unsigned too).
- **mac/linux · npm · `curl | bash` · brew/AUR · standalone `volt upgrade`** — opencode's *other-platform*
  channels. N/A: Volt is Windows-only and the two flows cover it.

## 3. Gap review — verified on a clean install

Clean-install test (`Volt-Setup-0.1.0`): **the two critical runtime gaps are CLOSED.**

- [x] Agent-tool invocation — now execs the compiled `volt.exe` directly; **verified** in the installed `tool/volt.ts` (`VOLT_CMD/VOLT_ARGS`).
- [~] LSP registration — **moved to the project `.opencode/` via `volt init`** (was global; that leaked into stock opencode + rotted on uninstall). Re-verify on a clean install + `volt init`.
- [~] Connector — **EXISTS** (a `VoltConnector` install: `BeckhoffBridge.exe` + `VoltConnector.exe` + bridge core, at `Programs\Volt`). Not "missing." Remaining: bundle/chain it in the desktop (2.15b), extension reference, update lane (2.15c).
- [x] 🔴 **Coexistence** — FIXED + verified on a clean machine: `extraMetadata.name = "Volt"` → installs to `Programs\Volt` (was `@opencode-aidesktop`, shared with stock opencode); appId `dev.volt.desktop`. Volt + stock opencode coexist.
- [x] 🔴 **Clean lifecycle** — DONE + verified (install AND uninstall): the connector is **bundled into the desktop installer** (`extraResources` → `resources/volt/connector` + NSIS `customInstall`/`customUnInstall` via the fork-owned `connector.nsh`). Install launches it + it self-registers the login item; uninstall stops it (`taskkill`) + drops the login item + removes everything; global config stays empty (project `.opencode/`). Tray renamed "**Volt Bridge Connector**" + Volt bolt icon. Flow 2 (extension) still needs a standalone connector download.
- [x] 🟢 **Self-contained connector** — publishes with the .NET 8 runtime bundled (verified: `System.Windows.Forms.dll` ships in the install), so it runs with **no framework on the customer's machine**. +52 MB to the installer (228 MB total; the 158 MB bundle compresses).
- [~] 🔵 Remaining niceties: terminal `volt` PATH (2.8 — **DONE** via bundled `volt-path.ps1`, not raw NSIS; live-verified); `home_logo` TUI plugin (2.16 — additive, visual-unverified; TUI is secondary to the desktop GUI). **2.9 `setBundledCli`: deliberately NOT changed** — the panel runs `volt.js` via Electron's own node (`ELECTRON_RUN_AS_NODE`), which is lighter than spawning the 130 MB exe.
