#!/usr/bin/env bun
/**
 * One command to sync with upstream opencode: fetch → branch → merge → verify.
 *
 *     bun volt-scripts/merge-upstream.ts
 *
 * Creates a dated `sync/upstream-dev-<date>` branch off the current tip, merges
 * `upstream/dev`, then runs the `sync.ts` signal flow. Stops cleanly on conflicts
 * (you resolve + commit, then run `bun volt-scripts/sync.ts`). On success it prints the
 * one fast-forward to land the sync on your integration branch — it does NOT move/push
 * your branch for you.
 *
 * (Lives in volt-scripts/, not a `bun run` script: package.json is an upstream file
 * outside the fork's allowed seams — see CLAUDE.md "Fork surface".)
 */
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const UPSTREAM = "upstream/dev"
const LAND = process.argv.includes("--land") // on green: fast-forward + push + prune

const git = (args: string[]) => spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" })
const run = (label: string, cmd: string, args: string[]) => {
  process.stdout.write(`▶ ${label}\n`)
  return spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" }).status === 0
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()

// 1. fetch
if (!run("git fetch upstream", "git", ["fetch", "upstream"])) process.exit(1)

// up to date?
const behind = git(["rev-list", "--count", `HEAD..${UPSTREAM}`]).stdout.trim()
if (behind === "0") {
  console.log(`✓ already up to date with ${UPSTREAM} — nothing to merge.`)
  process.exit(0)
}
console.log(`  ${behind} commit(s) behind ${UPSTREAM}.`)

// 2. dated sync branch off the current tip (don't dirty the integration branch)
const date = new Date().toISOString().slice(0, 10)
let name = `sync/upstream-dev-${date}`
for (let n = 2; git(["rev-parse", "--verify", "--quiet", name]).status === 0; n++) name = `sync/upstream-dev-${date}-${n}`
if (!run(`git switch -c ${name}  (off ${branch})`, "git", ["switch", "-c", name])) process.exit(1)

// 3. merge — stop cleanly on conflict
if (!run(`git merge --no-edit ${UPSTREAM}`, "git", ["merge", "--no-edit", UPSTREAM])) {
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
  console.log(`✓ Synced on ${name}. To land it on ${branch}:`)
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
for (const b of git(["branch", "--merged", branch]).stdout.split("\n").map((s) => s.trim()).filter((b) => b.startsWith("sync/upstream-dev-"))) {
  spawnSync("git", ["branch", "-d", b], { cwd: repoRoot }) // -d is safe: refuses unmerged
}
console.log(`✓ Landed on ${branch} and pushed; merged sync branches pruned.`)
process.exit(0)
