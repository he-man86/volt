/**
 * REAL end-to-end diagnostics: collectDiagnostics SPAWNS the actual volt-lsp-iec server (the same path the desktop
 * takes) and drives a full initialize → eager workspace crawl → workspace/diagnostic round-trip against fixture
 * files on disk. The server's own tests use an IN-PROCESS client, and the installer only checks the exe prints
 * `--version` — so this is the only coverage that the SPAWN + protocol wiring actually answers a request. A wedged
 * server, a broken crawl, or a collector regression fails here instead of as a silent 30s timeout in the app.
 *
 * Run from packages/volt-control:  bun run test:e2e
 * Builds the LSP dev server if it isn't built yet; skips cleanly if that build can't run.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { collectDiagnostics, setLspServer } from "../../src/index.js"

const LSP_DIR = resolve(import.meta.dir, "..", "..", "..", "volt-lsp-iec")
const SERVER = join(LSP_DIR, "dist", "src", "bin.js")

let ready = false
let dir = ""
beforeAll(() => {
  if (!existsSync(SERVER)) {
    const r = spawnSync("bun", ["run", "build"], { cwd: LSP_DIR, stdio: "inherit", shell: process.platform === "win32" })
    if (r.status !== 0 || !existsSync(SERVER)) {
      console.warn("⚠ diagnostics e2e skipped — couldn't build volt-lsp-iec (dist/src/bin.js)")
      return
    }
  }
  setLspServer(SERVER)
  dir = mkdtempSync(join(tmpdir(), "volt-diag-e2e-"))
  ready = true
})
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test("collectDiagnostics spawns the server and reports a type error in an UNOPENED file", async () => {
  if (!ready) return // see the beforeAll warning
  // `i := b` assigns a BOOL to an INT — a type error the eager crawl must find without the file being opened.
  writeFileSync(join(dir, "F.fb"), "FUNCTION_BLOCK F\nVAR\n b : BOOL; i : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK")
  const r = await collectDiagnostics(dir, "codesys", { timeoutMs: 20_000 })
  expect(r.errors).toBeGreaterThanOrEqual(1)
  expect(r.files.some((f) => f.path.endsWith("F.fb"))).toBe(true)
})

test("collectDiagnostics reports no errors for a clean workspace", async () => {
  if (!ready) return
  const clean = mkdtempSync(join(tmpdir(), "volt-diag-e2e-clean-"))
  writeFileSync(join(clean, "G.fb"), "FUNCTION_BLOCK G\nVAR\n x : INT;\nEND_VAR\nx := 1;\nEND_FUNCTION_BLOCK")
  try {
    const r = await collectDiagnostics(clean, "codesys", { timeoutMs: 20_000 })
    expect(r.errors).toBe(0)
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})
