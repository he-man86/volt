## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution — Windows only, two flows

See `design.md`. Windows-only. **Two delivery flows:** (1) the **desktop app** — one install with everything;
(2) the **`volt-vscode` extension** — download link in the docs / Marketplace. Both connect to the same IDE
**bridge** (the shared IDE-side prerequisite).

### Build (done)
- [x] 2.1 `volt` is one entry — bare → agent, `volt <verb>` → PLC (dispatcher in volt-git)
- [x] 2.2 In-process binary — `src/volt.ts` (PLC → `bin.ts`, else → `import("opencode/index")`); validated against the live bridge
- [x] 2.3 `volt-scripts/build.ts` mirrors opencode's `build.ts` (solid plugin + TUI workers + defines) — clean build, TUI included
- [x] 2.4 `dist.ts` orchestrates `build.ts` (volt) + compiles the LSP binary → `dist/volt/bin`

### Flow 1 — Desktop (one install with everything)
- [x] 2.5 electron-updater feed (beta + prod) → `he-man86/volt`
- [x] 2.6 Desktop self-contained — bundle `dist/volt/bin` (extraResources) + register LSP/tool on production startup
- [x] 2.7 Published **v0.1.0** (fresh version line; unsigned)
- [ ] 2.8 NSIS adds `resources/volt/bin` to PATH → terminal `volt` from the desktop install
- [ ] 2.9 Point `volt-control`'s `setBundledCli` at the bundled `volt` (unify the panel's `volt.js` onto the exe)
- [ ] 2.10 Runtime-verify — install on a clean profile, `volt init` a project, confirm the LSP attaches from the project `.opencode/`

### Flow 2 — VS Code extension (`volt-vscode`)
- [x] 2.11 Extension bundles LSP (`dist/lsp-server.js`) + CLI (`dist/cli.js`) + PLC language support — built (`.vsix` exists, v1.21.20)
- [ ] 2.12 Add **the agent in the editor** — run the Volt agent inside VS Code (terminal panel, or webview + server; mirrors opencode's extension)
- [ ] 2.13 Publish — VS Code Marketplace listing + a **download link in the docs** (the `.vsix`)

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
- [ ] 🟠 Extension bundles `bin.ts` (PLC CLI), not the agent (2.12); terminal `volt` PATH (2.8); `setBundledCli` (2.9); `home_logo` unverified + unbundled (2.16).
