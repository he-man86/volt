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

- **`src/tokens/*`** — design tokens (Cursor-derived palette/scale; warm off-white + `#f54e00`): colors,
  typography, spacing. Everything else reads these — no raw hex outside `tokens/` and the mockups.
- **`src/styles.css`** — base only: font/token imports, reset, and the shared primitives every page uses
  (`.container`, `.section`, type utilities, `.btn`, `.card`, the scroll-reveal rules). Imported first by
  `shell.jsx` so component styles layer on top.
- **`src/content.js`** — all marketing copy in one place (nav, features, pricing, FAQ, testimonials, footer).
- **`src/components/*`** — `Nav`, `Footer`, `Hero`, `Features`, `Platforms`, `FeatureShowcase` (alternating copy ↔
  mockup band, optional Turner backdrop, optional `link` to a docs article), `DocsLayout`, `ui` (buttons/logo),
  `LegalPage`, `FeatureDetail`. **Each component owns its CSS beside it** (`Nav.jsx` + `nav.css`, `DocsLayout.jsx` +
  `docs.css`, …), the same convention the mockups already used — add a component, add its stylesheet, import it there.
- **`src/components/mockups/*`** — interactive product mockups reused across hero, feature sections and docs:
  `DesktopApp` (opencode chat + IDE panel + explorer), `Codesys`, `VSCode` (explorer / source-control / Volt views),
  `Connector` (tray), and `Draggable` (grab-to-move + click-to-front window wrapper).
- **`src/reveal.jsx`** — `Reveal` scroll-in + `useInView` (drives the mockups' staged animations).

## Docs pages

Docs are **MDX** (`@mdx-js/rollup` + `remark-gfm` + `rehype-slug` — no docs framework, no second site): prose in
`src/docs/*.mdx` that imports the real mockup components and renders them inline, wrapped by `DocsLayout` (sticky
section nav built from the rendered `h2[id]`s, so a new `##` needs no config). Today: `getting-started.mdx`
(`/docs.html`) and `desktop-vs-vscode.mdx` (`/docs-desktop-vs-vscode.html`, linked from the two home showcases).

Adding one: write `src/docs/<name>.mdx` → `src/pages/docs-<name>.jsx` (3 lines, copy an existing one) →
`docs-<name>.html` → add the entry to `vite.config.js`.

## Auth & download (cross-links to the console)
The CTAs link out; this site implements no auth/billing of its own. Targets live in `src/config.js`:
- `authUrl()` → `<console>/auth` (OpenAuth, sign-in *and* sign-up). Console host = `VITE_CONSOLE_URL` (default
  `https://dev.volt-ai.dev`).
- `downloadUrl()` → the **Volt installer**: `he-man86/volt` GitHub Releases `latest/download/Volt-win-Setup.exe`
  (built by `volt-scripts/build-installer.ts`). Windows-only. Override with `VITE_INSTALLER_URL`.

```bash
VITE_CONSOLE_URL=https://volt-ai.dev bun run build   # production
```
