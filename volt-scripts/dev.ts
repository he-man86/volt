#!/usr/bin/env bun
/**
 * Volt dev launcher — opencode with the volt LSP loaded.
 *
 * `bun run dev` starts opencode with `--cwd packages/opencode`, so opencode's
 * project directory becomes `packages/opencode`. The volt LSP is registered in
 * `.opencode/opencode.jsonc` with a repo-root-relative command
 * (`./packages/volt-lsp-codesys/dist/bin.js`), which opencode resolves against the
 * project directory — so under plain `bun run dev` it never resolves and the
 * LSP silently fails to start.
 *
 * This launches the same opencode dev entry but passes the repo root as the
 * project directory, so the relative LSP command resolves and `volt-lsp-codesys`
 * attaches to .st files. Run from anywhere:
 *
 *   bun volt-scripts/dev.ts                          # opencode TUI on the repo (volt LSP loaded)
 *   bun volt-scripts/dev.ts "C:/path/to/plc-project" # open a REAL PLC project (LSP via the global config)
 *   bun volt-scripts/dev.ts --version                # any opencode flags pass through
 *
 * Additive by design: this lives in volt-scripts/ rather than as a root
 * package.json script, because package.json is an upstream file outside the
 * fork's allowed seams (see CLAUDE.md "Fork surface").
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const args = process.argv.slice(2)

// Optional first arg: the project directory to open. Point dev-opencode at a REAL PLC project to watch
// the volt LSP attach to its .st files — there the LSP comes from the GLOBAL config that `volt setup`
// writes. With no dir, default to the repo root, where `.opencode`'s repo-relative LSP command resolves.
const hasDir = args[0] !== undefined && !args[0].startsWith("-") && existsSync(args[0])
const projectDir = hasDir ? resolve(args[0]!) : repoRoot
const passthrough = hasDir ? args.slice(1) : args

// Opening the repo itself uses the repo-relative dist LSP — guard it's built, else opencode starts fine
// but the LSP silently never attaches. An external PLC project uses the global (volt setup) binary, so
// this guard doesn't apply there.
const lspBin = resolve(repoRoot, "packages/volt-lsp-codesys/dist/bin.js")
if (projectDir === repoRoot && !existsSync(lspBin)) {
  console.error(`volt LSP not built: ${lspBin}\nRun: bun --cwd packages/volt-lsp-codesys run build`)
  process.exit(1)
}

// `--cwd packages/opencode` matches `bun run dev`; the trailing projectDir is opencode's [project]
// positional — opencode chdir's to it, making it the project dir LSPs attach against.
const r = spawnSync(
  "bun",
  ["run", "--cwd", "packages/opencode", "--conditions=browser", "src/index.ts", projectDir, ...passthrough],
  { cwd: repoRoot, stdio: "inherit" },
)
process.exit(r.status ?? 1)
