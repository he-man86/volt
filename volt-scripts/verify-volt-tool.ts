#!/usr/bin/env bun
/**
 * Compat gate — prove the `volt` custom tool loads in the INSTALLED opencode. Companion to verify-lsp.ts.
 *
 * opencode scans `{tool,tools}/*.{js,ts}` across its config directories; Volt supplies `volt-config/tool/volt.ts`
 * via `OPENCODE_CONFIG_DIR`. `opencode debug agent <name>` prints the agent's resolved config including a `tools`
 * map of id -> enabled; we assert `tools.volt === true`. OPENCODE_CONFIG_DIR is *additive* (opencode still merges
 * the user's global config + data-dir auth), so the default model still resolves.
 *
 * Run from anywhere:  bun volt-scripts/verify-volt-tool.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

const configDir = resolve(repoRoot, "volt-config")
if (!existsSync(resolve(configDir, "tool/volt.ts"))) {
  console.error(`✗ volt-config/tool/volt.ts missing under ${configDir}`)
  process.exit(1)
}

// Installed opencode + OPENCODE_CONFIG_DIR = volt-config (where the tool + `volt` agent live).
const r = spawnSync("opencode", ["debug", "agent", "volt"], {
  cwd: repoRoot,
  env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
  encoding: "utf8",
  shell: process.platform === "win32", // `opencode` on Windows is a .cmd shim
})

const stdout = r.stdout ?? ""
let agent: { tools?: Record<string, boolean> }
try {
  agent = JSON.parse(stdout)
} catch {
  console.error("✗ FAIL — could not parse `debug agent volt` output (opencode on PATH? model/provider configured?).")
  console.error(((r.stderr ?? "") + stdout).trim().slice(0, 1000))
  process.exit(1)
}

if (agent.tools?.volt === true) {
  console.log("✓ PASS — the 'volt' tool loads + is enabled in the installed opencode (tools.volt = true).")
  process.exit(0)
}
console.error(`✗ FAIL — 'volt' tool not loaded/enabled (tools.volt = ${agent.tools?.volt}).`)
console.error("  Check volt-config/tool/volt.ts exists and exports a default tool().")
process.exit(1)
