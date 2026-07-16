# Tasks — volt-branding

Fulfills `commercial-cloud-backend`'s deferred "Stage 5 rebrand." Source of truth = the Volt Design System project
(`7046914d-…`); brand rules in `design.md`. Phase 1 ships on its own.

## Phase 1 — Console reskin (values-only, shippable)

### Theme (additive override — zero edits to opencode source; Decision 2)
- [x] `packages/console/app/src/style/volt-theme.css` (new, Volt-owned) — re-declares base color + font tokens with
      Volt values (light + dark) + self-hosted `@fontsource` imports. Loaded from `app.tsx` after `./app.css` so it
      wins; opencode's derived tokens inherit.
- [x] `app.tsx` — one import line (`./style/volt-theme.css`). `app.tsx` was already divergent (de-fork), so no new
      opencode file is modified.
- [x] Added `@fontsource-variable/{inter,jetbrains-mono}` to `console/app` deps (no Google-Fonts CDN).
- [x] **Reverted** the earlier in-place edits — `token/color.css`, `token/font.css`, `component/header.tsx` are
      byte-identical to opencode again (they pull upstream bugfixes conflict-free).

### Brand assets
- [x] Grabbed `volt-logo.svg` + `volt-mark.svg` from the design → `app/public/` (Volt-owned, gate-excluded) for the
      favicon step below.
- [x] Favicons swapped to Volt art. `app/scripts/gen-favicon.ts` (zero-dep) rasterizes `volt-mark.svg` → the brand
      `apple-touch-icon.png` + `web-app-manifest-{192,512}.png`; `ui.tsx` links SVG + apple-touch, `entry-server.tsx`
      `og:image` → the 512 PNG. Deleted opencode's broken `social-share*.png` symlink-stubs (dead refs into the
      removed `ui`). (`theme.json` left as-is — it's an unreferenced theme JSON *schema*, not brand art.)
- [~] Marketing header keeps opencode's logo — intentionally NOT touched (Phase 2 replaces those routes with
      volt-www; branding a soon-deleted vendored file is churn).

### Divergence gate
- [x] `volt-scripts/check-console-divergence.ts` — allowlist only `app/src/style/volt-theme.css` (opencode source
      unchanged); `app.tsx`/`app/package.json` already listed.
- [x] `openspec/changes/commercial-cloud-backend/DIVERGENCE.md` — override approach documented.
- [x] `bun volt-scripts/check-console-divergence.ts` → exit 0.

