#!/usr/bin/env bun
/**
 * Release = PROMOTE a build. You don't cut a new version — you point one already-built, CI-green DEV build at the
 * stable channel. This command is only a TRIGGER: the real work (gate the installer, flip the release to stable)
 * runs in CI (.github/workflows/promote.yml on a clean Windows runner). Nothing installs on your machine.
 *
 *   bun run release            # promote the NEWEST dev prerelease to stable
 *   bun run release 0.0.1.842  # promote that specific build
 *
 * You can also trigger it with no command at all: GitHub → Actions → "promote" → Run workflow → type the version.
 *
 * Every push to dev already publishes a testable installer as a PRERELEASE, versioned 0.0.1.<commit-count> and
 * tagged, for the dev channel. Promotion re-verifies that build (published prerelease + its commit's CI green),
 * downloads ITS installer, runs the install/uninstall/lifecycle gates, then flips prerelease -> latest. The stable
 * release is the exact build you pointed at — same 4-part version the dev channel used (monotonic; no downgrade).
 *
 * Needs the `gh` CLI, authenticated.
 */
import { spawnSync } from "node:child_process"

const REPO = "he-man86/volt"

function gh(args: string[], capture = true): { ok: boolean; out: string } {
  const r = spawnSync("gh", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" })
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() }
}

// Compare two 4-part versions numerically (System.Version-style) — NOT lexically (0.0.1.90 must beat 0.0.1.842's
// sibling 0.0.1.9). Returns a<b:-, a==b:0, a>b:+.
const cmpVersion = (a: string, b: string): number => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < 4; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

// The newest published dev PRERELEASE (highest 4-part version), or null.
function newestPrerelease(): string | null {
  const r = gh(["release", "list", "--repo", REPO, "--limit", "60", "--json", "tagName,isPrerelease"])
  if (!r.ok) return null
  return (JSON.parse(r.out) as { tagName: string; isPrerelease: boolean }[])
    .filter((x) => x.isPrerelease && /^\d+\.\d+\.\d+\.\d+$/.test(x.tagName))
    .map((x) => x.tagName)
    .sort(cmpVersion)
    .at(-1) ?? null
}

if (!gh(["auth", "status"]).ok) {
  console.error("✗ `gh` is not authenticated — run `gh auth login`, then re-run (or trigger promote.yml from the Actions tab).")
  process.exit(1)
}

const version = process.argv[2] ?? newestPrerelease()
if (!version) {
  console.error("✗ no dev prerelease found to promote (and none given). Push to dev first, or pass one: bun run release 0.0.1.842")
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ '${version}' is not a 4-part build version (X.Y.Z.count). A release promotes a specific dev build.`)
  process.exit(1)
}

// The build must exist AND still be a prerelease (promoting an already-stable one is a no-op worth flagging here,
// before spending a CI run on it).
const view = gh(["release", "view", version, "--repo", REPO, "--json", "isPrerelease,targetCommitish"])
if (!view.ok) {
  console.error(`✗ no published release ${version} — a dev build must be published before it can be promoted.`)
  process.exit(1)
}
const info = JSON.parse(view.out) as { isPrerelease: boolean; targetCommitish: string }
if (!info.isPrerelease) {
  console.error(`✗ ${version} is already a stable release — nothing to promote.`)
  process.exit(1)
}

console.log(`• promoting ${version} (commit ${info.targetCommitish}) → stable`)
console.log("  promote.yml (CI) will re-verify CI is green, run the install gates on its installer, then flip prerelease → latest.")
if (!gh(["workflow", "run", "promote.yml", "--repo", REPO, "-f", `version=${version}`], false).ok) {
  console.error("✗ failed to trigger promote.yml")
  process.exit(1)
}
console.log(`\n✓ promotion started for ${version}`)
console.log(`  watch: https://github.com/${REPO}/actions/workflows/promote.yml`)
