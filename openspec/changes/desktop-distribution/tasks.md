## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution

See `design.md`. One build command → every binary: `bun volt-scripts/dist.ts` → `dist/volt/`. CLI and desktop
are **independent installs that coexist** (mirrors opencode), sharing one idempotent `~/.config/opencode/`.

### Build (done)
- [x] 2.1 Release build script (`volt-scripts/dist.ts`) — `volt` + `volt-lsp-codesys` + bridges → `dist/volt/`
- [x] 2.2 `volt` is one entry point — bare → agent, `volt <verb>` → PLC CLI (dispatcher in volt-git `bin.ts`)

### Desktop install (electron)
- [ ] 2.3 Bundle `dist/volt/` via electron-builder `extraResources`
- [ ] 2.4 App registers LSP + tool in the shared global config on startup (idempotent); point `volt-control`'s `setBundledCli` at the bundled `volt` binary — collapses the `volt.js` node bundle onto the one compiled exe

### CLI install (mirror opencode — independent of the desktop)
- [ ] 2.5 npm `volt` wrapper + per-platform binaries (`optionalDependencies`, per opencode `publish.ts`)
- [ ] 2.6 curl install script that modifies PATH — mirror opencode's `install`
- [ ] 2.7 Decide the opencode dependency for CLI-only: (a) opencode as a peer install vs (b) `volt` = Volt-branded opencode with PLC verbs built in (one binary, no delegation)

### Shared
- [ ] 2.8 Remove the `volt setup` CLI verb — keep `setup()` as the function both installers call (registration is install-time, not a CLI command; was the cause of the duplicate-`volt`-tool collision)
- [ ] 2.9 Bridge connector — build C# bridges + install into the IDE (Beckhoff exe / CODESYS scripting dir)
- [ ] 2.10 Replace remaining `opencode.ai` constants + wire the Volt Sentry DSN
- [ ] 2.11 Code-signing (Windows certs) · Updater feed · Signed release
