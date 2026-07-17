#!/usr/bin/env bun
/**
 * Cut a Volt release with one command: tag the current packages/volt-desktop/package.json version and push the
 * tag, which triggers release.yml to build (dotnet + Inno on windows-latest) and publish Volt-win-Setup.exe to
 * GitHub Releases. No local .NET SDK / Inno Setup needed — CI does the build.
 *
 *   bun run release        # tag <version> on dev + push → CI builds + publishes
 *
 * Steady-state flow: bump packages/volt-desktop/package.json in your feature PR, merge to dev, then `bun run
 * release`. (dev is protected, so the version bump rides a PR; the tag itself bypasses branch protection.)
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const version: string = (await import(resolve(repo, "packages/volt-desktop/package.json"))).default.version
// Volt ships ONE version. volt-desktop is the source of truth (it names the tag + the release); the .vsix the
// installer sideloads must carry the same number. release.yml guards this too — a tag can be pushed by hand,
// bypassing this script — but failing here is cheaper than failing after the tag is already on the remote.
const extVersion: string = (await import(resolve(repo, "packages/volt-vscode/package.json"))).default.version

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
if (extVersion !== version) {
  console.error(`✗ volt-vscode ${extVersion} != volt-desktop ${version}. Volt ships one version — bump both.`)
  process.exit(1)
}
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
