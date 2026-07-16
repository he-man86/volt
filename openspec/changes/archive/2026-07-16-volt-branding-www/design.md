## Context

`packages/volt-www` is a static Vite/React site (no SSR — runs and deploys from Windows, independent of the vendored
Linux console). It currently holds placeholder pages/components from the archived first branding attempt
(`2026-07-16-volt-branding`). We are rebuilding it to look like cursor.com — the brief is *"Cursor for industrial
automation engineers"* — with Volt's own brand and content.

Ground truth for the look is a `skillui` extraction of cursor.com (run `--mode ultra`; Playwright was unavailable so
it fell back to static extraction + one homepage screenshot). Extracted signals we trust: accent `#f54e00`, warm
off-white surfaces (`#f7f7f4` / card ladder `#f2f1ed → #e1e0db`), text `#262626` / muted `#737373`, low-alpha warm
borders (`#26251e` at 6–33% α), a 4px baseline grid, and expressive motion (28 keyframes; spring/staggered reveals).
The homepage screenshot shows the real composition: black wordmark + centered nav + `Sign in`/`Contact sales` (pill
outline)/`Download` (black pill); a big near-black grotesque hero headline with a black pill + gray pill CTA pair; and
a large layered app mockup (task list + browser preview + CLI overlay) floating over a soft painterly backdrop, with
serif accents *inside* the product.

## Goals / Non-Goals

**Goals:**
- Reproduce Cursor's landing aesthetic: warm-light palette, grotesque display type, black pill CTAs, layered
  product-mockup hero over a soft backdrop, expressive scroll motion.
- Ship it as Volt: Volt name/mark, PLC-engineering copy and mockups, Volt's page set — zero Cursor brand or copy.
- Keep the existing static-Windows build and the `src/config.js` cross-links (console auth + installer download).
- Commit the skillui reference so the design is reproducible and future edits have a source of truth.

**Non-Goals:**
- Reskinning the vendored `packages/console` (its own change).
- Shipping Cursor's proprietary fonts (CursorGothic, Berkeley Mono), logos, or any Cursor asset.
- A dark-mode toggle (Cursor's marketing home is light-only; dark strips are per-section, not a global theme).
- Any auth/billing in the site itself — CTAs link out.

## Decisions

**1. Reference lives in-tree, inert.** Commit the skillui package to `packages/volt-www/design-ref/` (DESIGN.md,
tokens, motion specs, screenshot). It is documentation only — nothing under `design-ref/` is imported by the build,
and Vite must build with the folder absent. Drop KaTeX/EB-Garamond/Lato noise the extractor picked up; keep the
palette, spacing, motion, and the homepage screenshot as the visual target.

**2. Tokens = Cursor values, Volt-owned files.** Rewrite `src/tokens/colors.css` to Cursor's palette
(`--accent: #f54e00`, surface ladder, `#262626`/`#737373` text, warm low-α borders) and `spacing`/`typography` to the
4px grid and Cursor's type scale (H1 `clamp(3rem,7vw,5rem)/700`, tight sans; serif for in-mockup prose). This *adopts*
Cursor's look per the chosen "Cursor look, Volt content" direction — note the accent is already within a hair of
Volt's prior orange (`#D97706`).

**3. Fonts = licensable equivalents, self-hosted.** CursorGothic → **Inter** (already a repo dep; closest free
neo-grotesque); Berkeley Mono → **JetBrains Mono** (already a dep); the in-mockup serif → **EB Garamond** via
`@fontsource` (open-licensed) to get Cursor's editorial serif accent without shipping their files. All self-hosted —
no Google-Fonts/CDN request (spec-required). `ponytail:` reuse the two fonts already installed; only EB Garamond is
new.

**4. Rebuild the component/page set, keep the shell contract.** Replace `src/design/*` and `src/pages/*` with a
Cursor-styled set: `Nav` (wordmark + centered links + Sign-in/Contact/Download pills), `Hero` (headline + CTA pair +
layered `ProductMockup` over a soft backdrop), `Features`, `SocialProof`, `Pricing`, `Faq`, `Changelog`, `Contact`,
`FeatureDetail`, `Footer`, plus legal. Keep `src/config.js`/`window.VOLT` and the `authUrl()`/`downloadUrl()` wiring
as-is — only the CTA chrome changes. Download CTA label is Windows ("Download for Windows"), not macOS.

**5. Motion via one small primitive, not a library.** Cursor's reveals are staggered fade/rise on scroll. Implement
with a tiny `IntersectionObserver` reveal hook + CSS transitions (`prefers-reduced-motion` respected). `ponytail:`
IntersectionObserver + CSS covers it; add a spring lib (Framer Motion) only if a specific interaction demands physics.

**6. Product mockups are Volt, drawn in HTML/CSS.** Cursor's hero is a faux-app window; ours mirrors the layout but
shows Volt's world — a PLC project tree, an ST/VG diff, a `volt` CLI window (`volt pull` / `volt status`) — as styled
divs, not screenshots, so they stay crisp and themeable. The soft painterly backdrop becomes a muted Volt gradient/
texture (owned asset), not Cursor's image.

## Risks / Trade-offs

- **Brand-similarity to a competitor.** "Looks like Cursor" is deliberate, but we stop at layout/palette/motion —
  no Cursor logo, wordmark, font files, copy, or screenshots ship (enforced by the spec's brand + no-proprietary-asset
  scenarios). This keeps it inspiration, not a knockoff.
- **skillui fidelity is partial.** Ultra mode failed (no Playwright), so we have one screenshot and static tokens, not
  the scroll-journey frames or full motion capture. Mitigation: the committed screenshot + DESIGN.md are the target;
  re-run `skillui --mode ultra` later if we want frame-accurate motion.
- **Font substitution drift.** Inter isn't CursorGothic; the headline will read slightly different. Acceptable — it's
  a licensable match, and the layout/weight/scale carry most of the resemblance.
- **Hand-built mockups are more work than a screenshot** but avoid shipping a competitor's UI and stay responsive/
  theme-consistent — worth it for the hero and CLI, the only two that matter.
