#!/usr/bin/env bun
/**
 * Release = PROMOTE a build. You don't cut a new version — you point one already-built, CI-green DEV build at the
 * stable channel. This command is only a TRIGGER: the real work (gate the installer, flip the release to stable)
 * runs in CI (.github/workflows/promote.yml on a clean Windows runner). Nothing installs on your machine.
 *
 *   bun run release            # promote the NEWEST dev prerelease to stable
 *   bun run release 0.1.842    # promote that specific build (maj.min.count)
 *
 * You can also trigger it with no command at all: GitHub → Actions → "promote" → Run workflow → type the version —
 * but only for a build that already carries a green `release-matrix.json` (this script attaches it; promote.yml
 * refuses a release without one).
 *
 * Every push to dev already publishes a testable installer as a PRERELEASE, versioned <maj>.<min>.<commit-count> and
 * tagged, for the dev channel. Promotion re-verifies that build (published prerelease + its commit's CI green),
 * downloads ITS installer, runs the install/uninstall/lifecycle gates, then flips prerelease -> latest. The stable
 * release is the exact build you pointed at — same 3-part version the dev channel used (monotonic; no downgrade).
 *
 * Needs the `gh` CLI, authenticated.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { proofRefusal } from "../packages/volt-cli/scripts/release-matrix-cells.js"

const REPO = "he-man86/volt"

function gh(args: string[], capture = true): { ok: boolean; out: string } {
  const r = spawnSync("gh", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" })
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() }
}

// Compare versions numerically (System.Version-style) — NOT lexically (0.1.90 must beat its sibling 0.1.9).
// Loops 4 components so a legacy 4-part tag from before the 3-part switch still sorts correctly. a<b:-, a==b:0, a>b:+.
const cmpVersion = (a: string, b: string): number => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < 4; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

// The newest published dev PRERELEASE (highest 3-part maj.min.count version), or null.
function newestPrerelease(): string | null {
  const r = gh(["release", "list", "--repo", REPO, "--limit", "60", "--json", "tagName,isPrerelease"])
  if (!r.ok) return null
  return (JSON.parse(r.out) as { tagName: string; isPrerelease: boolean }[])
    .filter((x) => x.isPrerelease && /^\d+\.\d+\.\d+$/.test(x.tagName))
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
  console.error("✗ no dev prerelease found to promote (and none given). Push to dev first, or pass one: bun run release 0.1.842")
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ '${version}' is not a 3-part build version (maj.min.count). A release promotes a specific dev build.`)
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

// THE LIVE RELEASE GATE (openspec environment-dependency-audit 3.1): CI's runner has no CODESYS or TwinCAT, so the
// e2e over every installed IDE variant runs on the dev machine — `bun run release:matrix` — and a build is promoted
// only when that matrix ran green on THIS build's commit. A red cell, an older commit or no run is refused by name.
const sha = gh(["api", `repos/${REPO}/commits/${version}`, "--jq", ".sha"])
if (!sha.ok || !/^[0-9a-f]{40}$/.test(sha.out)) {
  console.error(`✗ could not resolve ${version}'s commit (gh api repos/${REPO}/commits/${version})`)
  process.exit(1)
}
const matrixFile = new URL("../dist/release-matrix/result.json", import.meta.url)
if (!existsSync(matrixFile)) {
  console.error(`✗ no release matrix result (dist/release-matrix/result.json) — check out ${sha.out} and run \`bun run release:matrix\``)
  process.exit(1)
}
const refused = proofRefusal(JSON.parse(readFileSync(matrixFile, "utf8")), sha.out)
if (refused) {
  console.error(`✗ ${refused} (${version}) — check out ${sha.out} and run \`bun run release:matrix\``)
  process.exit(1)
}
// The proof travels WITH the release: promote.yml refuses a release that carries no green `release-matrix.json` for its
// own commit, so starting `promote` from the Actions UI cannot skip the matrix (gate 2c+3 review).
const attached = join(mkdtempSync(join(tmpdir(), "volt-release-")), "release-matrix.json")
copyFileSync(matrixFile, attached)
if (!gh(["release", "upload", version, attached, "--repo", REPO, "--clobber"], false).ok) {
  console.error(`✗ could not attach release-matrix.json to ${version} (gh release upload)`)
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
