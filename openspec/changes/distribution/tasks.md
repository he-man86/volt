## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution — Windows only, ONE installer + the extension

See `design.md`. Windows-only. **One all-inclusive installer + the VS Code extension:** (1) **the Volt installer**
(electron-builder NSIS) bundles the GUI app + the `volt` CLI on PATH + the bridge + the LSP — a terminal/advanced
user installs the same thing and uses `volt` + the extension, ignoring the GUI; (2) **`volt-vscode` extension** —
a thin launcher that runs `volt` (from the install) in a side terminal + PLC language support.

> **Collapsed 3 channels → 1 installer** (was: desktop + a standalone CLI installer + extension). The CLI
> installer was opencode-channel-mirroring Volt doesn't need: opencode splits CLI/desktop for headless/cross-platform
> (servers, CI), but Volt is Windows-only and the bridge talks to a live GUI IDE on the same workstation — never
> headless. The desktop is a superset that already puts `volt` on PATH, so a 2nd installer only created collisions
> (two `volt` on PATH, shared `VoltConnector.exe`/Run-key → uninstalling one broke the other). **Updates** =
> electron-updater (`he-man86/volt`, opencode's mechanism) → GUI + CLI + bridge update together.

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

### ~~CLI installer~~ — REMOVED (collapsed into the one installer)
Built + tested (a standalone NSIS to `~/.volt` with a desktop-detection guard), then **removed**: the
install-matrix test showed the both-installed case (CLI-then-desktop) collides on the shared `VoltConnector.exe`
+ Run-key — uninstalling one breaks the other. The desktop already covers the CLI, so deleting the 2nd installer
retires the whole collision class. Removed `volt-cli.nsi` + `build-cli-installer.ts`; `volt-path.ps1` kept (the
installer's NSIS uses it for PATH); `build-installers.ts` → `build-installer.ts` (one installer).

### Flow 2 — VS Code extension (`volt-vscode`)
- [x] 2.11 Extension bundles LSP (`dist/lsp-server.js`) + CLI (`dist/cli.js`) + PLC language support — built (`.vsix` exists, v1.21.20)
- [x] 2.12 **Agent in the editor** — DONE, mirrors opencode's extension: **Quick Launch** ("Volt: Open Agent" — opens/focuses the agent terminal) + **New Session**. The agent binary is a **prerequisite** (the Volt install puts `volt` on PATH; `resolveAgentExe` resolves the install's bundled binary, else `volt` on PATH) — the extension *launches* it, never bundles or downloads it. Follow-ons for full opencode parity: Windows-safe keybindings, context-awareness (share selection/tab), `@File#Lx-y` reference shortcuts.
- [~] 2.13 Publish — Marketplace listing (**publisher `volt-ai`**, since `volt` is likely taken) + **download links in the docs**: the `.vsix` + the **Volt installer** (`Volt-Setup-<ver>-x64.exe` — the one install; the extension uses its bundled `volt`). Both ready; the Marketplace publish needs a publisher token, and the doc links go live with the release.

### Shared
- [x] 2.14 Removed the `volt setup` CLI verb **and** the global `setup()` — `volt init` now writes the LSP + `volt` tool into the **project** `.opencode/` (coexists with stock opencode; nothing global to clean)
> **Lifecycle-audit refinements (2026-07-12)** — fold into 2.13 / 2.15b / 2.15c (source: the install/uninstall/
> update review; full model in `minimize-opencode-fork/design.md` → "Target lifecycle & installer"):
> - **2.13 — extension authority per path:** desktop-install → sideloaded + **version-locked to the install**
>   (sideload only if newer; don't fight Marketplace for those users); extension-only → Marketplace. Prevents the
>   force-sideload-vs-Marketplace **version thrash/downgrade**.
> - **2.15b — single-connector invariant:** one connector, one Run-key, one port. The desktop **detects +
>   supersedes** a standalone connector (like the retired CLI-installer's desktop-detection guard) — no port fight.
> - **2.15c — graceful update:** **quiesce** in-flight pull/push before killing the connector; `protocolVersion`
>   gate covers the new-connector ↔ old in-proc-DLL window; "restart CODESYS" prompt for the net48 DLL.

- [ ] 2.15 Connector **standalone installer** — background Windows gateway (CODESYS in-proc lib / TwinCAT standalone `.exe`), HTTP 8555/8556
- [ ] 2.15b Desktop **bundles + chains** the connector installer + re-deploys it on app update (one-install UX)
- [ ] 2.15c Connector **self-update** lane (extension users) + `protocolVersion` on `/health` (compat gate) + CODESYS "restart CODESYS" prompt
- [ ] 2.15d Verify a clean **standalone** connector install (VoltConnector + the net48/net8 bridges → `%LocalAppData%\Programs\Volt\`) on a fresh Windows box — folded in from the retired `connector-installer` change (its installer rework = 2.15, bridge bundling = 2.15b + gap-review, install path already verified for the desktop)
- [ ] 2.16 Branding — `home_logo` plugin committed (NEEDS visual verify + bundling into the global config for shipped) · `scriptName`/`opencode.ai` constants remain

### Dropped / deferred
- **Code-signing** — skipped for now (opencode ships unsigned too).
- **mac/linux · npm · `curl | bash` · brew/AUR · standalone `volt upgrade`** — opencode's *other-platform*
  channels. N/A: Volt is Windows-only and the one all-inclusive installer covers it (updates via electron-updater).

## 3. Gap review — verified on a clean install

Clean-install test (`Volt-Setup-0.1.0`): **the two critical runtime gaps are CLOSED.**

- [x] Agent-tool invocation — now execs the compiled `volt.exe` directly; **verified** in the installed `tool/volt.ts` (`VOLT_CMD/VOLT_ARGS`).
- [~] LSP registration — **moved to the project `.opencode/` via `volt init`** (was global; that leaked into stock opencode + rotted on uninstall). Re-verify on a clean install + `volt init`.
- [~] Connector — **EXISTS** (a `VoltConnector` install: `BeckhoffBridge.exe` + `VoltConnector.exe` + bridge core, at `Programs\Volt`). Not "missing." Remaining: bundle/chain it in the desktop (2.15b), extension reference, update lane (2.15c).
- [x] 🔴 **Coexistence** — FIXED + verified on a clean machine: `extraMetadata.name = "Volt"` → installs to `Programs\Volt` (was `@opencode-aidesktop`, shared with stock opencode); appId `dev.volt.desktop`. Volt + stock opencode coexist.
- [x] 🔴 **Clean lifecycle** — DONE + verified (install AND uninstall): the connector is **bundled into the desktop installer** (`extraResources` → `resources/volt/connector` + NSIS `customInstall`/`customUnInstall` via the fork-owned `connector.nsh`). Install launches it + it self-registers the login item; uninstall stops it (`taskkill`) + drops the login item + removes everything; global config stays empty (project `.opencode/`). Tray renamed "**Volt Bridge Connector**" + Volt bolt icon. Flow 2 (extension) still needs a standalone connector download.
- [x] 🟢 **Self-contained connector** — publishes with the .NET 8 runtime bundled (verified: `System.Windows.Forms.dll` ships in the install), so it runs with **no framework on the customer's machine**. +52 MB to the installer (228 MB total; the 158 MB bundle compresses).
- [~] 🔵 Remaining niceties: terminal `volt` PATH (2.8 — **DONE** via bundled `volt-path.ps1`, not raw NSIS; live-verified); `home_logo` TUI plugin (2.16 — additive, visual-unverified; TUI is secondary to the desktop GUI). **2.9 `setBundledCli`: deliberately NOT changed** — the panel runs `volt.js` via Electron's own node (`ELECTRON_RUN_AS_NODE`), which is lighter than spawning the 130 MB exe.
