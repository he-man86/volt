# volt-www

Volt's public marketing/landing site. **Static Vite + React build** — no SSR, no server — so it builds and runs on
Windows and deploys as static assets (Cloudflare Pages/R2), independent of the console's Linux-only pipeline.

Why separate from `packages/console`: the console is vendored opencode (kept minimal, guarded by
`check-console-divergence.ts`). Volt owns its landing outright, so it lives here — not edited into vendored routes.
See `openspec/changes/volt-branding/` (Decision 3) for the full rationale and the console route map.

```bash
bun install
bun run --cwd packages/volt-www dev       # local dev server (hot reload) — works on Windows
bun run --cwd packages/volt-www build     # -> dist/ (static, deploy anywhere)
bun run --cwd packages/volt-www preview    # serve the built dist/
```

## Design system
`src/tokens/*` are the Volt Design System tokens (same warm-neutral + orange as the console theme, so landing and
app match). The home page's components live **verbatim** in `src/design/*.jsx` — authored the way the Claude Design
preview loads them (global scripts reading `window` helpers). `src/globals.js` sets the required globals (`React`,
the DS `Button`); `src/main.jsx` imports the design files in order and renders `<App>`. To re-sync from the design
project, drop updated `.jsx` into `src/design/` — no rewiring. Remaining pages (pricing, FAQ, feature-\*, …) are the
next import.

## Auth & download (cross-links to the console)
The CTAs link out; this site implements no auth/billing of its own. Targets live in `src/config.js` (exposed as
`window.VOLT`):
- `authUrl()` → `<console>/auth` (OpenAuth, sign-in *and* sign-up). Console host = `VITE_CONSOLE_URL` (default
  `https://dev.volt-ai.dev`).
- `downloadUrl()` → the **Volt installer**: `he-man86/volt` GitHub Releases `latest/download/Volt-win-Setup.exe`
  (the Velopack build from `volt-scripts/build-app.ts`). Windows-only. Override with `VITE_INSTALLER_URL`.

```bash
VITE_CONSOLE_URL=https://volt-ai.dev bun run build   # production
```
