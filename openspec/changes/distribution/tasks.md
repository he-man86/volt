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

## 3. Gap review — open risks

v0.1.0 is a **scaffold**: agent + LSP *editing* work; the **PLC-sync loop does not** (no connector + a tool bug).

- [x] Agent-tool invocation — was `bun volt.exe` (fails on the compiled exe); now execs the binary directly (`setup.ts`). **Re-package the desktop to land it in a release.**
- [ ] 🔴 **Connector missing from the install** (2.15) — a fresh install can't reach the IDE. The remaining critical gap.
- [ ] 🟡 LSP runtime registration unverified on a packaged install (2.10); `home_logo` plugin unverified + not bundled for shipped (2.16).
- [ ] 🟠 Extension bundles `bin.ts` (PLC CLI), **not** the agent — "agent in the editor" (2.12) needs the full opencode (132M) or a spawn/download approach.
- [ ] 🟠 Terminal `volt` not on PATH (2.8); `setBundledCli` still on `volt.js` (2.9); connector update + `protocolVersion` (2.15c).
