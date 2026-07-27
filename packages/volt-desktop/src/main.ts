// Volt desktop shell — entry point. Volt owns the frame (frameless window + titlebar + toolbar + right IDE
// panel, see shell.html); opencode renders as the inner content pane in a WebContentsView. This file owns the
// window and lifecycle; the concern-split siblings mirror the extension: `agent` (opencode), `panel` (the
// IDE-sync data feed), `commands` (pull/push/init). The active workspace follows the project opencode's GUI
// is on (sniffed from its x-opencode-directory header), like VS Code binding to its open folder.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { setBundledCli, setLspServer, loadDiff, leaveWorkspace, shutdownSession, type DiffDirection } from "@volt/control"
import { READY, launchAgent, killServer } from "./agent.js"
import { bindWorkspace, unbindWorkspace, refreshDetectedProjects, pushStatus } from "./panel.js"
import { bindingAction, classifySignal, type ActiveProject } from "./binding.js"
import { registerCommands } from "./commands.js"
import { diffHtml } from "./diff.js"
import type { Shell } from "./context.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Layout — keep in sync with shell.html. A thin icon rail is always reserved on the right; the panel expands
// beside it. opencode fills whatever's left.
const TITLEBAR_H = 40
const RAIL_W = 46
const PANEL_W = 320

// ── selftest (before touching electron) ──────────────────────────────────────
if (process.argv.includes("--selftest")) {
  const cases: [string, string][] = [
    ["opencode server listening on http://127.0.0.1:52345", "http://127.0.0.1:52345"],
    ["  listening on http://0.0.0.0:4096 now", "http://127.0.0.1:4096"],
  ]
  for (const [line, want] of cases) {
    const got = line.match(READY)?.[1].replace("0.0.0.0", "127.0.0.1")
    if (got !== want) throw new Error(`selftest: ${line} → ${got} ≠ ${want}`)
  }
  console.log("selftest ok")
  process.exit(0)
}

const { app, BrowserWindow, WebContentsView, ipcMain, shell: electronShell, dialog } = await import("electron")

// Force the GUI language to English (VOLT_LOCALE overrides). opencode's serve GUI picks its locale CLIENT-SIDE
// from navigator.languages — confirmed empirically: a machine with navigator.languages ["nl","nl-NL","tr"] came
// up Turkish (opencode has no Dutch, so its client chose the Turkish that was in the list). The `--lang` switch
// sets Chromium's language → navigator.languages → the client picks it; it must be applied BEFORE app-ready. This
// is why the request-header approaches (setUserAgent, Accept-Language, x-opencode-locale) never took — the
// selection isn't server-side here. VERIFIED: launching with --lang=en-US rendered the GUI in English.
app.commandLine.appendSwitch("lang", process.env.VOLT_LOCALE || "en-US")

// Windows taskbar identity. Without an explicit AppUserModelID the running app inherits Electron's, so the taskbar
// shows the generic Electron icon (most visible in dev) and a pinned shortcut never merges with the live window.
// Match electron-builder.yml's `appId` so the packaged app's window + shortcut share one taskbar button and icon.
// (No-op off Windows; Volt is Windows-only anyway.)
app.setAppUserModelId("dev.volt.desktop")

const shell: Shell = { win: null, view: null, opencodeUrl: undefined, status: null, boundRoot: undefined, awaitingOpencode: true, bindStale: false, panelOpen: false, projects: [], connectorUp: false }

// Log every request's directory + classification so opencode's real timeline is observable (openspec task 1.1:
// what does the home/project-list screen actually emit?). Off unless VOLT_BIND_DEBUG is set.
const BIND_DEBUG = !!process.env.VOLT_BIND_DEBUG

// Startup canary grace period. opencode's GUI makes scoped requests immediately on load (its home screen alone emits
// several `/global/*` calls within ~1s), so if we've classified NOTHING after this long while opencode IS loaded, our
// request-sniff has almost certainly broken — opencode changed its GUI↔server wire on a release. We surface that
// instead of sitting silently on "Connecting…". Purely observational: it reads our own flag, never opencode.
const BIND_CANARY_MS = 20_000

