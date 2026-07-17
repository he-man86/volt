# Vendored-console divergence audit (vs opencode `v1.18.3`)

**Policy (standing rule).** `packages/console/*` is vendored opencode source, pinned at **`v1.18.3`**, kept as close
to upstream as possible so we can pull opencode's bugfixes with minimal friction. Volt's customization lives in
layers opencode doesn't own:

| Layer | Owner | Customize here? |
|---|---|---|
| **config / infra** | Volt | ✅ yes — `infra/*`, `models.json`, `ZEN_LIMITS`, Stripe prices, `deploy.yml`, `volt-config/*` |
| **opencode source** (`packages/console/*`) | opencode | ❌ minimize — only unavoidable de-fork glue + tiny, marked use-case edits |
| **Volt's own frontend** (future) | Volt | ✅ yes — the real home for branding / product presentation |

Product decisions (Go-only, €24, 50% margin, which models) are **config**, never edits to opencode routes.
Every source edit is tagged with a `VOLT:` comment so it's obvious on merge.

## Audit (2026-07-17, diffed against the v1.18.3 tarball, CRLF-normalized)

Only these differ in `packages/console/*` — everything else is byte-identical to opencode:

**De-fork necessities** (the `@opencode-ai/ui` + `opencode` packages were deleted in the de-fork):
- `app/package.json` — dropped the `@opencode-ai/ui` dep + the `../../opencode/script/schema.ts` build step (that
  package is gone); added `@fontsource-variable/{inter,jetbrains-mono}` for the self-hosted Volt brand type (below).
- `app/src/ui.tsx` (new) — the two things `console/app` used from `@opencode-ai/ui` (`createSimpleContext`, `Favicon`), inlined.
- `app/src/app.tsx` — the `@opencode-ai/ui` → `~/ui` import rewrite; the `import "./style/volt-theme.css"` brand
  override (after `./app.css`); and the authed-app `<Title>` `"opencode"` → `"Volt"` (browser tab). It also **omits
  two things v1.18.0 added** to the root layout: `<Font />` (imports `@opencode-ai/ui/font`, a package the de-fork
  deleted — Volt self-hosts its type via `volt-theme.css`) and `<DesktopPromo />` (an ad for opencode Desktop,
  rendered on **every** page — including our authed workspace). Both are deliberate omissions to re-check on each
  bump, not merge accidents.
- `app/src/context/i18n.tsx`, `app/src/context/language.tsx` — import-line rewrites (i18n.tsx also merges the
  `~/i18n/volt` overlay; see below).

**Branding reskin (volt-branding Phase 1) — an ADDITIVE override, zero edits to opencode source.** The console
consumes every brand-able value through a CSS custom-property token layer, so the whole authenticated app reskins
from **one Volt-owned file**:
- `app/src/style/volt-theme.css` (new, Volt-owned) — re-declares the base color + font tokens with Volt's values
  (light + dark), self-hosting Inter/JetBrains via `@fontsource` (no CDN). Loaded from `app.tsx` **after**
  `./app.css`, so it wins at equal `:root` specificity; opencode's derived tokens (`--color-primary`, `--color-surface`,
  the `*-text` vars) inherit automatically.
- **opencode's own `app/src/style/token/*.css` stay BYTE-IDENTICAL** to upstream — the reskin adds no edit to any
  opencode source file, so those tokens pull opencode's bugfixes with zero merge conflict. The only footprint is
  the one new Volt file + one `app.tsx` import line (already a divergent file) + the two `@fontsource` deps in
  `app/package.json` (already divergent).
- Trade-off: because the token files aren't in the divergence diff, an upstream token **rename** shows opencode's
  default for that var (a visible glitch) instead of tripping the gate — preferred over rewriting vendored files
  (renames are rare, the break is obvious). See `volt-branding/design.md` Decision 2.
- The (marketing-only) header keeps opencode's logo for now — it is **not** touched. Phase 2 replaces the marketing
  routes with `volt-www` wholesale, so branding that header would be churn on a soon-deleted vendored file.

**Branding neutralization / favicons:**
- Removed opencode's broken `app/public/social-share*.png` (they were dangling git-symlink stubs into the deleted
  `@opencode-ai/ui` — served text, not images).
- **Volt favicons rasterized from the mark** — `app/scripts/gen-favicon.ts` (Volt-added, zero-dep) scanline-fills
  `public/volt-mark.svg` (a straight-line polygon) onto the brand background and writes `apple-touch-icon.png` +
  `web-app-manifest-{192,512}.png`. `ui.tsx` `Favicon` links the SVG (modern) + apple-touch PNG (Safari/iOS);
  `entry-server.tsx` points `og:image`/`twitter:image` at the 512 PNG (was the deleted opencode `social-share.png`).
  `public/*` is gate-excluded (branding); `app/scripts` + `entry-server.tsx` are ALLOW-listed.

