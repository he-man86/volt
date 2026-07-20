#!/usr/bin/env bun
/**
 * Cut a STABLE release with one command: tag the current packages/volt-desktop/package.json version and push the
 * tag, which triggers release.yml to build (dotnet + Inno on windows-latest) and publish Volt-win-Setup.exe as the
 * latest GitHub Release. No local .NET SDK / Inno Setup needed — CI does the build.
 *
 *   bun run release        # tag <version> on dev + push → CI builds + publishes the STABLE release
 *
 * DEV builds need no command: every push to dev auto-publishes a X.Y.Z.<commit-count> PRERELEASE (the dev channel).
 * Only cut a stable when you want the next real release: bump packages/volt-desktop/package.json in your feature PR
 * (the X.Y.Z base — the one number a human sets), merge to dev, then `bun run release`.
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
// volt-desktop's version is the X.Y.Z BASE the tag is named from. It's the one number a human sets (git can't infer
// a patch-vs-feature bump); the build number is git-derived and every package.json is stamped from this base in CI
// (release.yml), so nothing else is hand-maintained — this script just tags the base on dev.
const version: string = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version

function git(args: string[], capture = false): string {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: capture ? "pipe" : "inherit" })
  if (r.status !== 0) {
    if (capture && r.stderr) console.error(r.stderr)
    console.error(`✗ git ${args.join(" ")} failed`)
    process.exit(1)
  }
  return (r.stdout ?? "").trim()
}

// Guard rails — a release must be a clean, on-dev, not-already-tagged state, else the published version is wrong.
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], true)
if (branch !== "dev") {
  console.error(`✗ on '${branch}', not 'dev'. Releases cut from dev — merge the version bump first, then re-run.`)
  process.exit(1)
}
if (git(["status", "--porcelain"], true)) {
  console.error("✗ working tree is dirty — commit or stash before cutting a release.")
  process.exit(1)
}
git(["pull", "--ff-only", "origin", "dev"]) // be at the tip of dev, or fail (never tag a stale/diverged HEAD)
if (git(["ls-remote", "--tags", "origin", version], true)) {
  console.error(`✗ tag ${version} already exists on the remote. Bump packages/volt-desktop/package.json first.`)
  process.exit(1)
}

console.log(`• tagging ${version} on dev and pushing → triggers release.yml`)
git(["tag", version])
git(["push", "origin", version])
console.log(`\n✓ pushed tag ${version}`)
console.log("  watch: https://github.com/he-man86/volt/actions/workflows/release.yml")
