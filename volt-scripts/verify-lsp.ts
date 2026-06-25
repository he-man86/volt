#!/usr/bin/env bun
/**
 * Verify the volt LSP actually loads inside opencode — end-to-end, non-interactively.
 *
 * Why this exists: opencode registers the LSP from `.opencode/opencode.jsonc`
 * but spawns it *lazily* (on first matching-file open), with `cwd = the project
 * directory`, and logs nothing on spawn failure. So "is the LSP actually
 * working?" is otherwise invisible — it either silently works or silently doesn't.
 *
 * This drives opencode's own `debug lsp diagnostics` command against a
 * deliberately-malformed `.st` file:
 *   - LSP loaded   -> diagnostics tagged `source: "volt-lsp-st"`.
 *   - LSP not loaded -> opencode returns `{}` (the exact silent failure you hit
 *     under `bun run dev`, where cwd is forced to packages/opencode and the
 *     repo-root-relative LSP command can't resolve).
 *
 * Run from anywhere:  bun volt-scripts/verify-lsp.ts
 * See packages/volt-lsp-st/ADDING-A-NEW-LSP.md for the why behind the cwd rule.
 */
import { spawnSync } from "node:child_process"
import { existsSync, writeFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

const lspBin = resolve(repoRoot, "packages/volt-lsp-st/dist/bin.js")
if (!existsSync(lspBin)) {
  console.error(`✗ volt LSP not built: ${lspBin}\n  Run: bun --cwd packages/volt-lsp-st run build`)
  process.exit(1)
}

// Deliberately malformed ST: a missing ';' (parse error) plus an undeclared
// identifier 'y'. A loaded LSP MUST flag these. (A *clean* file would yield {}
// too — indistinguishable from "not loaded" — hence the planted errors.)
// Must live inside the repo: opencode's `debug lsp` only analyzes files within
// the project dir. Gitignored so an interrupted run can't leave a committable file.
const sample = resolve(repoRoot, ".volt-lsp-verify.st")
writeFileSync(sample, "FUNCTION_BLOCK FB_Test\nVAR\n    x : INT\nEND_VAR\nx := y + 1;\nEND_FUNCTION_BLOCK\n")

try {
  // cwd = repoRoot so the repo-root-relative LSP command in
  // .opencode/opencode.jsonc resolves. `debug lsp` has no --directory flag; it
  // derives the project dir from process.cwd() (cli/effect-cmd.ts).
  const r = spawnSync(
    "bun",
    ["--conditions=browser", "packages/opencode/src/index.ts", "debug", "lsp", "diagnostics", sample],
    { cwd: repoRoot, encoding: "utf8" },
  )
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  if (out.includes('"source": "volt-lsp-st"')) {
    console.log("✓ PASS — volt LSP loaded and produced diagnostics:")
    console.log((r.stdout ?? "").trim())
    process.exit(0)
  }
  console.error("✗ FAIL — volt LSP did not load (no volt-lsp-st diagnostics returned).")
  console.error("  Likely cause: opencode's project dir isn't the repo root, or packages/volt-lsp-st/dist is stale.")
  console.error(out.trim().slice(0, 1000))
  process.exit(1)
} finally {
  rmSync(sample, { force: true })
}