**Public-surface strip (volt-branding Phase 2 → completed by console-volt-frontend Stage 2)** — the console is
**app-only**; the public site is `volt-www` (separate, Volt-owned).

- ~~**Kept BYTE-IDENTICAL + dormant**~~ — **this policy is retired.** It said opencode's marketing PAGES
  (`routes/{enterprise, bench, brand, changelog, black.*, black, legal, zen/index.*}`) "only render", are unlinked,
  and so "deleting them buys nothing and would just add divergence". The premise was **asserted and never tested,
  and it was wrong four times**:
  - **`/go`** was the **referral landing page** — `component/go-referral` hands out `/go?ref=CODE`, so every invitee
    Volt sent met an "OpenCode Go" page linking our deleted `/docs`.
  - **`/download`** was not a page: its `[channel]/[platform].ts` **proxied opencode-desktop binaries** from
    `github.com/anomalyco/opencode` releases, off Volt's domain.
  - **`bench/submission.ts`** is an **unauthenticated public POST** (`:14-31`) writing straight into the production
    `BenchmarkTable` — no actor or API-key check, unlike every sibling route.
  - **`/black/subscribe/[plan].tsx`** is entered by an **auth redirect** (`:33`), not an href — which is why "nothing
    links to it" scans missed it — and its stage gate is **inverted** (`:22-25`): the checkout is enabled precisely
    on `dev.volt-ai.dev` and paused only on production.

  The flaw is structural, not a run of bad luck: **SolidStart serves every file under `routes/**` by URL**, so
  "unlinked" never meant "unexposed". The tree also cost more than it looked: it kept `i18n/en.ts` at 700 lines of
  opencode product copy, and its sitemap generator shipped **90 `https://opencode.ai/*` URLs** into a *gitignored*
  `public/sitemap.xml` on every build — invisible to source review, and crawled.
- **Now: the console serves NO marketing.** The pages and the components/libs/assets that existed only for them are
  **deleted and declared in `DROPPED`**, which never conflicts on a bump. See the sweep's entries in
  `check-console-divergence.ts` — grouped and individually justified there.
  **The set is atomic on purpose:** those components had live importers right up to the delete (`footer` 6,
  `header` 6, `legal` 6, `locale-links` 7, `config.ts` 6+), because every `routes/**` file compiles whether or not
  anything links to it. Deleting either half alone breaks `vite build` while typecheck stays green — the reason
  `console-build.yml` exists. The delete set was computed from an import-reachability walk over `app/src` rooted at
  the routes Volt actually serves (following `@import` as well as `import`), not from a hand list.
  (Gateway `zen/{go,util,v1}` + `api/support`: **kept** — those are the product.)
