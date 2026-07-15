#!/usr/bin/env bun
/**
 * check-console-divergence — guard the vendored-console structural symmetry.
 *
 * `packages/console/*` is opencode source pinned at OPENCODE_VERSION. This diffs it against that exact tag and
 * FAILS if any file diverges (differs / added / removed) that isn't on ALLOW — so an accidental edit to opencode
 * source can't slip in. Intended divergences live on ALLOW and in openspec/.../DIVERGENCE.md; the two must agree.
 *
 * Run: bun volt-scripts/check-console-divergence.ts   (exit 0 = only expected divergence; 1 = drift)
 * On an opencode bump: change OPENCODE_VERSION, re-run, and reconcile ALLOW + DIVERGENCE.md with the new output.
 */
import { $ } from "bun"

const OPENCODE_VERSION = "v1.17.20"

// The full, intended divergence footprint (see DIVERGENCE.md). Paths are relative to packages/console/.
const ALLOW = new Set([
  // de-fork: @opencode-ai/ui + opencode packages were deleted
  "app/package.json",
  "app/src/ui.tsx",
  "app/src/app.tsx",
  "app/src/context/i18n.tsx",
  "app/src/context/language.tsx",
  // use-case edits (dev-only / presentation, marked VOLT:)
  "function/src/auth.ts",
  "app/src/routes/workspace/[id]/index.tsx", // Zen landing → redirect to Go
  "app/src/routes/workspace/[id].tsx", // Zen nav tab hidden
  // Volt-only
  "VENDORED.md",
])
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

const drift = diverged.filter((p) => !ALLOW.has(p)).sort()
const expected = diverged.filter((p) => ALLOW.has(p))
const staleAllow = [...ALLOW].filter((p) => !diverged.includes(p))

console.log(`console divergence vs opencode ${OPENCODE_VERSION}: ${expected.length} intended, ${drift.length} unexpected`)
if (staleAllow.length) console.log(`  note: allowlisted but no longer divergent (can prune): ${staleAllow.join(", ")}`)
if (drift.length) {
  console.error(`\n  ✗ UNEXPECTED DRIFT in vendored opencode source:`)
  for (const p of drift) console.error(`      packages/console/${p}`)
  console.error(`\n  Fix: revert these to opencode, OR (if the change is genuinely needed for Volt) add each to`)
  console.error(`  ALLOW in this script AND document it in openspec/changes/commercial-cloud-backend/DIVERGENCE.md.`)
  process.exit(1)
}
console.log(`  ✓ no unexpected drift — packages/console/* matches opencode except the ${expected.length} intended files.`)
