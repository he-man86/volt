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

## Structure

Plain Vite + React (ES modules — no `window`-globals indirection). Multi-page: one `*.html` per route (see
`vite.config.js`) → `src/pages/<page>.jsx`, each calling `renderPage(<body/>)` from `src/shell.jsx` (which wraps the
body in `<Nav>` + `<Footer>`).

- **`src/tokens/*`** — design tokens (Cursor-derived palette/scale; warm off-white + `#f54e00`). Reference lives in
  `design-ref/` (a committed skillui extraction of cursor.com; **not imported** by the build).
- **`src/content.js`** — all marketing copy in one place (nav, features, pricing, FAQ, testimonials, footer).
- **`src/components/*`** — `Nav`, `Footer`, `Hero`, `Features`, `FeatureShowcase` (alternating copy ↔ mockup band,
  optional Turner backdrop), `SocialProof`, `ui` (buttons/logo), `LegalPage`, `FeatureDetail`.
- **`src/components/mockups/*`** — interactive product mockups reused across hero + feature sections:
  `DesktopApp` (opencode chat + IDE panel + explorer), `Codesys`, `VSCode` (explorer / source-control / Volt views),
  `Bridge` (tray connector), and `Draggable` (grab-to-move + click-to-front window wrapper).
- **`src/reveal.jsx`** — `Reveal` scroll-in + `useInView` (drives the mockups' staged animations).

## Auth & download (cross-links to the console)
The CTAs link out; this site implements no auth/billing of its own. Targets live in `src/config.js`:
- `authUrl()` → `<console>/auth` (OpenAuth, sign-in *and* sign-up). Console host = `VITE_CONSOLE_URL` (default
  `https://dev.volt-ai.dev`).
- `downloadUrl()` → the **Volt installer**: `he-man86/volt` GitHub Releases `latest/download/Volt-win-Setup.exe`
  (built by `volt-scripts/build-app.ts`). Windows-only. Override with `VITE_INSTALLER_URL`.

```bash
VITE_CONSOLE_URL=https://volt-ai.dev bun run build   # production
```
