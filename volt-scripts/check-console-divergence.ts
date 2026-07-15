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

// The full, intended divergence footprint (see DIVERGENCE.md). Paths are relative to packages/console/.
const ALLOW = new Set([
  // de-fork: @opencode-ai/ui + opencode packages were deleted
  "app/package.json", // + @fontsource-variable/{inter,jetbrains-mono} for the self-hosted Volt brand type
  "app/src/ui.tsx",
  "app/src/app.tsx", // + one import line: ./style/volt-theme.css (the brand override, loaded after ./app.css)
  "app/src/context/i18n.tsx",
  "app/src/context/language.tsx",
  // use-case edits (dev-only / presentation, marked VOLT:)
  "function/src/auth.ts",
  "app/src/routes/workspace/[id]/index.tsx", // Zen landing → redirect to Go
  "app/src/routes/workspace/[id].tsx", // Zen nav tab hidden + opencode <Legal> footer removed (legal lives on volt-www)
  // Volt branding — an ADDITIVE override, not an edit to opencode source. This is the ONLY branding file in the
  // divergence footprint: opencode's own style/token/*.css stay byte-identical (they pull bugfixes conflict-free).
  "app/src/style/volt-theme.css",
  // Phase-2 public-surface strip: opencode's marketing landing (`/`) is replaced by a redirect to the app.
  "app/src/routes/index.ts",
  // Volt-only
  "VENDORED.md",
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
  // proxies/redirects to opencode's own docs / stats / community (they actively serve/redirect to opencode)
  "app/src/routes/docs", "app/src/routes/data", "app/src/routes/stats", "app/src/routes/s", "app/src/routes/t",
  "app/src/routes/desktop-feedback.ts", "app/src/routes/discord.ts", "app/src/routes/feishu.ts",
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
