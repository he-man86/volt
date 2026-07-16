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

const OPENCODE_VERSION = "v1.17.20"

// The full, intended divergence footprint — opencode files Volt EDITS or ADDS (deleted files live in DROPPED,
// below). Grouped by concern; see DIVERGENCE.md. Paths are relative to packages/console/.
const ALLOW = new Set([
  // ── De-fork glue: the @opencode-ai/ui + opencode packages were deleted, so a few imports were re-pointed ──
  "app/package.json", // dropped @opencode-ai/ui + schema build; added @fontsource-variable/{inter,jetbrains-mono}
  "app/src/ui.tsx", // inlined createSimpleContext + Favicon; Favicon emits Volt's /volt-mark.svg + /apple-touch-icon.png
  "app/src/entry-server.tsx", // og:image/twitter:image → Volt's icon (opencode's /social-share.png was deleted)
  "app/scripts", // Volt-added: gen-favicon.ts rasterizes volt-mark.svg → the brand PNGs in public/ (zero-dep)
  "app/src/app.tsx", // @opencode-ai/ui → ~/ui rewrite, + one import: ./style/volt-theme.css
  "app/src/context/i18n.tsx", // @opencode-ai/ui → ~/ui — i18n plumbing the vendored views still call (English-only in practice)
  "app/src/context/language.tsx", // @opencode-ai/ui → ~/ui (ditto)

  // ── Volt branding: an ADDITIVE override — opencode's style/token/*.css stay byte-identical ──
  "app/src/style/volt-theme.css", // the ONLY branding source file: Volt token values + self-hosted fonts
  "app/src/i18n/en.ts", // user-visible strings rebranded off opencode: "OpenCode Go" → "Volt Gateway", "opencode" → "Volt" (Black tier left pristine — Volt doesn't sell it)

  // ── Volt-owned surfaces: Volt writes these fresh, not as patches on opencode ──
  "app/src/routes/index.ts", // `/` → redirect to /auth (console is app-only; the public site is volt-www)
  "app/src/routes/auth/logout.ts", // logout → /auth (opencode sent logged-out users to its /zen marketing page)
  "app/src/routes/workspace/[id].tsx", // Volt-owned workspace shell (nav/layout); the views stay vendored as children
  "app/src/routes/workspace/[id]/index.tsx", // workspace root → the Gateway tab (Volt's default view)
  "app/src/routes/workspace/[id]/go/index.tsx", // Gateway tab: dropped the "Learn more" → opencode /docs/go (deleted, 404)
  "app/src/routes/workspace/[id]/go/lite-section.tsx", // Gateway tab: dropped the "Learn more" → opencode /docs (#opencode-go, 404)
  "app/src/routes/v1", // clean public gateway path (/v1/*, no opencode "zen/go" branding); re-runs the vendored config

  // ── Backend use-case edit ──
  "function/src/auth.ts", // dev-only CONSOLE_DEV_EMAILS login allowlist (production runs opencode's original)

  // ── Gateway + email branding (values a client / recipient sees) ──
  "app/src/routes/zen/util/modelsHandler.ts", // /v1/models owned_by: "opencode" → "volt"
  "app/src/routes/honeycomb/webhook.ts", // blanked opencode's hardcoded Discord alert role ID (wrong server); mention now opt-in
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
  // opencode's `/` marketing landing → replaced by routes/index.ts (a redirect to /auth), so index.* is gone
  "app/src/routes/index.tsx", "app/src/routes/index.css",
  // temp.tsx — opencode's scratch home mockup (opencode branding; imported the now-deleted root index.css). Not a
  // real page; deleted (can't be "kept pristine" — its CSS import broke the SolidStart build).
  "app/src/routes/temp.tsx",
  // proxies/redirects to opencode's own docs / stats / community (they actively serve/redirect to opencode)
  "app/src/routes/docs", "app/src/routes/data", "app/src/routes/stats", "app/src/routes/s", "app/src/routes/t",
  "app/src/routes/desktop-feedback.ts", "app/src/routes/discord.ts", "app/src/routes/feishu.ts",
  // Orphaned Zen-landing sections (imported by nothing after the workspace-home → /go redirect); contained
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