- **Also deleted** — the active PROXY/REDIRECT routes that *serve or redirect to opencode's own infra*:
  `routes/{docs, data, stats, s, t, desktop-feedback.ts, discord.ts, feishu.ts, download}` (+ opencode's `index.*`
  landing and `temp.tsx` — a scratch home mockup that imported the deleted root `index.css`, so it couldn't be kept
  pristine). These DO something wrong for Volt (serve opencode docs/binaries, redirect to opencode's Discord), so
  they go. Encoded as the gate's `DROPPED` prefix list (a dir or any file under it) so the deletions don't balloon
  `ALLOW`.
- **Windows build (a prediction that did NOT pan out — recorded so nobody re-tests it).** `black/subscribe/[plan].tsx`
  was expected to be the sole reason `console/app` cannot build on Windows. It was **a** blocker, not **the**
  blocker: with the Black tree gone its `vite:define` error is gone, and a *second* Windows path bug surfaces
  underneath — `Rollup failed to resolve import "C:UsersmarceGithubolt…"`, i.e. backslashes eaten (`Github\volt` →
  `Githubolt`, the `\v` escape). **The console still builds on Linux only**, so `console-build.yml` remains the only
  place a console change is compiled before it reaches `dev`.
  - `routes/download` was moved here in the **v1.18.3 bump** (2026-07-17): it wasn't just a page — its
    `[channel]/[platform].ts` endpoint **proxies opencode-Desktop binaries** (`opencode-desktop-mac-arm64.dmg`, …)
    from `github.com/anomalyco/opencode` releases, i.e. serves opencode's app off Volt's domain. Same category as
    `/docs`; it should have gone in the original strip. v1.18.0 also tied the page to a **15MB** promo video
    (`asset/lander/desktop-tabs-landscape.mp4`) — dropped with it, along with `component/desktop-promo.*`
    (opencode's Desktop ad, which upstream renders **app-wide** from `app.tsx`; see the `app.tsx` note).
- **Added** `routes/index.ts` (Volt, in `ALLOW`) — `/` → `redirect("/auth")` (the console home is the app, not
  opencode's landing).
- **Added** `routes/go/index.ts` (Volt, in `ALLOW`; opencode's `go/index.tsx` + `index.css` → `DROPPED`) — `/go` →
  `redirect("/auth")`. **`/go` is not dormant: it's the referral landing page.** `component/go-referral` hands out
  invite links of the form `/go?ref=CODE`, so opencode's "OpenCode Go" marketing page (with links to the deleted
  `/docs`) was the first thing an invitee saw of Volt. The redirect is safe because **`src/middleware.ts` captures
  `?ref=` on every request** (registered globally in `vite.config.ts`) and sets the `oc_referral` cookie *before*
  any route handler runs — so the invite still lands, and `createReferralFromCookie()` redeems it later on the
  Gateway tab / at lite checkout. Verified by reading the middleware + both redemption call sites; **not yet
  exercised end-to-end against a deployed stage** (needs a real referral code).
- **Edited** `routes/auth/logout.ts` (in `ALLOW`) — one line: `redirect("/zen")` → `redirect("/auth")`. opencode
  sent logged-out users to its `/zen` marketing page (opencode branding + a page Volt doesn't serve publicly); the
  app-only console returns them to the login screen.
- **Legal footer removed from the authed shell** — `routes/workspace/[id].tsx` no longer renders opencode's
  `<Legal>` (which showed "© Anomaly" + opencode's `/brand` and ToS/Privacy links, whose text binds users to
  ANOMALY INNOVATIONS, INC.). Volt's legal lives on the public site (`volt-www`), not the account console, so the
  console footer just drops it. `component/legal.tsx` is therefore left **pristine + unused** (off the gate) — not
  edited. NB: the footer language picker went with it (it was only rendered inside `<Legal>`); the console is
  account-management and locale still resolves from cookie/browser, so this is acceptable.
- `config.ts` (opencode.ai/anomalyco) is imported by **no** kept route after the strip → dormant, left pristine.

**Logged-in-surface branding sweep (volt-branding Phase 3)** — the strings/links a signed-in user or API client
actually sees, found via a full audit of the active workspace surface:
- **Added** `i18n/volt.ts` (in `ALLOW`) — the rebrand **string overlay**, merged over the locale dict in
  `context/i18n.tsx` (one line). opencode's `i18n/en.ts` **and every other locale stay byte-identical**: rebranding
  by editing the vendored dict scattered 26 value edits through a file opencode changes constantly, so the overlay
  replaced it. Scope is the keys the **logged-in** console renders (`workspace.lite.*`, `workspace.keys.*`,
  `workspace.usage.lite`, `zen.api.error.trialEnded`); opencode's dormant marketing pages (`go.*`, `black.*`) keep
  their own copy — unlinked, never shown. A missing key falls through to opencode's.
- **Edited** `routes/workspace/[id].tsx` — tab `Go` → **Gateway** (pointing at Volt's own `/gateway` route);
  **Members tab removed** from the nav (team invites not offered yet; `/members` route stays dormant); dropped the
  shell's own `<main data-page="workspace">` wrapper (the parent `routes/workspace.tsx` already provides it).
- **Added** `routes/workspace/[id]/gateway/` (in `ALLOW`) — **Volt's Gateway tab**, the workspace home. Volt's
  header copy + a quick-connect list (create a key → `opencode auth login` → Volt AI → pick a `(Volt)` model);
  it **imports** `LiteSection` from the vendored `../go/lite-section` and `GoReferralSection` rather than copying
  them, so all the subscription/billing logic keeps tracking upstream. `gateway.css` hides the imported
  `beta-notice` (its "Learn more" points at opencode's deleted `/docs`, and quick-connect supersedes its copy).
- **Left pristine + unlinked:** `routes/workspace/[id]/go/*` — opencode's Go tab is now **byte-identical** to
  upstream and reachable only by typing the URL. It is not the product surface; `/gateway` is.
- **Deleted** `routes/workspace/[id]/{new-user,model,provider}-section.tsx` (+ `.module.css`) — orphaned Zen-landing
  sections (imported by nothing after the workspace-home → `/go` redirect), which still held opencode strings.
  In `DROPPED`.
- **Edited** `routes/zen/util/modelsHandler.ts` (in `ALLOW`) — `/v1/models` (and `/zen/go/v1/models`) returned
  `owned_by: "opencode"` for every model → `"volt"` (visible to any API client).
- **Edited** the team-invite email — `core/src/aws.ts` (sender `OpenCode Zen <contact@anoma.ly>` →
  `Volt <noreply@volt-ai.dev>`), `core/src/user.ts` (subject + `assetsUrl`), `mail/…/InviteEmail.tsx` (opencode.ai
  URLs + "OpenCode" copy → Volt). **Dormant** (Members UI disabled) and needs a verified `volt-ai.dev` SES sender
  identity + `/email` asset hosting before it can actually deliver — rebranded now so it's correct when reactivated.
- **Not changed:** `volt-config/opencode.json` `baseURL` stays `https://volt-ai.dev/v1` (production) — the correct
  shipped end-state; the agent gateway goes live when the production stage deploys (not a code fix).

**Use-case edits (minimal, marked, both non-load-bearing):**
- `function/src/auth.ts` — (a) replaced opencode's hardcoded `@anoma.ly` non-prod login gate with a configurable
  `CONSOLE_DEV_EMAILS` allowlist (**dev-only**; `stage !== "production"`, so production runs opencode's original);
  (b) **PUBLIC branding** — the OpenAuth login page (the UI every user sees at `auth.${domain}`) now uses the Volt
  mark (self-contained data URI) + `title: "Volt"` + orange `primary`, replacing opencode's `favicon-v3.svg`;
  (c) the GitHub email-fetch `User-Agent` `"opencode"` → `"volt"`.
- `app/src/routes/v1/*` (new, Volt-owned) — the **clean public gateway path**: `/v1/{chat/completions, messages,
  models}` (the OpenAI/Anthropic convention), so a subscriber's `baseURL` is `volt-ai.dev/v1` with no opencode
  `zen/go` in the URL. Each re-runs the same thin config as the vendored `zen/go/v1` handler (kept intact; the
  handler keys off the request body, not the path). `volt-config/opencode.json` points the agent at `/v1`.
  Independent of the console domain — deploys at the apex with the console.
- `app/src/routes/workspace/[id]/index.tsx` — the Zen landing (opencode's PAYG model catalog + BYOK-gateway
  `ProviderSection`) is retired; the index now `<Navigate>`s to `/gateway`, which becomes the workspace home. Volt
  sells one product (the Gateway plan); we don't resell the gateway/BYOK. **Top-up/balance is untouched** — it
  lives on the Billing tab.
- `app/src/routes/workspace/[id].tsx` — **Volt-owned workspace shell.** Rewritten from opencode's layout route so
  Volt owns the nav/tabs/chrome (its restyle surface), while the view routes (`billing`/`keys`/`members`/`settings`/
  `usage`) stay 100% vendored, rendered as `props.children`. Drops opencode's Zen product, the
  i18n/language-switch layer (unused), and the `<Legal>` footer — no `<Show when={false}>` hacks. Keeps opencode's
  `data-component` structure so the token-themed `[id].css` applies. Only backend touch: `querySessionInfo` (isAdmin).
  Trade-off: no longer pulls opencode's *shell-layout* changes (the views still do); the shell is trivial + stable.

**Volt-only files:** none — this doc + `check-console-divergence.ts` are the provenance record (the old
`packages/console/VENDORED.md` was removed to keep the vendored tree byte-clean vs. opencode).

**Explicitly reverted to opencode-original** (do NOT re-introduce): `app/src/middleware.ts` (a route-redirect
experiment) and `app/src/routes/zen/v1/models.ts` (debug logging) — both confirmed byte-identical again. And
`app/public/email/` (a directory of email assets that a vendoring glitch had flattened to a stray file) — restored.

## The Go product is 100% config, zero source divergence
The switch to a single Go product is expressed entirely in config: `volt-config/opencode.json` points the agent at
`/zen/go/v1` (the Go/`lite` endpoint, `modelList: "lite"`); `models.json` populates `liteModels`; `ZEN_LIMITS.lite`
sets the caps; the Go Stripe price is €24. opencode's Zen/Black routes stay pristine (unlinked, dormant).

## Enforced automatically — the symmetry gate
`volt-scripts/check-console-divergence.ts` diffs `packages/console/*` against the pinned opencode tag and **exits
non-zero if any SOURCE file diverges outside the allowlist** (the list above, encoded as `ALLOW` in the script).
It runs as the dedicated **`.github/workflows/console-symmetry.yml`** workflow — **path-filtered** to fire only
when `packages/console/**` or the check script changes (the only time drift can appear), so unrelated pushes don't
pay the opencode download. An accidental edit to opencode source can't merge. `app/public/*` (branding assets) is
excluded — that's Volt's to own.

```
bun volt-scripts/check-console-divergence.ts     # local check; 0 = clean, 1 = drift
```

**On an opencode bump:** change `OPENCODE_VERSION` in the script, re-run, and reconcile `ALLOW` + this doc with the
output. Adding a new intended edit = add it to `ALLOW` **and** here (the two must agree). Anything the gate flags
that isn't intended is drift to revert.
