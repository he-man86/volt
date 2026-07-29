# volt-www

Volt's public marketing/landing site. **Static Vite + React build** — no SSR, no server — so it builds and runs on
Windows and deploys as static assets to Cloudflare.

It is the **only** thing Volt deploys, and it serves the apex. There is no console and no backend — payment,
EU VAT, licence keys and the customer portal are Polar's. See `openspec/changes/sell-cli-subscription`.

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

## CTAs
This site implements no auth or billing of its own — it links out. Targets live in `src/config.js`:
- **Buy** → Polar checkout. Polar issues the licence key and hosts the customer portal (billing, invoices,
  devices, cancellation).
- `downloadUrl()` → the **Volt installer**: `he-man86/volt` GitHub Releases `latest/download/Volt-win-Setup.exe`
  (built by `volt-scripts/build-installer.ts`). Windows-only. Override with `VITE_INSTALLER_URL`.

> ⚠️ **This site is NOT ready to put in front of customers.** Its copy still sells the deleted gateway:
> `src/content.js` advertises Pro at €24 with "Hosted AI, no key required" and a sign-up CTA (`kind: "auth"`)
> whose target no longer exists, and `src/config.js` still resolves `authUrl()` / `dashboardUrl()` against a
> console that is gone. The FAQ, `getting-started.mdx` and all three legal pages describe a hosted gateway,
> user accounts and Stripe. Task §4b of `openspec/changes/sell-cli-subscription` lists every location — and
> the legal pages are contracts.

```bash
bun run build   # production — no env vars needed; SST deploys dist/ to the apex
```
