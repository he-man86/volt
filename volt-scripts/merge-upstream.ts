#!/usr/bin/env bun
/**
 * One command to sync with upstream opencode's latest RELEASE — fetch tags → branch → merge → verify.
 *
 *     bun volt-scripts/merge-upstream.ts            # newest v<current-major>.* release tag
 *     bun volt-scripts/merge-upstream.ts v1.18.0    # a specific tag (or v2.0.0 to opt into a new major)
 *
 * Volt tracks opencode's prod-ready *releases* (tags like v1.17.11), NOT its moving `dev` trunk. By default it
 * resolves the newest tag within the CURRENT major (held back from a breaking new major until you name it).
 * Creates a dated `sync/upstream-<tag>-<date>` branch off the current tip, merges the tag, then runs the
 * `sync.ts` signal flow. Stops cleanly on conflicts (resolve + commit, then `bun volt-scripts/sync.ts`). On
 * green it prints the one fast-forward to land — it does NOT move/push your branch for you.
 *
 * (Lives in volt-scripts/, not a `bun run` script: package.json is an upstream file outside the fork's
 * allowed seams — see CLAUDE.md "Fork surface".)
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const LAND = process.argv.includes("--land") // on green: fast-forward + push + prune

const git = (args: string[]) => spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" })
const run = (label: string, cmd: string, args: string[]) => {
  process.stdout.write(`▶ ${label}\n`)
  return spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" }).status === 0
}

// Released tags only (plain vX.Y.Z), sorted semver-correct so v1.17.10 ranks above v1.17.9 (not lexical).
const SEMVER = /^v\d+\.\d+\.\d+$/
const key = (t: string) => t.slice(1).split(".").map(Number)
const tags = (pattern: string) =>
  git(["ls-remote", "--tags", "--refs", "upstream", pattern])
    .stdout.split("\n")
    .map((l) => l.split("/").pop()?.trim() ?? "")
    .filter((t) => SEMVER.test(t))
    .sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || key(a)[2] - key(b)[2])

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()
const ocVersion = JSON.parse(readFileSync(resolve(repoRoot, "packages/opencode/package.json"), "utf8")).version as string
const major = ocVersion.split(".")[0]
// Target: an explicit tag arg (e.g. v1.18.0 / 2.0.0), else the newest tag within the current major.
const pinned = process.argv.slice(2).find((a) => SEMVER.test(a) || /^\d+\.\d+\.\d+$/.test(a))

// 1. fetch — incl. tags (plain `git fetch` only auto-follows tags on reachable commits; be explicit).
if (!run("git fetch --tags upstream", "git", ["fetch", "--tags", "upstream"])) process.exit(1)

const TARGET = pinned ? (pinned.startsWith("v") ? pinned : `v${pinned}`) : tags(`v${major}.*`).at(-1)
if (!TARGET) {
  console.error(`✗ no release tag matching v${major}.* found on upstream.`)
  process.exit(1)
}
console.log(`  target: ${TARGET}  (opencode pkg is ${ocVersion}; ${pinned ? "pinned" : `newest v${major}.x`})`)

// Heads-up only — we hold at the current major by default; a new major must be named explicitly.
if (!pinned) {
  const newest = tags("v*").at(-1)
  if (newest && key(newest)[0] > Number(major))
    console.log(`  ℹ newer major available: ${newest} — opt in explicitly: bun volt-scripts/merge-upstream.ts ${newest}`)
}

// up to date?
const behind = git(["rev-list", "--count", `HEAD..${TARGET}`]).stdout.trim()
if (behind === "0") {
  console.log(`✓ already up to date with ${TARGET} — nothing to merge.`)
  process.exit(0)
}
console.log(`  ${behind} commit(s) behind ${TARGET}.`)

// 2. dated sync branch off the current tip (don't dirty the integration branch)
const date = new Date().toISOString().slice(0, 10)
let name = `sync/upstream-${TARGET}-${date}`
for (let n = 2; git(["rev-parse", "--verify", "--quiet", name]).status === 0; n++) name = `sync/upstream-${TARGET}-${date}-${n}`
if (!run(`git switch -c ${name}  (off ${branch})`, "git", ["switch", "-c", name])) process.exit(1)

// 3. merge the tag — stop cleanly on conflict (merging a tag is a normal two-parent merge)
if (!run(`git merge --no-edit ${TARGET}`, "git", ["merge", "--no-edit", TARGET])) {
  const conflicts = git(["diff", "--name-only", "--diff-filter=U"]).stdout.trim()
  console.error(`\n✗ merge conflicts — resolve, commit, then run: bun volt-scripts/sync.ts`)
  if (conflicts) console.error("  conflicted:\n" + conflicts.split("\n").map((f) => "    " + f).join("\n"))
  console.error(`  to abort: git merge --abort && git switch ${branch} && git branch -D ${name}`)
  process.exit(1)
}

// 4. verify (the signal flow)
console.log("")
const ok = run("bun volt-scripts/sync.ts", "bun", ["volt-scripts/sync.ts"])
console.log("\n" + "─".repeat(60))
if (!ok) {
  console.log(`✗ sync checks failed on ${name} — investigate before landing.`)
  process.exit(1)
}

if (!LAND) {
  console.log(`✓ Synced to ${TARGET} on ${name}. To land it on ${branch}:`)
  console.log(`    git switch ${branch} && git merge --ff-only ${name} && git push   (or re-run with --land)`)
  process.exit(0)
}

// --land: fast-forward the integration branch, push, then prune merged sync branches.
const landed =
  run(`git switch ${branch}`, "git", ["switch", branch]) &&
  run(`git merge --ff-only ${name}`, "git", ["merge", "--ff-only", name]) &&
  run("git push", "git", ["push"])
if (!landed) {
  console.log(`✗ landing failed — finish manually (sync branch ${name} is intact).`)
  process.exit(1)
}
for (const b of git(["branch", "--merged", branch]).stdout.split("\n").map((s) => s.trim()).filter((b) => b.startsWith("sync/upstream-"))) {
  spawnSync("git", ["branch", "-d", b], { cwd: repoRoot }) // -d is safe: refuses unmerged
}
console.log(`✓ Landed ${TARGET} on ${branch} and pushed; merged sync branches pruned.`)
process.exit(0)
