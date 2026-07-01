#!/usr/bin/env bun
/**
 * Verify the volt LSP actually loads inside opencode — end-to-end, non-interactively — via BOTH config paths:
 *
 *   1. dev auto-discovery: opencode finds the repo's `.opencode/opencode.json` from cwd (how this repo +
 *      `bun volt-scripts/dev.ts` run).
 *   2. shipped path: opencode loads the LSP from `OPENCODE_CONFIG_DIR` for a project that has NO `.opencode`
 *      of its own — the unify model the installed product uses (config ships in `volt-config`, not per-project).
 *      Phase 1 alone would stay green even if OPENCODE_CONFIG_DIR were ignored, so this phase is the real guard.
 *
 * opencode spawns the LSP *lazily* (on first matching-file open) with `cwd = the project dir`, and logs nothing
 * on spawn failure — so "is it actually working?" is otherwise invisible. Each phase drives opencode's own
 * `debug lsp diagnostics` against a deliberately-malformed `.st`: a loaded LSP flags it (`source:
 * "volt-lsp-codesys"`); a missing one returns `{}` (the exact silent failure).
 *
 * Scope: this runs in DEV (bun, source), so it cannot reproduce the compiled binary's Bun-worker env-snapshot
 * bug (the terminal TUI worker losing OPENCODE_CONFIG_DIR — main-process checks like this one pass regardless).
 * That regression is guarded at the source in check-volt-integration.ts ("worker-env seam").
 *
 * Run from anywhere:  bun volt-scripts/verify-lsp.ts
 * See packages/volt-lsp-codesys/README.md ("Running inside opencode") for the cwd rule.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")
const ocEntry = resolve(repoRoot, "packages/opencode/src/index.ts")

const lspBin = resolve(repoRoot, "packages/volt-lsp-codesys/dist/bin.js")
if (!existsSync(lspBin)) {
  console.error(`✗ volt LSP not built: ${lspBin}\n  Run: bun --cwd packages/volt-lsp-codesys run build`)
  process.exit(1)
}

// Deliberately malformed ST: a missing ';' (parse error) + an undeclared identifier 'y'. A loaded LSP MUST
// flag these. (A clean file would yield {} too — indistinguishable from "not loaded" — hence the planted errors.)
const MALFORMED_ST = "FUNCTION_BLOCK FB_Test\nVAR\n    x : INT\nEND_VAR\nx := y + 1;\nEND_FUNCTION_BLOCK\n"

// `debug lsp` has no --directory flag; it derives the project dir from process.cwd(). Returns whether
// volt-lsp-codesys produced diagnostics (i.e. the LSP loaded + spawned + analyzed the file).
function lspLoads(sampleFile: string, cwd: string, env: NodeJS.ProcessEnv): { ok: boolean; out: string } {
  const r = spawnSync("bun", ["--conditions=browser", ocEntry, "debug", "lsp", "diagnostics", sampleFile], {
    cwd,
    env,
    encoding: "utf8",
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  return { ok: out.includes('"source": "volt-lsp-codesys"'), out }
}

let failed = false

// ── Phase 1: dev auto-discovery (repo .opencode found from cwd) ──
{
  // Must live inside the repo: `debug lsp` only analyzes files within the project dir. Gitignored so an
  // interrupted run can't leave a committable file.
  const sample = resolve(repoRoot, ".volt-lsp-verify.st")
  writeFileSync(sample, MALFORMED_ST)
  try {
    const { ok, out } = lspLoads(sample, repoRoot, process.env)
    if (ok) console.log("✓ PASS — LSP loads via dev .opencode auto-discovery")
    else {
      failed = true
      console.error("✗ FAIL — LSP did not load via dev .opencode auto-discovery")
      console.error("  Likely cause: cwd isn't the repo root, or packages/volt-lsp-codesys/dist is stale.")
      console.error(out.trim().slice(0, 800))
    }
  } finally {
    rmSync(sample, { force: true }) // process.exit() skips finally — so exit AFTER cleanup
  }
}

// ── Phase 2: shipped path — LSP from OPENCODE_CONFIG_DIR, project has NO .opencode of its own ──
{
  const cfgDir = mkdtempSync(join(tmpdir(), "volt-verify-cfg-"))
  const projDir = mkdtempSync(join(tmpdir(), "volt-verify-proj-"))
  const sample = join(projDir, "verify.st")
  try {
    // Absolute node LSP command so it resolves with cwd = the (external) project dir. Mirrors how the shipped
    // volt-config supplies the LSP via OPENCODE_CONFIG_DIR — except the project itself carries no .opencode.
    writeFileSync(
      join(cfgDir, "opencode.json"),
      JSON.stringify({ lsp: { "volt-lsp-codesys": { command: ["node", lspBin, "--stdio"], extensions: [".st"] } } }),
    )
    writeFileSync(sample, MALFORMED_ST)
    const { ok, out } = lspLoads(sample, projDir, { ...process.env, OPENCODE_CONFIG_DIR: cfgDir })
    if (ok) console.log("✓ PASS — LSP loads via OPENCODE_CONFIG_DIR (shipped path; project has no .opencode)")
    else {
      failed = true
      console.error("✗ FAIL — LSP did not load via OPENCODE_CONFIG_DIR — the shipped unify path is broken")
      console.error(out.trim().slice(0, 800))
    }
  } finally {
    rmSync(cfgDir, { recursive: true, force: true })
    rmSync(projDir, { recursive: true, force: true })
  }
}

process.exit(failed ? 1 : 0)
