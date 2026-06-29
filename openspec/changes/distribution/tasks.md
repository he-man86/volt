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
- [x] 2.3 VALIDATED: `volt` is **one in-process binary** — dispatcher else-branch dynamic-imports opencode's `index.ts` (runs + `process.exit`s); `bun --compile` bundles it. Test passed (`volt --version` ran opencode in-process; `volt status` stayed in the dispatcher).
- [x] 2.3b DONE: `src/volt.ts` in-process entry (PLC → `bin.ts`, else → `import("opencode/index")`); excluded from typecheck (imports opencode's raw `.ts`). Compiled binary validated — `volt --version` ran opencode in-process, `volt status` hit the live bridge (11 changes). ⚠ naive `bun --compile` breaks the TUI bundle (`jsxDEV`) → needs opencode's `build.ts` flags (2.4)

### CLI distribution (mirror `opencode-ai`)
- [x] 2.4 `volt-scripts/build.ts` mirrors opencode's `build.ts` (solid plugin + TUI workers + defines), `volt.ts` entry — local binary builds clean (no `jsxDEV`); opencode command tree (`run --help`) + PLC verbs both work; `dist.ts` now calls it
- [ ] 2.4b Extend `build.ts` to the per-platform matrix + smoke test + (optional) web-UI embed — the release artifacts the `publish.ts` mirror uploads
- [ ] 2.5 Mirror `publish.ts` → npm `volt` wrapper (bin, postinstall, `optionalDependencies` per-platform)
- [ ] 2.6 postinstall = opencode's binary-link logic **+ one line: register the LSP** in `~/.config/opencode/`
- [ ] 2.7 Mirror the `install` curl script (Volt release URL, modifies PATH)
- [ ] 2.8 (later) brew formula / AUR PKGBUILD — mirror `publish.ts`, pointed at Volt's repo

### Desktop (mirror opencode)
- [x] 2.9 Re-pointed the `electron-updater` feed (beta + prod) → `he-man86/volt` (no longer anomalyco/opencode)
- [ ] 2.10 Bundle + register the LSP for the embedded opencode (startup); point `volt-control`'s `setBundledCli` at the bundled `volt`

### Updates (mirror opencode)
- [ ] 2.11 `volt upgrade` — reuse opencode's method-aware `installation/` logic, pointed at Volt's releases

### Shared
- [x] 2.12 Removed the `volt setup` CLI verb; `setup()` stays as the reusable registration function the postinstall (CLI) / startup (desktop) call
- [ ] 2.13 Bridge connector — build C# bridges + install into the IDE (Beckhoff exe / CODESYS scripting dir)
- [ ] 2.14 Volt branding — `home_logo` TUI plugin + replace `opencode.ai` constants + Volt Sentry DSN
- [ ] 2.15 Code-signing (Windows certs) · signed release
