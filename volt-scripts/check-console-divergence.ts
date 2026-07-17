#!/usr/bin/env bun
/**
 * check-console-divergence — guard the vendored-console structural symmetry.
 *
 * `packages/console/*` is opencode source pinned at OPENCODE_VERSION. This diffs it against that exact tag and
 * FAILS on any divergence (differs / added / removed) that isn't declared — so an accidental edit to opencode
 * source can't slip in. Declared divergence is two lists, both of which must agree with openspec/.../DIVERGENCE.md:
 *   • ALLOW   — opencode files Volt EDITS, plus Volt-added files (e.g. volt-theme.css, the `/` redirect).
 *   • DROPPED — opencode files Volt DELETES (the public-surface strip: the active proxy/redirect routes).
 *
 * Run: bun volt-scripts/check-console-divergence.ts   (exit 0 = only expected divergence; 1 = drift)
 * On an opencode bump: change OPENCODE_VERSION, re-run, and reconcile ALLOW + DROPPED + DIVERGENCE.md with output.
 */
import { $ } from "bun"

const OPENCODE_VERSION = "v1.18.3"

// The full, intended divergence footprint — opencode files Volt EDITS or ADDS (deleted files live in DROPPED,
// below). Grouped by concern; see DIVERGENCE.md. Paths are relative to packages/console/.
const ALLOW = new Set([
  // ══ THE EDIT FLOOR ══════════════════════════════════════════════════════════════════════════════════════════
  // Volt does NOT edit opencode's source to customize it. Every customization takes one of three shapes:
  //   • a Volt file BESIDE opencode's  (an overlay, a new route, a new stylesheet) — costs nothing on a bump
  //   • a DELETION declared in DROPPED (below)                                     — never conflicts
  //   • an IMPORT of opencode's exported server code                               — stays in sync by definition
  // The entries in THIS section are the exceptions, and the list is closed. Each one is a framework entry point
  // that cannot be shadowed by a beside-file: vite/SolidStart resolve them by FILENAME, so there is no "beside".
  // Every one of them is a hand-merge on every opencode bump, so adding to this list has a permanent cost —
  // justify it here and in DIVERGENCE.md or don't do it. See openspec/changes/console-volt-frontend.
  //
  // ── De-fork glue: the @opencode-ai/ui + opencode packages were deleted, so a few imports were re-pointed ──
  "app/package.json", // dropped @opencode-ai/ui + schema build + @ibm/plex (unused once the font is Inter); added @fontsource-variable/{inter,jetbrains-mono}
  "app/src/ui.tsx", // inlined createSimpleContext + Favicon; Favicon emits Volt's /volt-mark.svg + /apple-touch-icon.png
  "app/src/entry-server.tsx", // og:image/twitter:image → Volt's icon (opencode's /social-share.png was deleted)
  "app/scripts", // Volt-added: gen-favicon.ts generates public/volt-mark.svg + the brand PNGs from component/volt-mark-path.ts (zero-dep)
  "app/src/app.tsx", // + self-hosted Inter/JetBrains via TS import (a bare CSS @import is NOT bundled by vite — the fonts silently never shipped) and DROPS @ibm/plex (~437 unused @font-face once --font-sans stops aliasing --font-mono); @opencode-ai/ui → ~/ui rewrite, + ./style/volt-theme.css, + Title "Volt"; SKIPS upstream's <Font/> (@opencode-ai/ui, deleted — Volt self-hosts fonts) and <DesktopPromo/> (opencode-Desktop ad, rendered app-wide incl. our workspace)
  "app/src/context/i18n.tsx", // @opencode-ai/ui → ~/ui (ditto)
  "app/src/context/language.tsx", // @opencode-ai/ui → ~/ui (ditto)

  // ── Volt branding: an ADDITIVE override — opencode's style/token/*.css stay byte-identical ──
  "app/src/style/volt-components.css", // Volt-added: the few component SHAPES no token can express (the pill button — its radius token is shared with 39 inputs/progress bars, so it cannot be retuned globally)
  "app/src/style/volt-theme.css", // the ONLY branding source file: Volt token values + self-hosted fonts
  "app/test/volt-price.test.ts", // Volt-added: the price a customer READS (i18n overlay) must match the price infra/console.ts CHARGES — they lived in two files with nothing connecting them, so the console advertised opencode's $10/mo while Stripe billed €24
  "app/test/volt-no-opencode-leftovers.test.ts", // Volt-added: fails if any string the app renders carries opencode BRANDING (its products/domains/contacts) — the bar review keeps missing
  "app/test/volt-theme.cascade.test.ts", // Volt-added: every token volt-theme.css overrides must be declared at a selector that WINS (opencode splits :root for colour vs body for font/space — a :root font override silently loses)
  "app/test/volt-theme.contrast.test.ts", // Volt-added: pins the brand palette's WCAG contrast (CSS is type-checked by nothing; a value tweak can silently break readability)
  "app/test/volt-gateway-observability.test.ts", // Volt-added: asserts every POST route under routes/v1 is in the tail worker's allowlist (the beside-file hazard — see the file)
  "app/src/i18n/volt.test.ts", // Volt-added: pins the overlay merge point (see the file) — red if it regresses to a context-only merge
  "app/src/i18n/volt.ts", // Volt-added: the rebrand string OVERLAY — opencode's en.ts + every other locale stay byte-identical
  "app/src/i18n/index.ts", // merges the volt overlay into i18n() itself — the ONE factory both the client render AND the six server call sites (gateway handler, rate limiters, /auth callback) share

  // ── Volt-owned surfaces: Volt writes these fresh, not as patches on opencode ──
  "app/src/routes/index.ts", // `/` → redirect to /auth (console is app-only; the public site is volt-www)
  "app/src/routes/go/index.ts", // `/go?ref=…` (the referral invite link) → redirect to /auth; middleware.ts still captures ?ref first
  "app/src/routes/auth/logout.ts", // logout → /auth (opencode sent logged-out users to its /zen marketing page)
  "app/src/routes/workspace/[id].tsx", // Volt-owned workspace shell (nav/layout); the views stay vendored as children
  "app/src/routes/workspace/[id]/index.tsx", // workspace root → the Gateway tab (Volt's default view)
  "app/src/component/volt-mark-path.ts", // Volt-added: the mark's geometry + brand colours, the SINGLE source the component AND scripts/gen-favicon.ts (svg + pngs) read — they were 3 hand-kept copies and drifted
  "app/src/component/volt-mark.tsx", // Volt-added: Volt's mark, inline for currentColor — replaces opencode's IconWorkspaceLogo in the authed header + 404 (repoint consumers, never edit the vendored icon barrel)
  "app/src/routes/workspace.tsx", // Volt-owned chrome: opencode's mark on EVERY authed page → VoltMark; logo link `/` (which redirects to /auth, bouncing you out of your own workspace) → the workspace root
  "app/src/routes/[...404].tsx", // Volt-owned: opencode's 404 was a marketing page (its wordmark, an anomalyco/opencode link, and /docs + /discord — both DELETED, so the 404 page 404'd)
  "app/src/routes/[...404].css", // Volt-owned: dropped its local hsl palette, which pinned the one page a lost user sees to opencode's colours and made volt-theme.css a no-op there
  "app/src/routes/workspace/[id]/gateway", // Volt-added: the Gateway tab (Volt's copy + quick-connect); IMPORTS the vendored /go sections, so /go itself stays pristine + unlinked
  "app/src/routes/v1", // clean public gateway path (/v1/*, no opencode "zen/go" branding); re-runs the vendored config

  // ── Backend use-case edit ──
  "function/src/auth.ts", // dev-only CONSOLE_DEV_EMAILS login allowlist (production runs opencode's original)
  "function/src/log-processor.ts", // ADDITIVE: also ship Volt's own gateway path (/v1/*) to Honeycomb — opencode only allowlists its /zen/*, so every live Volt request was dropped

  // ── Gateway + email branding (values a client / recipient sees) ──
  "app/src/routes/zen/util/modelsHandler.ts", // /v1/models owned_by: "opencode" → "volt"
  "app/src/routes/zen/util/handler.ts", // gateway errors linked hardcoded opencode.ai/workspace/… → request-derived origin + Volt's /gateway tab; ADMIN_WORKSPACES (opencode's own ids, isFree+allowlist bypass) emptied
  "app/src/routes/honeycomb/webhook.ts", // blanked opencode's hardcoded Discord alert role ID (wrong server); mention now opt-in
  "app/src/component/go-referral.tsx", // the invite link — the most-shared URL the product has — was /go?ref=… (opencode's Go marketing page, now a redirect); → /?ref=… . middleware.ts captures ?ref on every path, so no route was needed
  "app/src/routes/workspace/[id]/usage/graph-section.tsx", // chart legend hardcoded " (go)" — opencode's tier name on the page that itemises what a Volt customer pays for (its sibling suffix goes through i18n; this one didn't, so the overlay couldn't reach it)
  "app/src/routes/workspace/[id]/billing/billing-section.tsx", // "contact us" mailto:help@anoma.ly (opencode's support inbox, live on Volt's Billing tab) → hello@volt-ai.dev
  "core/src/billing.ts", // checkout default-applied opencode's 50%-off-first-month coupon to EVERY new subscriber (no opt-in, no campaign) — Volt sells the Gateway flat at €24/mo, so the default is removed; the opt-in campaign coupons stay
  "core/src/aws.ts", // email sender: "OpenCode Zen <contact@anoma.ly>" → "Volt <noreply@volt-ai.dev>"
  "core/src/user.ts", // invite email subject + assetsUrl rebranded to Volt / volt-ai.dev
  "mail/emails/templates/InviteEmail.tsx", // invite email body: opencode.ai URLs + "OpenCode" copy → Volt
])

