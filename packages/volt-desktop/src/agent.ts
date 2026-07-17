// The AI agent — the INSTALLED opencode's server, shown in the content view. Volt neither bundles nor
// downloads opencode (a provisioned runtime); here we only spawn it and, if it's absent, show the install
// banner. Mirrors the extension's agent.ts (which locates/launches the same CLI).
import { spawn, spawnSync } from "node:child_process"
import type { WebContentsView } from "electron"

// Installed opencode. Default: `opencode` on PATH (resolved via shell:true at spawn, so npm's `.cmd`/`.ps1`
// shim works). Override with OPENCODE_BIN to point at a specific binary.
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode"
export const READY = /listening on (https?:\/\/\S+)/i // matches `opencode serve` stdout

let child: ReturnType<typeof spawn> | null = null

export function startServer(): Promise<string> {
  // ponytail: parse the URL opencode prints instead of pre-choosing a port. Reject if it never prints one.
  return new Promise((resolve, reject) => {
    // shell:true so Windows resolves the `.cmd`/`.ps1` PATH shim npm installs (bare spawn ENOENTs on it).
    child = spawn(OPENCODE_BIN, ["serve"], { stdio: ["ignore", "pipe", "pipe"], shell: true })
    const timer = setTimeout(() => reject(new Error("opencode server didn't report a URL within 20s")), 20_000)
    const onData = (buf: Buffer) => {
      const m = String(buf).match(READY)
      if (m) {
        clearTimeout(timer)
        resolve(m[1].replace("0.0.0.0", "127.0.0.1"))
      }
    }
    child.stdout!.on("data", onData)
    child.stderr!.on("data", onData)
    child.on("error", (e) => (clearTimeout(timer), reject(e)))
    child.on("exit", (code) => reject(new Error(`opencode exited before serving (code ${code})`)))
  })
}

/** Kill the opencode server on app quit. Because we spawn with shell:true, `child` is the shell (cmd.exe
 *  running npm's .cmd shim), NOT opencode itself — a plain child.kill() reaps only the shell and orphans the
 *  `opencode serve` process (and its children), which keeps holding its port after Volt exits. On Windows
 *  (the desktop's platform) taskkill /T kills the whole tree; elsewhere fall back to the direct kill. */
export function killServer(): void {
  const c = child
  child = null
  if (c === null || c.pid === undefined) return
  if (process.platform === "win32") {
    try { spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]) } catch { /* already gone */ }
  } else {
    try { c.kill() } catch { /* already gone */ }
  }
}

/** Start the opencode server and show its GUI in the view; on failure, show the install banner instead. */
export async function launchAgent(view: WebContentsView): Promise<void> {
  try {
    await view.webContents.loadURL(await startServer())
  } catch (err) {
    await agentBanner(view, { error: (err as Error).message })
  }
}

// Minimal HTML escape for text interpolated into the data: URL banner (error strings aren't trusted markup).
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
}

// The agent view's placeholder when opencode isn't installed (or failed to start). The Volt installer offers the
// opencode CLI as an opt-in wizard task, so this only points at opencode.ai rather than installing anything —
// one install path to maintain, and Volt never manages opencode behind the user's back.
// target=_blank → setWindowOpenHandler sends it to the real browser.
function agentBanner(view: WebContentsView, opts: { error?: string }): Promise<void> {
  const footer = opts.error ? `<p style="opacity:.35;margin:2rem 0 0;font:12px ui-monospace,monospace">${esc(opts.error)}</p>` : ""
  return view.webContents.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
      <body style="margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.6 system-ui;background:radial-gradient(120% 120% at 50% 0%,#221a12 0%,#16120e 60%);color:#f3ead9">
      <main style="max-width:30rem;padding:2.5rem;text-align:center">
        <div style="width:52px;height:52px;margin:0 auto 1.25rem;display:grid;place-items:center;border-radius:14px;background:#e8a94b;color:#16120e;font-size:26px;box-shadow:0 8px 30px rgba(232,169,75,.25)">⚡</div>
        <h2 style="margin:0 0 .5rem;font-size:1.5rem;letter-spacing:-.01em">Turn on the AI agent</h2>
        <p style="opacity:.7;margin:0 0 1.75rem">The agent view is powered by <b>opencode</b>, an optional runtime. Everything else in Volt — sync, the language server, the IDE bridge — already works without it.</p>
        <a href="https://opencode.ai/download" target="_blank" style="display:inline-block;padding:.7rem 1.6rem;border-radius:10px;background:#e8a94b;color:#16120e;font-weight:600;text-decoration:none;box-shadow:0 6px 20px rgba(232,169,75,.3)">Install opencode</a>
        <p style="opacity:.5;margin:1.75rem 0 0;font-size:12.5px">Install the <b>official opencode CLI</b>, then restart Volt. The Volt installer can also do this for you. To point at an existing install, set <code style="font-family:ui-monospace,monospace;opacity:.85">OPENCODE_BIN</code>.</p>
        ${footer}
      </main></body>`),
  )
}
