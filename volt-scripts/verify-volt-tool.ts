#!/usr/bin/env bun
/**
 * Verify the `volt` custom tool is loaded and available to opencode's agent —
 * non-interactively. Companion to verify-lsp.ts (which checks the LSP).
 *
 * opencode scans `{tool,tools}/*.{js,ts}` across `config.directories()` (tool/registry.ts) — in dev that
 * finds `.opencode/tool/volt.ts`; the shipped product supplies it as `volt-config/tool/volt.js` via
 * `OPENCODE_CONFIG_DIR`. `opencode debug agent <name>` prints the agent's resolved config including a
 * `tools` map of id -> enabled; we assert `tools.volt === true`.
 *
 * Scope: this exercises the dev auto-discovery path in the main process. Unlike verify-lsp.ts, it can't add
 * an OPENCODE_CONFIG_DIR-isolated phase — `debug agent` resolves a default model, and OPENCODE_CONFIG_DIR
 * replaces the global config dir (where the provider auth lives), so the agent would fail to resolve. The
 * tool's two silent-regression risks are guarded at the source in check-volt-integration.ts instead: the
 * "worker-env seam" (a merge stripping the tool from the terminal TUI worker) and the "volt-config dir"
 * guard (the tool shipping in volt-config).
 *
 * This proves the tool LOADED. Executing a verb end-to-end (e.g. `volt status`)
 * additionally needs a live bridge + bound workspace — covered by volt-git tests.
 *
 * Run from anywhere:  bun volt-scripts/verify-volt-tool.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

const voltBin = resolve(repoRoot, "packages/volt-git/dist/bin.js")
if (!existsSync(voltBin)) {
  console.error(`✗ volt CLI not built: ${voltBin}\n  Run: bun --cwd packages/volt-git run build`)
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
