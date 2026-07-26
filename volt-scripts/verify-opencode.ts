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
 *   3. wire  — the desktop's UNDOCUMENTED integration (follow-binding + create-from-home) still holds against a live
 *              `opencode serve`: it reads opencode's GUI↔server wire directly, so an opencode release can change it
 *              and break the desktop SILENTLY — no OPENCODE_CONFIG_DIR contract covers it. (No provider needed.)
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

// ── 3. the desktop wire (follow-binding + create-from-home) ───────────────────
// These do NOT go through OPENCODE_CONFIG_DIR — they read opencode's GUI↔server wire directly (undocumented), so an
// opencode release can change it and break the desktop SILENTLY. Assert the exact facts they depend on against a live
// `opencode serve`. Read-only over HTTP, plus ONE harmless auto-register of a throwaway temp git dir; the server is
// always killed in `finally`. Verified facts (see openspec/changes/desktop-connection-flow/observations.md):
//   (a) `serve` prints a parseable "listening on <url>" line       — the desktop's agent-launch parse (agent.ts)
//   (b) GET /project returns the project registry (array)          — create-from-home reads it
//   (c) GET /project/current?directory=<dir> auto-registers + returns an id — the create-from-home recipe
//   (d) GET /<id> routes (opens that project)                      — the view the desktop navigates to
//   (e) the served client bundle still references `x-opencode-directory` — the follow-binding's scope mechanism
const READY = /listening on (https?:\/\/\S+)/i

async function verifyWire(): Promise<boolean> {
  const port = process.env.VOLT_COMPAT_PORT ?? "8623"
  const projDir = mkdtempSync(join(tmpdir(), "volt-verify-wire-"))
  spawnSync("git", ["init", "-q", projDir], { encoding: "utf8" }) // opencode models a project as a git worktree
  const child = spawn("opencode", ["serve", "--port", port], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" })
  const kill = (): void => {
    if (child.pid === undefined) return
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"])
    else child.kill()
  }
  try {
    // (a) wait for the "listening on <url>" line — also proves the desktop's agent-launch stdout parse still matches.
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

    const proj = await get("/project")
    const cur = await get(`/project/current?directory=${encodeURIComponent(projDir)}`)
    let id: string | undefined
    try { id = (JSON.parse(cur.text) as { id?: string }).id } catch { /* not JSON */ }
    const route = id !== undefined && id !== "" ? await get(`/${id}`) : { ok: false, text: "no id" }
    const scriptSrc = (await get("/")).text.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    const bundle = scriptSrc !== undefined ? (await get(scriptSrc)).text : ""

    const okB = proj.ok && proj.text.trim().startsWith("[")
    const okC = id !== undefined && id !== ""
    const okD = route.ok
    const okE = bundle.includes("x-opencode-directory")
    const ok = okB && okC && okD && okE
    return report(
      "wire",
      ok,
      "the desktop wire holds: /project lists · ?directory= auto-registers + returns an id · /<id> routes · the client still scopes by x-opencode-directory",
      `desktop wire DRIFT — /project:${okB} register+id:${okC} /<id>:${okD} client-scope:${okE}. The desktop follow-binding + create-from-home read opencode's GUI wire directly; a failure here means an opencode release moved it — update packages/volt-desktop (main.ts/agent.ts) + observations.md.`,
      ok ? "" : `id=${id ?? "-"} route.ok=${route.ok} bundleLen=${bundle.length}`,
    )
  } finally {
    kill()
    rmSync(projDir, { recursive: true, force: true })
  }
}

console.log("opencode compat — does the installed binary still load Volt's config + hold the desktop wire?")
const lspOk = verifyLsp()
const toolOk = verifyTool()
const wireOk = await verifyWire()
const ok = lspOk && toolOk && wireOk
console.log(ok ? "\n✓ COMPAT OK" : "\n✗ COMPAT FAILED")
process.exit(ok ? 0 : 1)
