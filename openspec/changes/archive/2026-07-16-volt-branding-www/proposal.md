## Why

`packages/volt-www` currently holds thin placeholder pages carried over from the deferred first branding attempt
(now archived as `2026-07-16-volt-branding`). Volt has no real public face. We want a marketing site that reads
like a mature developer tool — the brief is *"Cursor for industrial automation engineers"* — so the fastest way to a
credible result is to adopt Cursor's proven landing-page design (layout, palette, type scale, motion) and dress it in
Volt's own name, logo, copy, and product mockups.

## What Changes

- **Extract cursor.com's design system** with the `skillui` CLI into a committed reference skill
  (`packages/volt-www/design-ref/`): design tokens (colors, spacing, type), component/layout maps, and motion specs.
  This is a *reference*, not shipped code.
- **Rebuild `packages/volt-www`** as a Cursor-styled static Vite site: adopt Cursor's light/minimal palette
  (`#f54e00` accent — near-identical to Volt's existing orange — warm off-white surfaces, near-black text), Cursor's
  section rhythm (large hero → dark demo strip → feature blocks → social proof → footer), and its expressive motion,
  with **Volt's name, logo, copy, and PLC-engineering mockups** throughout.
- **Retire the placeholder pages/components** left from the archived attempt — replace `src/design/*`, `src/pages/*`,
  and the root `*.html` stubs with the new Cursor-styled set. Keep `src/config.js` (auth/download cross-links) intact.
- **Use licensable font/asset equivalents**, not Cursor's proprietary CursorGothic / Berkeley Mono or its logos —
  matched to the same aesthetic (a clean grotesque sans + a mono), self-hosted via `@fontsource`.
- **No new infra.** Still a static Vite/React build that runs and deploys from Windows (Cloudflare Pages/R2),
  independent of the vendored console. Console reskin stays out of scope (separate change).

## Capabilities

### New Capabilities
- `volt-www`: the public Volt marketing site — its page set, Cursor-derived visual design, static build/deploy
  contract, and the cross-links out to the console (auth) and GitHub Releases (installer download).

### Modified Capabilities
<!-- none — volt-www is a fresh capability; the archived attempt shipped no spec. -->

## Impact

- **Code:** `packages/volt-www/**` (rebuilt), new `packages/volt-www/design-ref/` (committed skillui reference).
- **Dependencies:** `@fontsource` font packages for the chosen sans/mono; no new runtime infra.
- **Build/CI:** static build only; no change to the console divergence gate or the Linux console pipeline.
- **Out of scope:** the vendored `packages/console` reskin (tokens/favicons) — deferred to its own change.
