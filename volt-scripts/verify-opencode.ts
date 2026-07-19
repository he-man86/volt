#!/usr/bin/env bun
/**
 * Compat gate — prove the INSTALLED opencode still loads Volt's config layer.
 *
 * Volt is opencode-independent: opencode is a user-provided runtime, made Volt-aware ONLY by
 * `OPENCODE_CONFIG_DIR`. Both checks here ask the same question of the real binary, which is the only thing that
 * catches opencode changing its config/tool/LSP contract — no unit test can:
 *
 *   1. lsp   — a planted-error `.fb` must come back flagged by `volt-lsp-iec`
 *   2. tool  — `opencode debug agent volt` must report `tools.volt = true`   (needs a configured provider)
 *
 * Run on an opencode version bump: `bun run compat` (which also runs check-wiring.ts first), or this
 * file alone. Both checks always run — a failure in one shouldn't hide the other's result.
 *
 *   bun volt-scripts/verify-opencode.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

/** Drive the installed `opencode` against a Volt config dir. shell:true on Windows — `opencode` is a .cmd shim.
 *  Returns the streams SEPARATELY: `debug agent` prints JSON on stdout, and anything opencode writes to stderr
 *  (a Node deprecation warning, a provider notice) would corrupt a JSON.parse of the two concatenated. */
function opencode(args: string[], cfgDir: string, cwd: string): { stdout: string; stderr: string } {
  const r = spawnSync("opencode", args, {
    cwd,
    env: { ...process.env, OPENCODE_CONFIG_DIR: cfgDir },
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function report(name: string, ok: boolean, passMsg: string, failMsg: string, detail: string): boolean {
  if (ok) console.log(`✓ ${name} — ${passMsg}`)
  else {
    console.error(`✗ ${name} — ${failMsg}`)
    if (detail) console.error("  " + detail.trim().slice(0, 800).replace(/\n/g, "\n  "))
  }
  return ok
}

// ── 1. the LSP loads ──────────────────────────────────────────────────────────
// Deliberately malformed ST: a missing ';' (parse error) + an undeclared identifier 'y'. A loaded LSP MUST flag
// these. A clean file would yield {} too — indistinguishable from "not loaded" — hence the planted errors.
const MALFORMED_ST = "FUNCTION_BLOCK FB_Test\nVAR\n    x : INT\nEND_VAR\nx := y + 1;\nEND_FUNCTION_BLOCK\n"

function verifyLsp(): boolean {
  const lspBin = resolve(repoRoot, "packages/volt-lsp-iec/dist/src/bin.js")
  if (!existsSync(lspBin))
    return report("lsp ", false, "", "volt LSP not built", `run: bun --cwd packages/volt-lsp-iec run build\n${lspBin}`)

  // Scratch lives in tmpdir(), never the repo, and the finally below is the only cleanup — so nothing in this
  // try may process.exit(), which would skip it. (The retired sync.ts wrapped these runs in a repo-root
  // leak check for exactly that reason; it's unnecessary once the scratch is out of the repo and the failure
  // path is a `return`, not an exit.)
  const cfgDir = mkdtempSync(join(tmpdir(), "volt-verify-cfg-"))
  const projDir = mkdtempSync(join(tmpdir(), "volt-verify-proj-"))
  try {
    // Absolute node LSP command so it resolves with cwd = the (external) project dir — mirrors how the shipped
    // opencode-config supplies the LSP via OPENCODE_CONFIG_DIR, using the freshly-built bin.
    writeFileSync(
      join(cfgDir, "opencode.json"),
      JSON.stringify({ lsp: { "volt-lsp-iec": { command: ["node", lspBin, "--stdio"], extensions: [".fb"] } } }),
    )
    const sample = join(projDir, "verify.fb")
    writeFileSync(sample, MALFORMED_ST)
    // `debug lsp` has no --directory flag; it derives the project dir from process.cwd(). Scan BOTH streams —
    // this is a substring probe, not a parse, and opencode has printed diagnostics to either.
    const { stdout, stderr } = opencode(["debug", "lsp", "diagnostics", sample], cfgDir, projDir)
    const out = stdout + stderr
    return report(
      "lsp ",
      out.includes('"source": "volt-lsp-iec"'),
      "the installed opencode loads the volt LSP via OPENCODE_CONFIG_DIR",
      "the installed opencode did NOT load the volt LSP (opencode on PATH? dist current?)",
      out,
    )
  } finally {
    rmSync(cfgDir, { recursive: true, force: true })
    rmSync(projDir, { recursive: true, force: true })
  }
}

// ── 2. the `volt` tool loads ──────────────────────────────────────────────────
// opencode scans `{tool,tools}/*.{js,ts}` across its config dirs; Volt supplies opencode-config/tool/volt.ts via
// OPENCODE_CONFIG_DIR. `debug agent <name>` prints the resolved config including a `tools` map of id -> enabled.
// OPENCODE_CONFIG_DIR is *additive* (opencode still merges the user's global config + data-dir auth), so the
// default model still resolves.
function verifyTool(): boolean {
  const cfgDir = resolve(repoRoot, "opencode-config")
  if (!existsSync(resolve(cfgDir, "tool/volt.ts")))
    return report("tool", false, "", `opencode-config/tool/volt.ts missing under ${cfgDir}`, "")

  // Parse stdout ONLY — stderr is diagnostics, and concatenating it would break the parse on any warning.
  const { stdout, stderr } = opencode(["debug", "agent", "volt"], cfgDir, repoRoot)
  let tools: Record<string, boolean> | undefined
  try {
    tools = (JSON.parse(stdout) as { tools?: Record<string, boolean> }).tools
  } catch {
    return report(
      "tool",
      false,
      "",
      "could not parse `debug agent volt` (opencode on PATH? provider configured?)",
      stderr + stdout,
    )
  }
  return report(
    "tool",
    tools?.volt === true,
    "the 'volt' tool loads + is enabled (tools.volt = true)",
    `'volt' tool not loaded/enabled (tools.volt = ${tools?.volt}) — does opencode-config/tool/volt.ts export the tool shape?`,
    "",
  )
}

console.log("opencode compat — does the installed binary still load Volt's config?")
const lspOk = verifyLsp()
const toolOk = verifyTool()
console.log(lspOk && toolOk ? "\n✓ COMPAT OK" : "\n✗ COMPAT FAILED")
process.exit(lspOk && toolOk ? 0 : 1)