// Opencode's active PROXY/REDIRECT routes — the ones that SERVE or REDIRECT to opencode's own infra/community —
// DELETED in the Phase-2 strip. (Opencode's marketing PAGES — go/download/enterprise/brand/legal/… — are instead
// left BYTE-IDENTICAL and dormant: unlinked, off the public face via volt-www, so they don't need deleting and
// pull opencode bugfixes conflict-free. The console is app-only via the `/`→/auth redirect + deploy at a subdomain.)
// Deleted paths appear as "Only in opencode" and are EXPECTED. Listed as prefixes (a dir OR any file under it).
// See DIVERGENCE.md.
const DROPPED = [
  // ── opencode's `/` marketing landing → replaced by routes/index.ts (a redirect to /auth), so index.* is gone
  "app/src/routes/index.tsx", "app/src/routes/index.css",
  // temp.tsx — opencode's scratch home mockup; imported the now-deleted root index.css, so it could never be "kept
  // pristine" anyway.
  "app/src/routes/temp.tsx",
  // ── Routes that actively SERVE or REDIRECT to opencode's own infra/community.
  "app/src/routes/docs", "app/src/routes/data", "app/src/routes/stats", "app/src/routes/s", "app/src/routes/t",
  "app/src/routes/desktop-feedback.ts", "app/src/routes/discord.ts", "app/src/routes/feishu.ts",
  // opencode's Desktop download page + its binary PROXY (`/download/[channel]/[platform]` streamed
  // opencode-desktop-* assets from github.com/anomalyco/opencode releases — opencode's app served off Volt's
  // domain). v1.18.0 also tied the page to a 15MB promo video.
  "app/src/routes/download",
  "app/src/component/desktop-promo.tsx", "app/src/component/desktop-promo.css", // v1.18.0: opencode-Desktop ad, rendered app-wide from app.tsx (see ALLOW) — not vendored, so nothing imports it
  // `/go` — opencode's Go marketing page, REPLACED by routes/go/index.ts (a redirect to /auth): the referral invite
  // link (`/go?ref=…`) makes this path public, so it was never dormant. Same shape as routes/index.tsx → index.ts.
  "app/src/routes/go/index.tsx", "app/src/routes/go/index.css",

  // ── THE MARKETING SWEEP (console-volt-frontend Stage 2). The console is the ACCOUNT APP; volt-www is Volt's
  // public face. These are deleted rather than "kept byte-identical + dormant" because that policy was asserted
  // four times and wrong four times: /go was the referral landing page, /download proxied opencode's binaries,
  // bench/submission.ts is an unauthenticated public POST into the production BenchmarkTable, and
  // /black/subscribe is entered by an AUTH REDIRECT with an inverted stage gate — live precisely on dev. SolidStart
  // serves every file under routes/** by URL: unlinked is not unexposed. DROPPED never conflicts on a bump.
  "app/src/routes/bench",            // opencode's model leaderboard + that unauthenticated POST
  "app/src/routes/black", "app/src/routes/black.tsx", "app/src/routes/black.css", // the premium tier Volt doesn't sell; black.tsx was its LAYOUT, not a page
  "app/src/routes/brand",            // opencode's brand kit; its index.css was also the legal pages' only token source, so they leave together
  "app/src/routes/changelog", "app/src/routes/changelog.json.ts",
  "app/src/routes/enterprise",       // opencode's sales page …
  "app/src/routes/api/enterprise.ts", // … and its form handler: mailed prospect PII to contact@anoma.ly + opencode's EmailOctopus list + opencode's Salesforce. Only caller was the page above.
  "app/src/routes/legal",            // terms binding users to ANOMALY INNOVATIONS, INC.; Volt's legal lives on volt-www
  "app/src/routes/openapi.json.ts",  // republished opencode's SDK spec from Volt's domain
  "app/src/routes/zen/index.tsx", "app/src/routes/zen/index.css", // the Zen MARKETING page. The zen/{go,util,v1} GATEWAY stays — it is the product.

  // Components those pages owned. They had live importers right up until the delete above: SolidStart compiles
  // every routes/** file whether or not anything links to it, so deleting either half alone breaks `vite build`
  // (typecheck stays green). This is one atomic set for that reason.
  "app/src/component/header.tsx", "app/src/component/header-context-menu.css",
  "app/src/component/footer.tsx", "app/src/component/faq.tsx", "app/src/component/legal.tsx",
  "app/src/component/locale-links.tsx",
  "app/src/component/language-picker.tsx", "app/src/component/language-picker.css",
  "app/src/component/email-signup.tsx", "app/src/component/spotlight.tsx", "app/src/component/spotlight.css",

  // Libs those pages owned.
  "app/src/config.ts",               // opencode.ai / anomalyco URLs + social handles
  "app/src/lib/changelog.ts", "app/src/lib/github.ts",
  "app/src/lib/salesforce.ts",       // pushed enterprise leads into opencode's Salesforce
  "app/src/lib/stats-proxy.ts",      // already dead before this sweep
  "app/src/context/auth.session.ts", // zero importers repo-wide (verified across app/, function/, infra/)

  // opencode's marketing imagery — logos, wordmarks, the brand kit, lander screenshots/videos, the ornate
  // go/zen/logo marks: 63 files, all of it opencode's brand. The last two (logo-ornate-*.svg) were the 404 page's
  // wordmark; that page is Volt-owned now and uses public/volt-mark.svg.
  "app/src/asset",

  // The sitemap generator. It ran as step 1 of app/package.json's build (`&&`-chained before vite, so every build
  // and every deploy) and emitted 90 https://opencode.ai/* marketing URLs into public/sitemap.xml — a GITIGNORED
  // artifact, so it never appeared in review, and it shipped and got crawled. Three of its five routes were not
  // Volt pages. Its `&&`-chain is removed from app/package.json.
  "app/script",

  // opencode's workspace PICKER (header dropdown). Volt is a one-workspace product, so switching offers a choice
  // that never exists — and this control was also the only UI that CREATED workspaces. Onboarding is unaffected:
  // function/src/auth.ts:239 creates the "Default" workspace at signup.
  "app/src/routes/workspace-picker.tsx", "app/src/routes/workspace-picker.css",

  // The workspace /go TAB — a dormant duplicate of Volt's Gateway view since routes/workspace/[id]/index.tsx
  // redirects there and the shell's tab points at it. Its lite-section.tsx + .module.css STAY, byte-identical:
  // they are a module, not a route (no default export), and gateway/index.tsx imports LiteSection +
  // queryLiteSubscription from them. That is the seam — Volt owns the presentation, opencode keeps the
  // subscription/checkout logic, and it keeps tracking upstream.
  "app/src/routes/workspace/[id]/go/index.tsx",

  // Orphaned Zen-landing sections (imported by nothing after the workspace-home → Gateway redirect); contained
  // opencode strings ("opencode auth login", /docs/zen). Deleted as dead code.
  "app/src/routes/workspace/[id]/new-user-section.tsx", "app/src/routes/workspace/[id]/new-user-section.module.css",
  "app/src/routes/workspace/[id]/model-section.tsx", "app/src/routes/workspace/[id]/model-section.module.css",
  "app/src/routes/workspace/[id]/provider-section.tsx", "app/src/routes/workspace/[id]/provider-section.module.css",
]
const isDropped = (p: string) => DROPPED.some((d) => p === d || p.startsWith(d + "/"))
// NB: app/public/* (favicons, social-share, manifests) is EXCLUDED from the check — it's branding, which Volt
// owns and is expected to diverge. This gate protects SOURCE symmetry (.ts/.tsx/.json), where drift breaks merges.

