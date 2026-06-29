## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution

See `design.md`. One build command → every binary: `bun volt-scripts/dist.ts` → `dist/volt/`. `volt` is
**self-contained** (bundles our own Volt-branded opencode — no external dependency). PRIMARY = **one installer**
(desktop + CLI), auto-updated via opencode's `electron-updater`; CLI-only (npm/curl) is a later secondary.

### Build (done)
- [x] 2.1 Release build script (`volt-scripts/dist.ts`) — `volt` + `volt-lsp-codesys` + bridges → `dist/volt/`
- [x] 2.2 `volt` is one entry point — bare → agent, `volt <verb>` → PLC CLI (dispatcher in volt-git `bin.ts`)

### Self-contained `volt` (no external opencode)
- [ ] 2.3 Add our Volt-branded opencode binary to `dist/volt/bin/` (build via opencode's `build.ts`)
- [ ] 2.4 Dispatcher spawns the **bundled** opencode (resolve beside the volt binary, not PATH)

### One installer (primary: desktop + CLI)
- [ ] 2.5 Bundle `dist/volt/` via electron-builder `extraResources` + put `volt` on PATH (NSIS)
- [ ] 2.6 Register LSP + tool in the shared global config on startup (idempotent); point `volt-control`'s `setBundledCli` at the bundled `volt` — collapse the `volt.js` node bundle onto the one exe
- [ ] 2.7 ⚠ Re-point the `electron-updater` feed from `anomalyco/opencode` to **Volt's release repo** (else auto-update reverts the app to stock opencode); verify it refreshes the bundled CLI/LSP, not just the app, and that the install dir is stable so the PATH entry survives updates

### CLI-only (secondary, later — headless users)
- [ ] 2.8 npm `volt` wrapper + per-platform binaries + curl install script (mirror opencode-ai)

### Shared
- [ ] 2.9 Remove the `volt setup` CLI verb — keep `setup()` as the function the installer/app calls (was the cause of the duplicate-`volt`-tool collision)
- [ ] 2.10 Bridge connector — build C# bridges + install into the IDE (Beckhoff exe / CODESYS scripting dir)
- [ ] 2.11 Volt branding — `home_logo` TUI plugin + replace `opencode.ai` constants + Volt Sentry DSN
- [ ] 2.12 Code-signing (Windows certs) · signed release
