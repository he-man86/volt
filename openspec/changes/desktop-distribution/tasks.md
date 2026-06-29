## 1. Branding (done)

- [x] 1.1 Volt logo (`packages/ui/logo.tsx`)
- [x] 1.2 App name (`packages/desktop`)

## 2. Distribution

- [ ] 2.1 Replace remaining `opencode.ai` constants + wire the Volt Sentry DSN
- [ ] 2.2 Code-signing (Windows certs)
- [ ] 2.3 Updater feed
- [ ] 2.4 Signed release
- [ ] 2.5 Bundle the volt LSP + CLI beside the app (compiled `volt-lsp-codesys` binary for no-node customers); spawn `volt init`/`volt setup` with `VOLT_LSP_BIN`/`VOLT_BIN` pointed at them, so a fresh install gets PLC intelligence. (Registration mechanism done in `wire-lsp-for-agent`; this is the packaging side.)