const ver = OPENCODE_VERSION.replace(/^v/, "")
const tmp = ".oc-console-check" // repo-relative (portable across the Windows Bun shell + Linux CI); cleaned up below
const ocConsole = `${tmp}/opencode-${ver}/packages/console`

// Fetch just packages/console from the pinned tag (tar extracts only that path from the streamed archive).
await $`rm -rf ${tmp} && mkdir -p ${tmp}`.quiet()
// opencode's app/public/* are symlinks into @opencode-ai/ui; Windows tar can't create them (Linux CI is fine).
// .nothrow() lets the source files (.ts/.tsx/.json — what the divergence check cares about) extract regardless.
await $`curl -sL https://github.com/sst/opencode/archive/refs/tags/${OPENCODE_VERSION}.tar.gz | tar xz -C ${tmp} opencode-${ver}/packages/console`
  .quiet()
  .nothrow()

// CRLF-normalized recursive diff, ignoring build/dep artifacts.
const raw = await $`diff -r --strip-trailing-cr -q -x node_modules -x dist -x .output -x .sst -x '*.tsbuildinfo' -x bun.lock -x public ${ocConsole} packages/console`
  .nothrow()
  .text()
await $`rm -rf ${tmp}`.quiet() // done reading; clean up before any exit

const rel = (p: string) => p.replace(/^.*?packages\/console\/?/, "")
const diverged: string[] = []
for (const line of raw.split("\n")) {
  const differ = line.match(/^Files (.+) and (.+) differ$/)
  const only = line.match(/^Only in (.+): (.+)$/)
  if (differ) diverged.push(rel(differ[2]))
  else if (only) diverged.push(rel(`${only[1]}/${only[2]}`).replace(/\/+/g, "/"))
}

