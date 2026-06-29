## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution — mirror opencode

See `design.md`. **Reuse opencode's machinery** (`build.ts`, `publish.ts`, root `install`, electron-updater,
`opencode upgrade`), parameterized for Volt and pointed at **Volt's release repo**. CLI and desktop are
separate installs, like opencode. The only real Volt addition is one postinstall line registering the LSP.

### Foundations
- [x] 2.1 `volt` is one entry — bare → agent, `volt <verb>` → PLC (dispatcher in volt-git `bin.ts`)
- [x] 2.2 `volt-scripts/dist.ts` — local dev build of the binaries (not the distribution path)
- [ ] 2.3 `volt` binary = our opencode build + the PLC dispatcher (validate: one binary in-process, else the wrapper carries both and the dispatcher spawns the sibling)

### CLI distribution (mirror `opencode-ai`)
- [ ] 2.4 Mirror `build.ts` → per-platform `volt` binaries → Volt GitHub release
- [ ] 2.5 Mirror `publish.ts` → npm `volt` wrapper (bin, postinstall, `optionalDependencies` per-platform)
- [ ] 2.6 postinstall = opencode's binary-link logic **+ one line: register the LSP** in `~/.config/opencode/`
- [ ] 2.7 Mirror the `install` curl script (Volt release URL, modifies PATH)
- [ ] 2.8 (later) brew formula / AUR PKGBUILD — mirror `publish.ts`, pointed at Volt's repo

### Desktop (mirror opencode)
- [ ] 2.9 ⚠ Re-point the `electron-updater` feed `anomalyco/opencode` → **Volt's repo** (else it self-updates back to stock opencode)
- [ ] 2.10 Bundle + register the LSP for the embedded opencode (startup); point `volt-control`'s `setBundledCli` at the bundled `volt`

### Updates (mirror opencode)
- [ ] 2.11 `volt upgrade` — reuse opencode's method-aware `installation/` logic, pointed at Volt's releases

### Shared
- [ ] 2.12 Remove the `volt setup` CLI verb — LSP registration moves to postinstall (CLI) / startup (desktop)
- [ ] 2.13 Bridge connector — build C# bridges + install into the IDE (Beckhoff exe / CODESYS scripting dir)
- [ ] 2.14 Volt branding — `home_logo` TUI plugin + replace `opencode.ai` constants + Volt Sentry DSN
- [ ] 2.15 Code-signing (Windows certs) · signed release
