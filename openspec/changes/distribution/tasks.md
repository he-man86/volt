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
- [ ] 2.10 Runtime-verify 2.6 — install on a clean profile, confirm the LSP auto-registers

### Flow 2 — VS Code extension (`volt-vscode`)
- [x] 2.11 Extension bundles LSP (`dist/lsp-server.js`) + CLI (`dist/cli.js`) + PLC language support — built (`.vsix` exists, v1.21.20)
- [ ] 2.12 Add **the agent in the editor** — run the Volt agent inside VS Code (terminal panel, or webview + server; mirrors opencode's extension)
- [ ] 2.13 Publish — VS Code Marketplace listing + a **download link in the docs** (the `.vsix`)

### Shared
- [x] 2.14 Removed the `volt setup` CLI verb; `setup()` is the install-time registration function
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
- [x] LSP runtime registration (2.10) — **verified**: a clean install re-registered the LSP into the global config, pointing at the bundled binary.
- [~] Connector — **EXISTS** (a `VoltConnector` install: `BeckhoffBridge.exe` + `VoltConnector.exe` + bridge core, at `Programs\Volt`). Not "missing." Remaining: bundle/chain it in the desktop (2.15b), extension reference, update lane (2.15c).
- [ ] 🔴 **Coexistence** — the desktop install dir is `@opencode-aidesktop` (from the package name `@opencode-ai/desktop`), so it **landed in + overwrote stock opencode's dir**. Volt must install to its OWN dir + appId (`dev.volt.desktop`) and **never touch opencode** — they coexist.
- [ ] 🔴 **Clean lifecycle** — connector has **no installer/uninstaller**; neither uninstaller cleans the global-config registration (`~/.config/opencode`). Rename the connector → "**Volt Bridge Connector**" (own dir + tray name, distinct from the app "Volt" → no `Programs\Volt` clash); add an installer/uninstaller; uninstall removes the config registration.
- [ ] 🟠 Extension bundles `bin.ts` (PLC CLI), not the agent (2.12); terminal `volt` PATH (2.8); `setBundledCli` (2.9); `home_logo` unverified + unbundled (2.16).
