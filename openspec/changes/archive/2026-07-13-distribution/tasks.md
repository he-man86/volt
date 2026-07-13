ONE Windows installer for all Volt apps (desktop GUI + `volt` CLI + LSP + connector + config; NOT the VS Code
extension), with **auto-update driven by the always-running C# connector via Velopack**. opencode is an
optional, user-provided runtime. See `design.md`.

## 1. Payload — done
- [x] 1.1 `volt-scripts/dist.ts` → `dist/volt/{bin,connector,volt-config,docs}` (de-forked: no opencode)
- [x] 1.2 Branding assets: Volt logo, tray "Volt Bridge Connector" + bolt icon, app icon

## 2. Connector-hosted updater (Velopack) — the core — IN PROGRESS
- [x] 2.1 Add `Velopack 1.2.0` to `Volt.Bridge.Connector.csproj`; `VelopackApp.Build()…Run()` first in `Main` — **builds clean**
- [x] 2.2 `VoltEnv.cs` — install/uninstall hooks set/revert `OPENCODE_CONFIG_DIR` + PATH + login item (replaces the NSIS/ps1 env wiring, now in C#)
- [x] 2.3 `Updater.cs` — always-on loop: check `he-man86/volt` on start + every 6 h, download, **stage**; applied at next startup via `SetAutoApplyOnStartup(true)` (GUI closed → nothing locked); no-op unless Velopack-installed; never touches opencode
- [x] 2.4 `VoltEnv` install hook creates the Start Menu "Volt" GUI shortcut → `desktop\Volt.exe` (WScript.Shell COM); connector auto-starts via its login item. **Connector builds clean.**
- [x] 2.5 Connector stays **self-contained** (decided: no `--framework` — offline-safe). `mgr.IsInstalled` gating + hook path resolution corrected to the root layout.

## 3. One installer (Velopack pack) — CODE DONE, full build + release pending
- [x] 3.1 `packages/volt-desktop/electron-builder.yml` — **`--dir` only** (Win, `productName "Volt"`, `appId dev.volt.desktop`, icon, `asar:false`, `files`); **no nsis/publish**. **`electron-builder --dir` verified — produces `win-unpacked/Volt.exe`.** (YAML not .ts — the .ts loader needs Windows symlink privilege.)
- [x] 3.2 `main.ts configureTools()` — packaged branch resolves `bin\volt.exe` / `volt-lsp-iec.exe` from `process.resourcesPath`; dev keeps the `.js` paths. **+ `volt-control` (`cli.ts`/`diagnostics.ts`) now spawns a compiled `.exe` directly, `.js` via node — additive, extension unaffected.** All typecheck clean.
- [x] 3.3 `main.ts` — opencode-absent panel softened to "optional: install opencode for the agent; PLC tools work without it"
- [x] 3.4 `volt-scripts/build-app.ts` — dist → electron `--dir` → assemble staging → `vpk pack --mainExe VoltConnector.exe --shortcuts None` → `dist/release/Volt-win-Setup.exe`. Written + typechecks. **`vpk pack` proven on the connector (root mainExe, VelopackApp.Run() verified).**
- [x] 3.5 FULL build runs clean → **`dist/release/Volt-win-Setup.exe` (316 MB)** + `releases.win.json`/`.nupkg` (the connector's update feed). `vpk` verified `VelopackApp.Run()` in the freshly-Velopack-rebuilt connector. *(electron `--dir` is reused across packs; `--rebuild-app` forces it. winCodeSign extraction is flaky without Windows Developer Mode — enable it for reliable fresh Electron builds.)*
- [x] 3.5b **Published v0.2.0** to `he-man86/volt` (installer + `releases.win.json` feed + full nupkg). *(vpk's merge choked on a partial-upload conflict; `gh release upload` + `--draft=false` published it cleanly.)*
- [x] 3.6 **Live-verified end-to-end** on this machine: uninstalled the old desktop → installed `Volt-win-Setup.exe` → **all hooks fired** (`OPENCODE_CONFIG_DIR`, PATH, Start Menu shortcut, Run key), `current/` layout correct, connector runs + supervises bridges, `IsInstalled=true`. Then **published v0.2.1** (1.8 MB delta) → the always-on connector **detected → downloaded → staged → applied** it (`current\sq.version` 0.2.0 → **0.2.1**), driven entirely from C#. Auto-update proven.

## 4. Extension — Marketplace (unchanged)
- [~] 4.1 `.vsix` builds; Marketplace listing (publisher `volt-ai`) needs a token; ext ↔ connector compat via `protocolVersion`. Never in the installer.

## Retired / dropped
- [x] Standalone `volt-cli.nsi` + `build-cli-installer.ts` — removed (superseded by the one Velopack installer)
- [ ] Remove `connector.nsh`, `volt-path.ps1`, `volt-extension.ps1` + their `dist.ts` copies (env wiring is now `VoltEnv.cs`; extension is Marketplace-only) — *do alongside 3.4*
- electron-updater as the desktop updater · hard opencode prerequisite · volt:// deep-links · installer-side extension sideload · code-signing (later) · mac/linux · npm · curl|bash · brew/AUR (Windows-only)

## Folded in / superseded (archived changes)
- `minimize-opencode-fork` Step 4 (installers) + `extract-clean-repo` §3 (installer) → here. Both archived.
