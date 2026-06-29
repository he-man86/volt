## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution — Windows only, one installer

See `design.md`. Volt is **Windows-only** (CODESYS / TwinCAT + the C# bridges are Windows). The desktop NSIS
installer is the **single vehicle** — bundles the binaries, registers the LSP, adds `volt` to PATH; auto-update
via electron-updater → `he-man86/volt`. **Published: v0.1.0.**

### Build (done)
- [x] 2.1 `volt` is one entry — bare → agent, `volt <verb>` → PLC (dispatcher in volt-git)
- [x] 2.2 In-process binary — `src/volt.ts` (PLC → `bin.ts`, else → `import("opencode/index")`); validated against the live bridge
- [x] 2.3 `volt-scripts/build.ts` mirrors opencode's `build.ts` (solid plugin + TUI workers + defines), `volt.ts` entry — clean build, TUI included
- [x] 2.4 `dist.ts` orchestrates `build.ts` (volt) + compiles the LSP binary → `dist/volt/bin`

### Windows installer (the single vehicle)
- [x] 2.5 electron-updater feed (beta + prod) → `he-man86/volt`
- [x] 2.6 Desktop self-contained — bundle `dist/volt/bin` (extraResources) + register LSP/tool on production startup (main → `setup()`; volt-git exposes `./setup`)
- [x] 2.7 Published **v0.1.0** (fresh version line; unsigned)
- [ ] 2.8 NSIS adds `resources/volt/bin` to PATH → terminal `volt` / `volt pull` from the desktop install
- [ ] 2.9 Point `volt-control`'s `setBundledCli` at the bundled `volt` (unify the panel's `volt.js` onto the one exe)
- [ ] 2.10 Runtime-verify 2.6 — install the package on a clean profile, confirm the LSP auto-registers

### Shared
- [x] 2.11 Removed the `volt setup` CLI verb; `setup()` is the install-time registration function
- [ ] 2.12 Bridge connector — build C# bridges + install into the IDE (Beckhoff exe / CODESYS scripting dir)
- [ ] 2.13 Volt branding — `home_logo` TUI plugin (`scriptName`/logo) + replace `opencode.ai` constants + Volt Sentry DSN

### Dropped / deferred
- **Code-signing** — skipped for now (opencode ships unsigned too; revisit if SmartScreen friction matters).
- **mac/linux builds · npm wrapper + postinstall · `curl | bash` · brew/AUR · standalone `volt upgrade`** —
  opencode's *other-platform* CLI channels. N/A: Volt is Windows-only and the installer carries the CLI.
