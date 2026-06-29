## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution

One build command → every binary: `bun volt-scripts/dist.ts` → `dist/volt/` (`bin/volt`, `bin/volt-lsp-codesys`, `bridge/`).

- [x] 2.0 Release build script (`volt-scripts/dist.ts`) — compiles `volt` + `volt-lsp-codesys`, builds the bridges, into `dist/volt/`
- [x] 2.1 `volt` is one entry point — bare `volt` opens the agent, `volt <verb>` runs the PLC CLI (dispatcher in volt-git `bin.ts`)
- [ ] 2.2 Installer bundles `dist/volt/` via electron-builder `extraResources`
- [ ] 2.3 Installer puts `volt[.exe]` on PATH (NSIS) — so `volt pull`/`volt push` work from any project
- [ ] 2.4 App/installer registers the LSP in the global opencode config (points at the bundled `volt-lsp-codesys`); **removes** the `volt setup` CLI verb — registration is the installer's job, not a CLI command (the cause of the duplicate-`volt`-tool collision)
- [ ] 2.5 Bridge connector — build the C# bridges (`build:all`) + install into the IDE (Beckhoff standalone exe / CODESYS scripting dir)
- [ ] 2.6 Replace remaining `opencode.ai` constants + wire the Volt Sentry DSN
- [ ] 2.7 Code-signing (Windows certs)
- [ ] 2.8 Updater feed
- [ ] 2.9 Signed release