const drift = diverged.filter((p) => !ALLOW.has(p) && !isDropped(p)).sort()
const expected = diverged.filter((p) => ALLOW.has(p) || isDropped(p))
const staleAllow = [...ALLOW].filter((p) => !diverged.includes(p))
// A DROPPED entry is stale if nothing diverged under it — i.e. the opencode file is back (restored / re-added
// upstream), so the deletion no longer applies and the entry should be pruned.
const staleDropped = DROPPED.filter((d) => !diverged.some((p) => p === d || p.startsWith(d + "/")))

console.log(`console divergence vs opencode ${OPENCODE_VERSION}: ${expected.length} intended, ${drift.length} unexpected`)
if (staleAllow.length) console.log(`  note: allowlisted but no longer divergent (can prune): ${staleAllow.join(", ")}`)
if (staleDropped.length) console.log(`  note: DROPPED but present again (can prune): ${staleDropped.join(", ")}`)
if (drift.length) {
  console.error(`\n  ✗ UNEXPECTED DRIFT in vendored opencode source:`)
  for (const p of drift) console.error(`      packages/console/${p}`)
  console.error(`\n  Fix: revert these to opencode, OR (if the change is genuinely needed for Volt) add each to`)
  console.error(`  ALLOW in this script AND document it in openspec/changes/commercial-cloud-backend/DIVERGENCE.md.`)
  process.exit(1)
}
console.log(`  ✓ no unexpected drift — packages/console/* matches opencode except the ${expected.length} intended files.`)
