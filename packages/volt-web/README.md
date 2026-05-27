# @opencode-ai/volt-web

Marketing site for Volt — the AI coding agent for PLC Structured Text.

Astro 5 + Solid.js + Cloudflare. Separate from `packages/web` (which stays vanilla, pulled from upstream opencode) so upstream syncs are conflict-free.

## Dev

```bash
bun run --cwd packages/volt-web dev
```

## Build

```bash
bun run --cwd packages/volt-web build
```

Deploys via Cloudflare adapter. Output in `dist/`.

## Structure

```
src/
├── layouts/Layout.astro    base HTML shell + global styles
├── pages/
│   └── index.astro          landing page (hero + features + CTA)
├── styles/global.css        design tokens + typography
└── components/              future Solid.js islands
```

## Adding a page

Drop a new `.astro` file in `src/pages/` — file-based routing. For interactive components use `client:load` or `client:visible` directives.