function layoutView() {
  if (!shell.win || !shell.view) return
  const [w, h] = shell.win.getContentSize()
  const right = RAIL_W + (shell.panelOpen ? PANEL_W : 0) // rail is always visible; panel expands beside it
  shell.view.setBounds({ x: 0, y: TITLEBAR_H, width: Math.max(0, w - right), height: Math.max(0, h - TITLEBAR_H) })
}

// Point volt-control at the volt CLI + LSP. Packaged: the compiled .exe's sit beside the connector at the
// install-dir root (…\Volt\bin), and this GUI runs from …\Volt\desktop\resources\app — so hop up to the install
// root from process.resourcesPath (…\Volt\desktop\resources). Dev: the sibling packages' .js entries
// (run via ELECTRON_RUN_AS_NODE). volt-control spawns .exe directly, .js via node — see cli.ts/diagnostics.ts.
function configureTools() {
  if (app.isPackaged) {
    const bin = join(process.resourcesPath, "..", "..", "bin") // …\Volt\desktop\resources → …\Volt\bin
    setBundledCli(join(bin, "volt.exe"))
    setLspServer(join(bin, "volt-lsp-iec.exe"))
  } else {
    // Dev: the C# volt.exe from build-cli.ps1 (setBundledCli no-ops if absent → cliScript falls back to `volt` on
    // PATH); the LSP is still the bundled .js run via ELECTRON_RUN_AS_NODE.
    setBundledCli(join(__dirname, "..", "volt-cli", "dist", "Cli", "volt.exe"))
    setLspServer(join(__dirname, "..", "volt-lsp-iec", "dist", "src", "bin.js"))
  }
}

/** Parse one request into the two things the binding cares about: its `pathname` (opencode's home scope is a
 *  `/global/` path prefix) and the opencode-scoped `directory`. The GUI announces the directory as a `?directory=`
 *  query — it DELETES the `x-opencode-directory` header and re-emits it as this query (verified against the live
 *  client) — but we still honor the header first for older clients. Parses the URL ONCE, so the hot
 *  `onBeforeSendHeaders` path (and the debug log) don't re-parse it. */
function parseRequest(details: { url: string; requestHeaders: Record<string, string> }): { pathname: string; dir: string | undefined } {
  let pathname = ""
  let queryDir: string | undefined
  try {
    const u = new URL(details.url)
    pathname = u.pathname
    queryDir = u.searchParams.get("directory") ?? undefined // searchParams already decodes
  } catch { /* not a URL */ }
  for (const [k, v] of Object.entries(details.requestHeaders)) {
    if (k.toLowerCase() === "x-opencode-directory" && typeof v === "string" && v.length > 0) {
      try { return { pathname, dir: decodeURIComponent(v) } } catch { return { pathname, dir: v } }
    }
  }
  return { pathname, dir: queryDir }
}

// Canonical form for comparing the active-project dir against the bound one. opencode's chat traffic reports the
// directory in varying string forms (separators / case / trailing slash), and a RAW `!==` re-bound on EVERY
// variation — re-running the whole diagnostics crawl repeatedly mid-chat. Normalize so only a REAL project change
// re-binds. resolve() canonicalizes separators + trailing slash; Windows is case-insensitive, so fold case there.
function sameDir(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const norm = (d: string): string => (process.platform === "win32" ? resolve(d).toLowerCase() : resolve(d))
  return norm(a) === norm(b)
}

// Feed a signal through the pure reducer and act. Binding is STICKY on the request stream: a real project directory
// binds (or rebinds to a different project), and a `none` (opencode's `global` scope) NEVER releases here — opencode
// reports `global` for both its home screen and a project's new-session draft (verified live), so releasing on it
// would unbind every time you open a draft. `none` only clears the cold-start "Connecting…" so the create surface can
// show. Release happens in ONE place — `watchHomeNavigation`, off the GUI's actual home URL, which can tell home from
// a draft when the request stream can't.
function onActiveSignal(sig: ActiveProject): void {
  const wasAwaiting = shell.awaitingOpencode
  shell.awaitingOpencode = false // any signal means opencode is up (clears the cold-start "Connecting…")
  shell.bindStale = false // a signal arrived → the sniff works; retract any canary warning
  if (sig.kind === "dir" && bindingAction(shell.boundRoot, sig, sameDir).kind === "bind") return void bindWorkspace(shell, sig.dir) // pushes
  // A `none` (opencode global/home) or a same-project `dir`: nothing to (re)bind, and we never release. Push only if
  // this signal just cleared the cold-start state, so "Connecting…" flips to the bound / create-a-workspace view.
  if (wasAwaiting) pushStatus(shell)
}

