## Why

The vendored console (`packages/console/*`) still wears opencode's brand: opencode colors, the mono-only
"terminal" type system, opencode logos, and opencode's marketing pages (`index`, `go`, `download`, `enterprise`,
`bench`, `brand`, `changelog`). `commercial-cloud-backend` deliberately shipped it un-rebranded ("Stage 5 rebrand
— deferred, own change") to get the funnel live. This is that change.

We now have a finished **Volt Design System** (Claude Design project `7046914d-…`, "Volt Design System"): tokens
(`colors.css`/`fonts.css`/`typography.css`/`spacing.css`), core components (Button/Badge/Card/Input), a full
marketing `ui_kits/website/*` (Hero, Features, Pricing, FAQ, Changelog, Contact, SignIn), brand guidelines, and
`volt-mark.svg`/`volt-logo.svg`. The brief: calm, mature, technical — *"Cursor for industrial automation
engineers."*

The constraint that shapes everything: `packages/console/*` is **vendored opencode**, guarded by
`check-console-divergence.ts` (fails CI if any source file diverges outside the `ALLOW` list) so we can keep
pulling opencode's bugfixes. So we cannot fork the console to rebrand it. Two facts make a clean split possible:

1. The console already isolates all brand-able values into a **CSS custom-property token layer**
   (`app/src/style/token/color.css` + `font.css`), applied globally in `base.css`. Every route reads
   `var(--color-bg)` / `var(--color-accent)` / `var(--font-sans)`. **Reskinning the entire authenticated app is a
   values-only edit to those two files** — no route touched.
2. The design's marketing site is a **separate surface** from the authenticated app. Volt's landing pages can live
   outside the vendored tree entirely (DIVERGENCE.md already names "Volt's own frontend" as the home for branding),
   so opencode's marketing routes are neutralized, not forked-and-edited.

## What Changes

Two phases, sequenced — Phase 1 is shippable on its own.

**Phase 1 — Console reskin (the first step).** Reskin the authenticated console to Volt's brand by rewriting the
**values** of the existing tokens (keeping opencode's variable *names* so every `var(--…)` reference still
resolves) + swapping brand image assets and favicons. Diff footprint: ~2 marked source files, added to the
divergence allowlist. No new infra. Ships a Volt-branded console immediately.

**Phase 2 — Volt landing site.** Stand up Volt's marketing pages from the design's `ui_kits/website/*` as a
**separate, static `packages/volt-www`** (the design ships plain HTML/CSS, so no SST/SolidStart SSR is needed) —
which also means it **builds and runs on Windows**, so landing pages are iterable without a deploy. The opencode
public surface is then **deleted** from the console (marketing routes + dead opencode-infra proxies), leaving the
vendored tree as just the app + gateway + API. See `design.md` Decision 3 for the route map and why static-`volt-www`
beat a gate-excluded route group.

Out of scope: the product/pricing copy itself (already config-driven — Go, €24), auth/billing flows (unchanged —
the landing links into the existing console auth), and any change to opencode's dormant Zen/Black routes.

## Impact

- **`packages/console`** — Phase 1: values-only edits to `app/src/style/token/{color,font}.css`; brand image +
  favicon swaps. Phase 2: delete opencode's marketing routes + dead proxies, point `/` at the app.
- **`volt-scripts/check-console-divergence.ts`** — extend `ALLOW` (+ `DIVERGENCE.md`) for the branded token files
  (Phase 1) and the route deletions (Phase 2).
- **New `packages/volt-www` (Phase 2)** — a static Volt-owned landing site sourced from the Volt Design System via
  `/design-sync`, with its own static deploy target (Cloudflare Pages/R2). Its CTAs cross-link to the console
  (`/auth`) and the Volt installer (GitHub Releases).
- **Release pipeline (Phase 2)** — `.github/workflows/release.yml` automates the Velopack desktop release (so the
  landing's Download always points at a complete, verified release); `volt-scripts/build-app.ts` gains CI token
  auth. See `design.md` Decision 5.
- **`commercial-cloud-backend`** — this change fulfills its deferred "Stage 5 rebrand."
- **No change** to product/pricing config, auth, billing, or the LLM gateway.
