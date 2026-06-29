## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution

- [ ] 2.1 Replace remaining `opencode.ai` constants + wire the Volt Sentry DSN
- [ ] 2.2 Code-signing (Windows certs)
- [ ] 2.3 Updater feed
- [ ] 2.4 Signed release
- [ ] 2.5 Bundle the compiled `volt-lsp-codesys` binary (no-node) + the volt CLI beside the app; on **startup/install** call `volt setup` with `VOLT_LSP_BIN`/`VOLT_BIN` pointed at the bundled paths — the one-time global LSP+tool registration (verified to deliver diagnostics to the agent via raw tool output). `volt init` stays project-only. (Primitive = `volt setup`; this is the packaging + invocation side.)