// Every opencode GUI request reveals its active project. The pure classifier (binding.ts::classifySignal) turns the
// request's pathname + directory into a signal (`dir` for a real project, `none` for opencode's `global`/home scope).
// See the openspec observations for the verified wire facts.
// Release the binding when opencode's GUI is on its genuine HOME route. Binding is otherwise STICKY — the request
// sniff can't distinguish opencode's home from a project's new-session draft (it reports the `global` scope for
// both), so on the real homepage the panel would keep showing a stale project. The GUI's URL CAN tell them apart:
// `/` is home, `/new-session`/scoped is a project. So this is the one release signal — a stable, documented one (the
// view's own URL), not the fragile wire. Covers SPA client-side nav (did-navigate-in-page) + full loads.
function watchHomeNavigation() {
  const onNav = (url: string): void => {
    let pathname = "/"
    try { pathname = new URL(url).pathname } catch { /* not a URL */ }
    if (pathname === "/") unbindWorkspace(shell) // the true homepage → drop the sticky binding (no stale project)
  }
  shell.view!.webContents.on("did-navigate-in-page", (_e, url) => onNav(url))
  shell.view!.webContents.on("did-navigate", (_e, url) => onNav(url))
}

function watchActiveProject() {
  shell.view!.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const { pathname, dir } = parseRequest(details)
    const sig = classifySignal(pathname, dir, existsSync)
    if (BIND_DEBUG) console.log(`[bind] ${details.method} ${pathname || details.url} dir=${dir ?? "-"} → ${sig?.kind ?? "ignored"}`)
    if (sig !== undefined) onActiveSignal(sig)
    cb({ requestHeaders: details.requestHeaders })
  })
}

async function startWorkspace() {
  // An explicit override for dev; otherwise the workspace follows opencode's active project (watchActiveProject).
  const root = process.env.VOLT_WORKSPACE
  if (root && existsSync(root)) await bindWorkspace(shell, root)
}

registerCommands(ipcMain, dialog, shell)

// Click a change row → a diff POPUP. The diff (which refs, the line diff) is @volt/control's loadDiff; here we
// only open a child window and load the rendered HTML. A child BrowserWindow (not a DOM overlay) sidesteps the
// opencode WebContentsView, which is layered above the shell DOM and would cover any in-page modal.
let diffWin: InstanceType<typeof BrowserWindow> | null = null
ipcMain.handle("volt:diff", async (_e, workspaceRoot: string, relPath: string, name: string, direction: DiffDirection) => {
  // A failed `volt show` (bridge down, unreadable ref) renders as an error page in the popup rather than throwing
  // back an unhandled rejection to the renderer.
  let html: string
  try {
    html = diffHtml(await loadDiff(workspaceRoot, relPath, name, direction))
  } catch (err) {
    html = `<body style="font:14px system-ui;padding:32px;color:#e8675c;background:#16120e">Couldn't load the diff: ${err instanceof Error ? err.message : String(err)}</body>`
  }
  if (diffWin === null || diffWin.isDestroyed()) {
    diffWin = new BrowserWindow({ width: 900, height: 720, parent: shell.win ?? undefined, backgroundColor: "#16120e", autoHideMenuBar: true })
    diffWin.on("closed", () => (diffWin = null))
  }
  await diffWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))
  diffWin.setTitle(`${name} — diff`)
  diffWin.focus()
})

// Click a Diagnostics file → open it in the OS-associated editor. On a typical dev box that's VS Code with the Volt
// extension (which registers .fb/.st/.pou/…), so the file opens with native, jump-to-line diagnostics. If nothing is
// associated, fall back to revealing it in Explorer rather than silently doing nothing.
ipcMain.handle("volt:openFile", async (_e, filePath: string) => {
  if (!existsSync(filePath)) return
  const err = await electronShell.openPath(filePath)
  if (err) electronShell.showItemInFolder(filePath)
})

