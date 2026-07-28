#!/usr/bin/env bun
/**
 * Compat gate — prove the INSTALLED opencode still loads Volt's config layer.
 *
 * Volt is opencode-independent: opencode is a user-provided runtime, made Volt-aware ONLY by
 * `OPENCODE_CONFIG_DIR`. Both checks here ask the same question of the real binary, which is the only thing that
 * catches opencode changing its config/tool/LSP contract — no unit test can:
 *
 *   1. lsp   — a planted-error `.fb` must come back flagged by `volt-lsp-iec`
 *   2. tool  — `opencode debug agent build` must report `tools.volt = true` AND `permission volt = ask`
 *   3. wire  — a live `opencode serve` still prints a parseable URL and serves its GUI, which is what the desktop
 *              points its WebContentsView at. (No provider needed. The GUI ROUTE the binding reads is covered by
 *              volt-desktop/test/e2e/opencode-binding.test.ts, which drives the real GUI over CDP.)
 *
 * Run on an opencode version bump: `bun run compat` (which also runs check-wiring.ts first), or this
 * file alone. All checks always run — a failure in one shouldn't hide the others' result.
 *
 *   bun volt-scripts/verify-opencode.ts
 */
import { spawn, spawnSync } from "node:child_process"
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

  // Ask the DEFAULT agent (`build`), not a Volt-specific one: Volt ships no agent of its own any more, and the
  // point is precisely that the tool is loaded and GATED in whatever agent the user is in.
  // Parse stdout ONLY — stderr is diagnostics, and concatenating it would break the parse on any warning.
  const { stdout, stderr } = opencode(["debug", "agent", "build"], cfgDir, repoRoot)
  let agent: { tools?: Record<string, boolean>; permission?: { permission: string; action: string }[] } | undefined
  try {
    agent = JSON.parse(stdout) as typeof agent
  } catch {
    return report("tool", false, "", "could not parse `debug agent build` (opencode on PATH? provider configured?)", stderr + stdout)
  }
  const loaded = agent?.tools?.volt === true
  // …and that a mutating verb still PROMPTS. The tool asks under the `volt` permission, which is NOT covered by the
  // `bash` rules — so with no `permission.volt` in opencode.json it fell through to opencode's default `*: allow`
  // and `volt push` ran unattended in Build/Plan. That silence is the failure this asserts against.
  const gated = agent?.permission?.some((p) => p.permission === "volt" && p.action === "ask") === true
  return report(
    "tool",
    loaded && gated,
    "the 'volt' tool loads (tools.volt = true) and its mutating verbs are gated (permission volt = ask)",
    `'volt' tool loaded=${loaded} gated=${gated} — loaded needs opencode-config/tool/volt.ts to export the tool shape; gated needs "permission": { "volt": "ask" } in opencode-config/opencode.json`,
    "",
  )
}

// ── 3. the desktop agent-launch wire ──────────────────────────────────────────
// What the desktop depends on from a live `opencode serve`, asserted against one: it prints a parseable
// "listening on <url>" line (agent.ts parses exactly that to point the WebContentsView) and it serves the GUI.
//
// It no longer asserts anything about `x-opencode-directory` / `?directory=`. The binding stopped reading the
// request stream: it reads the GUI's ROUTE (`/<base64url(dir)>/…`, see volt-desktop/src/binding.ts). Asserting a
// wire we don't consume is worse than not asserting it — it fails when opencode drops something harmless, and
// passes while the thing we DO depend on moves. The route scheme is covered where it belongs: live, over CDP, in
// volt-desktop/test/e2e/opencode-binding.test.ts, with the startup canary as the runtime detector.
// Read-only; the server is always killed in `finally`.
const READY = /listening on (https?:\/\/\S+)/i

async function verifyWire(): Promise<boolean> {
  const port = process.env.VOLT_COMPAT_PORT ?? "8623"
  const child = spawn("opencode", ["serve", "--port", port], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" })
  const kill = (): void => {
    if (child.pid === undefined) return
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"])
    else child.kill()
  }
  try {
    const base = await new Promise<string | undefined>((res) => {
      const timer = setTimeout(() => res(undefined), 25_000)
      const onData = (b: Buffer): void => {
        const m = String(b).match(READY)
        if (m) { clearTimeout(timer); res(m[1].replace("0.0.0.0", "127.0.0.1")) }
      }
      child.stdout!.on("data", onData)
      child.stderr!.on("data", onData)
      child.on("error", () => { clearTimeout(timer); res(undefined) })
      child.on("exit", () => { clearTimeout(timer); res(undefined) })
    })
    if (base === undefined) return report("wire", false, "", "`opencode serve` never printed a parseable 'listening on <url>' line (opencode on PATH? port free?)", "")

    const get = async (path: string): Promise<{ ok: boolean; text: string }> => {
      try {
        const r = await fetch(base + path, { signal: AbortSignal.timeout(6000) })
        return { ok: r.ok, text: await r.text() }
      } catch (e) {
        return { ok: false, text: String(e) }
      }
    }

    const root = await get("/")
    const ok = root.ok // `serve` printed a parseable URL (we got here) and the GUI HTML is served
    return report(
      "wire",
      ok,
      "the desktop agent-launch holds: `opencode serve` prints a parseable URL and serves its GUI",
      "`opencode serve` did not serve its GUI — the desktop's WebContentsView would show the install banner instead",
      ok ? "" : root.text.slice(0, 200),
    )
  } finally {
    kill()
  }
}

console.log("opencode compat — does the installed binary still load Volt's config + hold the desktop wire?")
const lspOk = verifyLsp()
const toolOk = verifyTool()
const wireOk = await verifyWire()
const ok = lspOk && toolOk && wireOk
console.log(ok ? "\n✓ COMPAT OK" : "\n✗ COMPAT FAILED")
process.exit(ok ? 0 : 1)
