#!/usr/bin/env bun
/**
 * Volt ⇄ opencode sync — the merge-process signal flow.
 *
 * The single command to run AFTER `git fetch upstream && git merge upstream/dev`.
 * It confirms the fork still holds: deps resolve, the fork surface is unchanged,
 * the wiring is intact, and the runtime actually loads. One command, clear signals.
 *
 *     bun volt-scripts/sync.ts
 *
 * Signal flow (stops at the first ✗):
 *
 *     install ─▶ divergence ─▶ integration ─▶ lsp loads ─▶ tool loads ─▶ ✓ SYNC OK
 *      deps      4 seams        configs+bins    opencode     opencode
 *                only?          present?        runtime      runtime
 *
 * Each step is an existing, independently-runnable script — this just orchestrates
 * them into the one flow you run on every upstream merge. Exit 0 = fork holds.
 */
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

/** Run one step; print a one-line signal, and the captured output only on failure. */
function step(label: string, cmd: string, args: string[]): boolean {
  process.stdout.write(`▶ ${label} … `)
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" })
  const ok = r.status === 0
  console.log(ok ? "✓" : `✗ (exit ${r.status})`)
  if (!ok) console.log("\n" + ((r.stdout ?? "") + (r.stderr ?? "")).trim().slice(-2500) + "\n")
  return ok
}

const FLOW: [string, string, string[]][] = [
  ["install      — deps resolve (bun.lock + new upstream deps)", "bun", ["install"]],
  ["divergence   — fork surface = only the allowed seams", "bun", ["run", "volt-scripts/check-divergence.ts"]],
  ["integration  — configs / bins / wiring present", "bun", ["run", "volt-scripts/check-volt-integration.ts"]],
  ["lsp loads    — volt LSP attaches in opencode", "bun", ["volt-scripts/verify-lsp.ts"]],
  ["tool loads   — volt CLI tool registers in opencode", "bun", ["volt-scripts/verify-volt-tool.ts"]],
]

console.log("Volt ⇄ opencode sync — signal flow\n" + "─".repeat(60))
// ponytail: root listing only — verifiers scratch at repoRoot (resolve(repoRoot, ".volt-*.st")).
// Catches a step that leaves a file behind (e.g. a process.exit() that skipped its cleanup `finally`).
const rootBefore = new Set(readdirSync(repoRoot))
let ok = true
for (const [label, cmd, args] of FLOW) {
  if (!step(label, cmd, args)) {
    ok = false
    break // first ✗ is the signal — stop here
  }
}
if (ok) {
  process.stdout.write("▶ clean tree   — no verifier left a scratch file behind … ")
  const leaked = readdirSync(repoRoot).filter((f) => !rootBefore.has(f))
  if (leaked.length === 0) console.log("✓")
  else {
    console.log("✗")
    console.log("\n  a step created these at the repo root and didn't clean up:\n" + leaked.map((f) => "    " + f).join("\n") + "\n")
    ok = false
  }
}
console.log("─".repeat(60))
console.log(ok ? "✓ SYNC OK — the fork holds against upstream." : "✗ SYNC FAILED — fix the ✗ step above, then re-run.")
process.exit(ok ? 0 : 1)