// window controls + IDE-panel toggle (window/layout concerns stay here; the volt: actions live in commands.ts)
ipcMain.on("win:minimize", () => shell.win?.minimize())
ipcMain.on("win:maximize", () => (shell.win?.isMaximized() ? shell.win.unmaximize() : shell.win?.maximize()))
ipcMain.on("win:close", () => shell.win?.close())
ipcMain.on("volt:togglePanel", (_e, open: boolean) => {
  shell.panelOpen = open
  layoutView()
})

app.whenReady().then(async () => {
  shell.win = new BrowserWindow({
    width: 1280,
    height: 860,
    frame: false, // Volt draws the titlebar (shell.html) — not the OS
    backgroundColor: "#16120e",
    icon: join(__dirname, "assets", "volt-icon.ico"), // Volt taskbar/window icon
    webPreferences: { preload: join(__dirname, "preload.cjs") },
  })
  await shell.win.loadFile(join(__dirname, "shell.html"))

  // ponytail: boot smoke — the window + Volt shell loaded here (opencode/agent is optional and comes later), so
  // exit before spawning it. Proves the electron entry, the frameless window, and shell.html actually render —
  // the one thing the pure-logic unit tests can't. Driven by test/e2e/boot.test.ts.
  if (process.env.VOLT_SMOKE) {
    const ok = !shell.win.isDestroyed() && shell.win.webContents.getURL().endsWith("shell.html")
    app.exit(ok ? 0 : 1)
    return
  }

  shell.view = new WebContentsView()
  // The GUI language is forced via the x-opencode-locale header in watchActiveProject (highest precedence, so it
  // beats any stale oc_locale cookie — no storage to clear).
  shell.win.contentView.addChildView(shell.view)
  layoutView()
  shell.win.on("resize", layoutView)
  shell.view.webContents.setWindowOpenHandler(({ url }) => (electronShell.openExternal(url), { action: "deny" }))

  configureTools()
  watchActiveProject() // bind to whatever project opencode's GUI is on
  watchHomeNavigation() // …and release when it goes to its home route (the one place sticky binding lets go)
  void startWorkspace()

  // Probe both vendor bridges so the Initialize buttons enable only for a live IDE (parity with VS Code).
  void refreshDetectedProjects(shell)
  setInterval(() => void refreshDetectedProjects(shell), 10_000)

  shell.opencodeUrl = await launchAgent(shell.view)

  // Arm the binding canary only when opencode actually launched (a missing opencode legitimately never signals — the
  // install banner is showing, not a broken sniff). If we still haven't classified any signal after the grace period,
  // make the silent failure visible in the panel + logs. This never affects binding; it only reports.
  if (shell.opencodeUrl !== undefined) {
    setTimeout(() => {
      if (!shell.awaitingOpencode) return // a signal arrived — the sniff works
      shell.bindStale = true
      console.warn(
        `[volt] opencode loaded but no active-project signal was seen in ${BIND_CANARY_MS / 1000}s — the binding may be out of date with this opencode version. Run with VOLT_BIND_DEBUG=1 to inspect.`,
      )
      pushStatus(shell)
    }, BIND_CANARY_MS)
  }
})

app.on("window-all-closed", () => app.quit())

// Close the connection when the app quits — drop this workspace's interest, then end the whole session (one DELETE
// drops every interest at once). The bridge stops serving until the next connect; the IDE stays open. Deferred via
// before-quit but bounded so a slow/absent connector can't hold the app open more than ~1.5s.
let disconnectedOnQuit = false
app.on("before-quit", (e) => {
  const root = shell.status?.workspaceRoot
  if (disconnectedOnQuit) return
  disconnectedOnQuit = true
  e.preventDefault()
  const closed = (root !== undefined ? leaveWorkspace(root) : Promise.resolve()).then(() => shutdownSession())
  void Promise.race([closed, new Promise((r) => setTimeout(r, 1500))]).then(() => app.quit())
})
app.on("quit", () => {
  shell.status?.dispose()
  killServer()
})
