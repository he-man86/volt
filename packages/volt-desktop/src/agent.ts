// The AI agent — the INSTALLED opencode's server, shown in the content view. Volt neither bundles nor
// downloads opencode (a provisioned runtime); here we only spawn it and, if it's absent, show the install
// banner. Mirrors the extension's agent.ts (which locates/launches the same CLI).
import { spawn, spawnSync } from "node:child_process"
import type { WebContentsView } from "electron"
import { voltLog } from "@volt/control"

// Installed opencode. Default: `opencode` on PATH (resolved via shell:true at spawn, so npm's `.cmd`/`.ps1`
// shim works). Override with OPENCODE_BIN to point at a specific binary.
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode"
export const READY = /listening on (https?:\/\/\S+)/i // matches `opencode serve` stdout
// Pin the port so the GUI's origin is stable across launches. opencode persists language/settings in
// cookies+localStorage scoped to scheme://host:port; a random port each launch = a fresh origin = nothing
// sticks (and re-runs Accept-Language locale detection every time). Override with OPENCODE_PORT.
const OPENCODE_PORT = process.env.OPENCODE_PORT || "8547"

let child: ReturnType<typeof spawn> | null = null

// Free the pinned port before starting. Because the port is FIXED (for origin stability) and Volt-specific, an
// occupant is always a stale `opencode serve` orphaned by a previous run — most often when the desktop was killed
// externally (an update's taskkill, a crash) so killServer never ran. opencode then fails to bind with a bare
// "ServeError / Unexpected error" and exits 1, which the UI shows as "opencode exited before serving" — the
// install banner, even though opencode is installed and fine. Reclaiming our own port turns that into a non-event.
function freePinnedPort(): void {
  if (process.platform !== "win32") return // the desktop's platform; elsewhere the OS reuses SO_REUSEADDR fine
  try {
    const out = spawnSync("cmd", ["/c", `netstat -ano | findstr LISTENING | findstr :${OPENCODE_PORT}`], { encoding: "utf8" }).stdout ?? ""
    const pids = new Set(
      out
        .trim()
        .split("\n")
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p): p is string => !!p && /^\d+$/.test(p) && p !== "0"),
    )
    for (const pid of pids) spawnSync("taskkill", ["/pid", pid, "/T", "/F"])
  } catch {
    /* best-effort — if we can't clear it, the spawn below fails loudly as before */
  }
}

function startServer(): Promise<string> {
  // Still parse the URL opencode prints (robust to host/scheme) — we only pin the port. Reject if none prints.
  return new Promise((resolve, reject) => {
    freePinnedPort() // reclaim the port from any orphaned opencode before binding it
    // shell:true so Windows resolves the `.cmd`/`.ps1` PATH shim npm installs (bare spawn ENOENTs on it).
    child = spawn(OPENCODE_BIN, ["serve", "--port", OPENCODE_PORT], { stdio: ["ignore", "pipe", "pipe"], shell: true })
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

/** Start the opencode server and show its GUI in the view; on failure, show the install banner instead. Returns
 *  whether opencode actually launched — the only thing the shell needs (Volt never drives opencode's GUI). */
export async function launchAgent(view: WebContentsView): Promise<boolean> {
  try {
    const url = await startServer()
    voltLog("desktop", `opencode serving at ${url} (${OPENCODE_BIN})`)
    await view.webContents.loadURL(url)
    return true
  } catch (err) {
    // The install banner is what the user sees; this is what tells US which of the failures it was (not installed,
    // port stuck, exited before serving) without asking them to reproduce with a flag.
    voltLog("desktop", `opencode did not start: ${(err as Error).message}`, "warn")
    await agentBanner(view, { error: (err as Error).message })
    return false
  }
}

// Minimal HTML escape for text interpolated into the data: URL banner (error strings aren't trusted markup).
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
}

// The agent view's placeholder when opencode isn't installed (or failed to start). Volt does NOT install opencode
// — it just points at the official site and lets the user install it themselves. target=_blank →
// setWindowOpenHandler sends it to the real browser.
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
        <p style="opacity:.5;margin:1.75rem 0 0;font-size:12.5px">Install the <b>official opencode CLI</b> from <a href="https://opencode.ai/download" target="_blank" style="color:#e8a94b">opencode.ai</a>, then restart Volt. Already have it? Point Volt at it with <code style="font-family:ui-monospace,monospace;opacity:.85">OPENCODE_BIN</code>.</p>
        ${footer}
      </main></body>`),
  )
}
