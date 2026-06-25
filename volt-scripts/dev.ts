#!/usr/bin/env bun
/**
 * Volt dev launcher — opencode with the volt LSP loaded.
 *
 * `bun run dev` starts opencode with `--cwd packages/opencode`, so opencode's
 * project directory becomes `packages/opencode`. The volt LSP is registered in
 * `.opencode/opencode.jsonc` with a repo-root-relative command
 * (`./packages/volt-lsp-st/dist/bin.js`), which opencode resolves against the
 * project directory — so under plain `bun run dev` it never resolves and the
 * LSP silently fails to start.
 *
 * This launches the same opencode dev entry but passes the repo root as the
 * project directory, so the relative LSP command resolves and `volt-lsp-st`
 * attaches to .st files. Run from anywhere:
 *
 *   bun volt-scripts/dev.ts            # opencode TUI, volt LSP loaded
 *   bun volt-scripts/dev.ts --version  # any opencode flags pass through
 *
 * Additive by design: this lives in volt-scripts/ rather than as a root
 * package.json script, because package.json is an upstream file outside the
 * fork's allowed seams (see CLAUDE.md "Fork surface").
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const passthrough = process.argv.slice(2)

// The LSP is registered at ./packages/volt-lsp-st/dist/bin.js. If it isn't
// built, opencode starts fine but the LSP silently never attaches — guard
// against that footgun with a clear message instead of a dead .st experience.
const lspBin = resolve(repoRoot, "packages/volt-lsp-st/dist/bin.js")
if (!existsSync(lspBin)) {
  console.error(`volt LSP not built: ${lspBin}\nRun: bun --cwd packages/volt-lsp-st run build`)
  process.exit(1)
}

// `--cwd packages/opencode` matches `bun run dev`; the trailing repoRoot is
// opencode's [project] positional — opencode chdir's to it, making it the
// project dir the LSP command resolves against.
const r = spawnSync(
  "bun",
  ["run", "--cwd", "packages/opencode", "--conditions=browser", "src/index.ts", repoRoot, ...passthrough],
  { cwd: repoRoot, stdio: "inherit" },
)
process.exit(r.status ?? 1)
