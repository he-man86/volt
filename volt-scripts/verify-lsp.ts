#!/usr/bin/env bun
/**
 * Compat gate — prove the volt LSP loads inside the INSTALLED opencode, end-to-end, non-interactively.
 *
 * Volt is opencode-independent: opencode is a user-provided runtime, made Volt-aware only by
 * `OPENCODE_CONFIG_DIR`. This drives the installed `opencode` binary (on PATH) against a config dir that
 * registers the freshly-built volt LSP, on a deliberately-malformed `.fb`. A loaded LSP flags it
 * (`source: "volt-lsp-iec"`); a missing one returns `{}` (the exact silent failure).
 *
 * Run on each opencode version bump (the "does the current opencode still load our config?" gate).
 * Run from anywhere:  bun volt-scripts/verify-lsp.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

const lspBin = resolve(repoRoot, "packages/volt-lsp-iec/dist/src/bin.js")
if (!existsSync(lspBin)) {
  console.error(`✗ volt LSP not built: ${lspBin}\n  Run: bun --cwd packages/volt-lsp-iec run build`)
  process.exit(1)
}

// Deliberately malformed ST: a missing ';' (parse error) + an undeclared identifier 'y'. A loaded LSP MUST
// flag these. (A clean file would yield {} too — indistinguishable from "not loaded" — hence the planted errors.)
const MALFORMED_ST = "FUNCTION_BLOCK FB_Test\nVAR\n    x : INT\nEND_VAR\nx := y + 1;\nEND_FUNCTION_BLOCK\n"

const cfgDir = mkdtempSync(join(tmpdir(), "volt-verify-cfg-"))
const projDir = mkdtempSync(join(tmpdir(), "volt-verify-proj-"))
const sample = join(projDir, "verify.fb")
let ok = false
try {
  // Absolute node LSP command so it resolves with cwd = the (external) project dir — mirrors how the shipped
  // volt-config supplies the LSP via OPENCODE_CONFIG_DIR, using the freshly-built bin.
  writeFileSync(
    join(cfgDir, "opencode.json"),
    JSON.stringify({ lsp: { "volt-lsp-iec": { command: ["node", lspBin, "--stdio"], extensions: [".fb"] } } }),
  )
  writeFileSync(sample, MALFORMED_ST)
  // `debug lsp` has no --directory flag; it derives the project dir from process.cwd().
  const r = spawnSync("opencode", ["debug", "lsp", "diagnostics", sample], {
    cwd: projDir,
    env: { ...process.env, OPENCODE_CONFIG_DIR: cfgDir },
    encoding: "utf8",
    shell: process.platform === "win32", // `opencode` on Windows is a .cmd shim
  })
  const out = (r.stdout ?? "") + (r.stderr ?? "")
  ok = out.includes('"source": "volt-lsp-iec"')
  if (ok) console.log("✓ PASS — the installed opencode loads the volt LSP via OPENCODE_CONFIG_DIR")
  else {
    console.error("✗ FAIL — the installed opencode did NOT load the volt LSP via OPENCODE_CONFIG_DIR")
    console.error("  Is `opencode` on PATH? Is packages/volt-lsp-iec/dist current?")
    console.error(out.trim().slice(0, 800))
  }
} finally {
  rmSync(cfgDir, { recursive: true, force: true })
  rmSync(projDir, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