### Verify
- [~] Local: gate green, font deps resolve (`@fontsource-variable/*` exports `.` → index.css, Vite-resolvable),
      token CSS valid. Full visual verify (workspace/billing/settings in Volt colors + Inter, light/dark) runs on
      the **Linux/CI build** — the SolidStart dev/preview server can't boot on Windows (`Invalid define value …
      app.tsx` path-mangling, the documented Linux-only constraint), so it's not verifiable on the Windows box.

## Phase 2 — Volt landing site

Landing home = **Option A: a static `packages/volt-www`** (resolved — `design.md` Decision 3). Route map (keep-set
vs. replace/drop) is the table in Decision 3.

### Scaffold volt-www (static)
- [x] New `packages/volt-www` — static Vite site (no SSR): `package.json`, `index.html` (branded placeholder hero +
      inline Volt wordmark), `styles.css` (Volt design tokens + self-hosted Inter/JetBrains via `@fontsource`),
      `public/volt-mark.svg`, `README.md`. Registered in root `workspaces`. `vite build` **verified on Windows**
      (fonts bundled, static `dist/`), so the landing iterates locally with no deploy.

### Import the design
- [x] Converted `volt-www` to **Vite + React** (the design pages are React-with-in-browser-Babel; ported to a real
      build). Design `.jsx` pulled **verbatim** into `src/design/` (they self-attach to `window` + read globals at
      render); `src/globals.js` + `src/main.jsx` orchestrate load order. Future `/design-sync` is a drop-in.
- [x] **Home page** wired end-to-end: Nav, Hero (+ interactive draggable HeroMockup), BuiltFor, Features,
      Architecture, CompilerIntelligence, EngineeringConfidence, Privacy, Surfaces, FinalCTA, Footer. Tokens
      (`src/tokens/*`) + self-hosted Inter/JetBrains. `vite build` verified on Windows; `dist` serves 200.
- [x] **Multi-page (Vite MPA)** — `src/shell.jsx` (imports globals + all design components, exposes `renderPage`);
      per-page entries `src/pages/*.jsx`; one `.html` per page (filenames match the design's nav links). Built +
      served: **home, pricing, faq, contact, legal/terms, legal/privacy** (each 200 + `#root`; shared `shell`
      chunk + tiny per-page chunks). Pulled `PageKit`, `PricingPage`, `FaqPage`, `ContactPage`, core `Input`/`Card`.
      `src/main.jsx` retired (→ `pages/home.jsx`).
- [x] Legal pages = Volt **placeholders** (clearly "being finalized", NOT fabricated terms). Console `legal.tsx`
      footer links to `…/legal/terms.html` once volt-www is deployed.
- [x] **8 `feature-*` deep-dives + changelog** — all built + serve 200 (15 pages total). One shared
      `pages/feature.jsx` entry drives all 8 (each HTML sets `window.__FEATURE` inline); pulled `FeaturePage`,
      `ChangelogPage`, core `Badge`. Feature "Start Free" → console `/auth`. (Sign-in is NOT a page — CTAs go to
      `/auth`.)
- [x] Contact form wired to a real submit — `ContactPage.jsx` builds a subject/body and opens the visitor's mail
      client via `mailto:sales@volt-ai.dev` (no backend needed for a static site); all channels use `@volt-ai.dev`.
      Add a real endpoint/CRM only when volume needs an inbox.
- [x] **Auth wired**: "Sign in" + "Start Free" (Nav, Pricing, FinalCTA) → console `/auth` (OpenAuth handles
      sign-in *and* sign-up). Cross-site via `src/config.js` `CONSOLE_URL` (env `VITE_CONSOLE_URL`, defaults to
      **prod** `volt-ai.dev` so a forgotten env is safe; dev opts in). No auth re-implemented.
- [x] **Download wired to the real Volt installer**: Nav "Download" + Hero "Download for free" →
      `github.com/he-man86/volt/releases/latest/download/Volt-win-Setup.exe` — the Velopack one-installer that
      `volt-scripts/build-app.ts` publishes via `vpk upload github`. Windows-only (Volt's tooling is
      Windows-native); env-overridable (`VITE_INSTALLER_URL`). Dropped the opencode-serving console resolver.
      "View Demo" → `#demo` (the hero mockup).
### Release pipeline (so Download always points at a complete release — Decision 5)
- [x] `.github/workflows/release.yml` — tag-triggered (`v*`) + manual dispatch; `windows-latest`; installs
      bun/dotnet/`vpk`; runs `build-app.ts --upload`; **guards** tag == `v`+desktop version and **verifies**
      `Volt-win-Setup.exe` landed on the release (fails loudly otherwise — the exact v0.2.1 failure).
- [x] `volt-scripts/build-app.ts` — `vpk upload` now passes `--token` from `GH_TOKEN`/`GITHUB_TOKEN` so CI auth
      works without an ambient `gh` login (local runs unchanged).
- [ ] **Re-cut `v0.2.1` (or `v0.2.2`) through the pipeline** so `latest/download/Volt-win-Setup.exe` resolves —
      NOT a manual asset upload (the first automated run also proves the pipeline). Root cause: manual release
      dropped the installer; `v0.2.0` still has it.
- [~] **Code signing — PARKED** (not needed): installer ships unsigned; Windows SmartScreen warns on first run.
      Revisit with Azure Trusted Signing (opencode's approach) only if/when it matters.
- [ ] First CI run will shake out `windows-latest` specifics (winCodeSign/Developer-Mode symlink extraction, `vpk`
      token behavior, .NET Framework 4.8 vs net8 for the connector build).

### Strip opencode's public surface from the console (HYBRID — touch opencode as little as possible)
- [x] **Deleted only the active proxy/redirect routes** that serve/redirect to opencode's own infra: `docs/`,
      `data/`, `stats/`, `s/`, `t/`, `desktop-feedback`, `discord`, `feishu` (+ opencode's `index.*` landing).
- [x] **Kept opencode's marketing PAGES byte-identical + dormant** (`go/`, `download/`, `enterprise/`, `bench/`,
      `brand/`, `changelog/`, `black.*`+`black/`, `legal/`, `zen/index.*`): they only render, they're unlinked and
      off the public face (volt-www owns it), so they pull opencode bugfixes conflict-free and fall off the gate.
      Kept functional set: `workspace*`, `auth/`, gateway `zen/{go,util,v1}`, `api/`, `stripe/`, `honeycomb/`,
      `openapi/changelog.json`. **typecheck green** (no broken imports).
- [x] `routes/index.ts` (new) — `/` → `redirect("/auth")` (console home is the app, not opencode's landing).
- [x] **Legal footer removed from the authed shell** — `workspace/[id].tsx` no longer renders opencode's `<Legal>`
      ("© Anomaly" + opencode ToS/Privacy). Volt's legal lives on volt-www, not the account console, so
      `component/legal.tsx` is left **pristine + off the gate** (not edited). `config.ts` (opencode.ai/anomalyco)
      imported by no kept route → dormant, left pristine.
- [x] Divergence gate: `DROPPED` prefix list for the deleted proxies so they don't balloon `ALLOW`; `DIVERGENCE.md`
      updated to the hybrid. Gate green (**22 intended, 0 unexpected** — down from 34; marketing pages left the diff).
- [ ] **Legal follow-up — Volt's own ToS/Privacy on volt-www.** The volt-www legal pages are placeholders; author
      Volt's real ToS/Privacy (Volt/counsel) to replace them. The console no longer shows a legal footer at all
      (removed), so there's nothing to wire back — legal is purely a volt-www concern now.
### Deploy + domain split (infra)
- [x] **`infra/www.ts`** (new) — `sst.cloudflare.StaticSite` for `volt-www`: `build: bun run build → dist`, served
      at the **apex** `domain` with `www.${domain}` → apex redirect; bakes `VITE_CONSOLE_URL=https://app.${domain}`
      at build. Registered in `sst.config.ts` (same SST app, one deploy).
- [x] **Console → `app.${domain}`** — `infra/stage.ts` `consoleDomain`; `infra/console.ts` SolidStart `domain` +
      the Stripe webhook URL now use it. Auth issuer stays `auth.${domain}`.
- [x] **Consumers repointed** — `volt-config/opencode.json` gateway `baseURL` → `app.volt-ai.dev/zen/go/v1`;
      volt-www default `CONSOLE_URL` → `app.volt-ai.dev`; `deploy.yml` path filter += `packages/volt-www/**`.
- [ ] **External provisioning (must land WITH this deploy — the console URL changes):**
  - DNS/CF: `app.${domain}` + `www.${domain}` (SST/CF creates the records; the zone must permit).
  - **OAuth redirect URIs** — add `https://app.${domain}/auth/…` callbacks to the Google + GitHub OAuth apps, and
    the OpenAuth issuer's allowed redirects. (Login breaks until done.)
  - **Stripe webhook** — SST recreates the endpoint at `app.${domain}/stripe/webhook`; update the signing secret if
    it rotates.
  - **Installed agents** pointing at the old gateway (`volt-ai.dev/zen`) pick up `app.volt-ai.dev/zen` on the next
    `volt-config` update / reinstall.
- [ ] **Deploy + verify from CI/Linux** (`sst deploy`; the SolidStart build is Linux-only). Can't be run/tested on
      the Windows box — the StaticSite `bun run build` + the console build both happen in the deploy job.

### Verify (post-deploy)
- [ ] Apex serves volt-www (all 15 pages, light/dark); `www.` redirects to apex; opencode branding gone from every
      public surface.
- [ ] `app.${domain}` serves the console; login (OAuth) works; `Sign in`/`Start free` from volt-www reach it; the
      agent gateway (`app.${domain}/zen/go/v1`) still authenticates.
