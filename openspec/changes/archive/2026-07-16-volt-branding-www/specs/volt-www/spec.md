## ADDED Requirements

### Requirement: Cursor design reference is committed

The system SHALL keep a committed skillui-extracted reference of cursor.com's design system under
`packages/volt-www/design-ref/` (tokens, layout/component maps, motion specs, screenshots). It is a design
reference only and MUST NOT be imported by the shipped build.

#### Scenario: Reference present and inert
- **WHEN** the site is built with `vite build`
- **THEN** no file under `design-ref/` is imported into the bundle, and the build succeeds without it

### Requirement: Cursor-derived visual design

The rendered site SHALL follow Cursor's landing-page design language: a light/minimal theme, the `#f54e00`-family
accent, warm off-white surfaces, near-black (`#262626`) text, a 4px-baseline spacing scale, and expressive motion
(spring/staggered reveals). It MUST NOT ship Cursor's proprietary fonts, logos, or brand assets — licensable
equivalents are used instead, self-hosted (no CDN font requests).

#### Scenario: Tokens match the reference palette
- **WHEN** the design tokens in `src/tokens/*` are inspected
- **THEN** the accent, surface, text, and border values match the skillui reference within the documented mapping

#### Scenario: No proprietary or CDN assets
- **WHEN** the built `dist/` is inspected
- **THEN** it contains no Cursor logo/wordmark or CursorGothic/Berkeley-Mono font files, and makes no external
  font/CDN network request

### Requirement: Volt brand and content throughout

Every page SHALL present Volt's identity — Volt name, logo/mark, product copy, and PLC-engineering mockups — not
Cursor's. No Cursor copy, product name, or screenshots appear in the shipped site.

#### Scenario: Brand check
- **WHEN** any shipped page is rendered
- **THEN** the visible brand is Volt (name, mark, copy) and the string "Cursor" does not appear in user-facing text

### Requirement: Page set

The site SHALL provide, at minimum: a home/landing page (hero, feature sections, social proof, footer), a pricing
page, an FAQ page, a changelog page, a contact page, per-feature detail pages, and legal (privacy/terms) pages.

#### Scenario: Routes resolve
- **WHEN** the built site is served
- **THEN** each listed page loads and renders its Cursor-styled layout with Volt content

### Requirement: Cross-links to console and installer

CTAs SHALL link out via `src/config.js` (the site implements no auth/billing itself): sign-in/sign-up to the
console auth URL, and "Download" to the Volt Windows installer on GitHub Releases. Console host and installer URL
MUST remain overridable by the existing `VITE_CONSOLE_URL` / `VITE_INSTALLER_URL` env vars.

#### Scenario: CTA targets
- **WHEN** the primary CTAs are activated
- **THEN** sign-in resolves to `<console>/auth` and Download resolves to the installer release asset, both honoring
  their env-var overrides

### Requirement: Static Windows build and deploy

The site SHALL build and preview as a static Vite bundle on Windows with no SSR/server, deployable as static assets.

#### Scenario: Windows build
- **WHEN** `bun run build` runs in `packages/volt-www` on Windows
- **THEN** it produces a static `dist/` that `bun run preview` serves without a backend
