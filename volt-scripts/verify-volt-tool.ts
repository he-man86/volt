#!/usr/bin/env bun
/**
 * Verify the `volt` custom tool is loaded and available to opencode's agent —
 * non-interactively. Companion to verify-lsp.ts (which checks the LSP).
 *
 * opencode auto-discovers `.opencode/tool/volt.ts` (packages/opencode/src/tool/
 * registry.ts). `opencode debug agent <name>` prints the agent's resolved config
 * including a `tools` map of id -> enabled. We assert `tools.volt === true`.
 *
 * This proves the tool LOADED. Executing a verb end-to-end (e.g. `volt status`)
 * additionally needs a live bridge + bound workspace — covered by volt-cli tests.
 *
 * Run from anywhere:  bun volt-scripts/verify-volt-tool.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

const voltBin = resolve(repoRoot, "packages/volt-git/dist/bin.js")
if (!existsSync(voltBin)) {
  console.error(`✗ volt CLI not built: ${voltBin}\n  Run: bun --cwd packages/volt-cli run build`)
  process.exit(1)
}

// cwd = repoRoot so opencode loads this project's .opencode/ (where the tool and
// the `volt` agent live). `debug agent` resolves a default model, so a provider
// must be configured (it is in the dev env).
const r = spawnSync("bun", ["--conditions=browser", "packages/opencode/src/index.ts", "debug", "agent", "volt"], {
  cwd: repoRoot,
  encoding: "utf8",
})

const stdout = r.stdout ?? ""
let agent: { tools?: Record<string, boolean> }
try {
  agent = JSON.parse(stdout)
} catch {
  console.error("✗ FAIL — could not parse `debug agent volt` output (model/provider not configured?).")
  console.error(((r.stderr ?? "") + stdout).trim().slice(0, 1000))
  process.exit(1)
}

if (agent.tools?.volt === true) {
  console.log("✓ PASS — the 'volt' tool is loaded and enabled for the agent (tools.volt = true).")
  process.exit(0)
}
console.error(`✗ FAIL — 'volt' tool not loaded/enabled (tools.volt = ${agent.tools?.volt}).`)
console.error("  Check .opencode/tool/volt.ts exists and exports a default tool().")
process.exit(1)
