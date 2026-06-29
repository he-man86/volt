#!/usr/bin/env bun
/**
 * Desktop / consumer-project verification — does the volt LSP + `volt` tool load when opencode opens a
 * REAL PLC project, not the Volt dev repo?
 *
 * The desktop app embeds the same opencode server (sidecar → virtual:opencode-server) and opens the
 * user's workspace as the project dir. LSP/tool loading is per-PROJECT (config discovery + path
 * resolution), NOT per-host — so this models the desktop faithfully by pointing the same opencode core
 * at a throwaway consumer project OUTSIDE the repo: no `.opencode/`, no `packages/`, exactly like a
 * TwinCAT/CODESYS workspace. (The CLI `verify-lsp`/`verify-volt-tool` run with the *repo* as project
 * dir, so they only prove the repo case.)
 *
 * EXPECTED TO FAIL TODAY. The volt LSP/tool are registered only in the repo's `.opencode/`, and the LSP
 * command is a repo-relative path. This is the acceptance test for the `wire-lsp-for-agent` change: it
 * goes green once `volt init` wires a resolvable LSP + tool into a consumer project's opencode config.
 *
 *     bun volt-scripts/verify-desktop.ts
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const cli = resolve(repoRoot, "packages/opencode/src/index.ts")

// A throwaway consumer PLC project OUTSIDE the repo (so the repo's .opencode/ is unreachable, as for a
// real user's workspace). One .st file that the volt LSP *would* flag (undefined `y`) if it loaded.
const project = mkdtempSync(join(tmpdir(), "volt-consumer-"))
const sample = join(project, "Sample.st")
writeFileSync(sample, "FUNCTION_BLOCK FB_Test\nVAR\n    x : INT\nEND_VAR\nx := y + 1;\nEND_FUNCTION_BLOCK\n")

// opencode derives the project dir from cwd — point it at the consumer project, exactly as the desktop
// opens the user's workspace.
const run = (args: string[]) =>
  spawnSync("bun", ["--conditions=browser", cli, ...args], { cwd: project, encoding: "utf8" })

let lspOk = false
let toolOk = false
try {
  const lsp = run(["debug", "lsp", "diagnostics", sample])
  lspOk = ((lsp.stdout ?? "") + (lsp.stderr ?? "")).includes('"source": "volt-lsp-codesys"')

  // Check a BUILT-IN agent ("build", opencode's default) — a custom tool surfaces in every agent's tool
  // map. (Not `debug agent volt`: the volt *agent* is repo-local, so it wouldn't resolve here.)
  const tool = run(["debug", "agent", "build"])
  try {
    toolOk = (JSON.parse(tool.stdout ?? "{}") as { tools?: Record<string, boolean> }).tools?.volt === true
  } catch {
    toolOk = false
  }
} finally {
  rmSync(project, { recursive: true, force: true })
}

console.log("Desktop / consumer-project verification — volt LSP + tool for a real PLC project")
console.log("(same opencode core the desktop embeds; the user's workspace as the project dir)")
console.log("─".repeat(64))
console.log(`▶ volt LSP attaches   … ${lspOk ? "✓" : "✗"}`)
console.log(`▶ volt tool registers … ${toolOk ? "✓" : "✗"}`)
console.log("─".repeat(64))
if (lspOk && toolOk) {
  console.log("✓ DESKTOP OK — the volt LSP + tool load for a real PLC project.")
  process.exit(0)
}
console.log("✗ NOT WIRED — a consumer PLC project gets no volt LSP/tool; the agent edits ST blind.")
console.log("  EXPECTED until `wire-lsp-for-agent` lands: `volt init` must register a resolvable LSP +")
console.log("  tool in the consumer project's opencode config. This is that change's acceptance test.")
process.exit(1)
