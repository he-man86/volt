// Volt desktop shell — entry point. Volt owns the frame (frameless window + titlebar + toolbar + right IDE
// panel, see shell.html); opencode renders as the inner content pane in a WebContentsView. This file owns the
// window and lifecycle; the concern-split siblings mirror the extension: `agent` (opencode), `panel` (the
// IDE-sync data feed), `commands` (pull/push/init). The active workspace follows the project opencode's GUI
// is on (sniffed from its x-opencode-directory header), like VS Code binding to its open folder.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { setBundledCli, setLspServer, loadDiff, disconnect, boundProjectId, type DiffDirection } from "@volt/control"
import { READY, launchAgent, killServer } from "./agent.js"
import { bindWorkspace, refreshDetectedProjects } from "./panel.js"
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

const shell: Shell = { win: null, view: null, status: null, boundRoot: undefined, manualRoot: false, panelOpen: false, projects: [], connectorUp: false }

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

/** The project opencode's GUI is on — announced to its server via the x-opencode-directory header or
 *  ?directory= query (the installed opencode server reads it). This is the desktop's "open folder". */
function activeDirFromRequest(details: { url: string; requestHeaders: Record<string, string> }): string | undefined {
  for (const [k, v] of Object.entries(details.requestHeaders)) {
    // The GUI sends `x-opencode-directory: encodeURIComponent(dir)` — decode back to a real path.
    if (k.toLowerCase() === "x-opencode-directory" && typeof v === "string" && v.length > 0) {
      try { return decodeURIComponent(v) } catch { return v }
    }
  }
  try {
    const dir = new URL(details.url).searchParams.get("directory") // searchParams already decodes
    if (dir) return dir
  } catch { /* not a URL */ }
  return undefined
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

function watchActiveProject() {
  shell.view!.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const dir = activeDirFromRequest(details)
    // Skip once the user picked a folder by hand — a deliberate Change… must not be re-bound away on the next request.
    if (!shell.manualRoot && dir !== undefined && existsSync(dir) && !sameDir(dir, shell.boundRoot)) void bindWorkspace(shell, dir)
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
  void startWorkspace()

  // Probe both vendor bridges so the Initialize buttons enable only for a live IDE (parity with VS Code).
  void refreshDetectedProjects(shell)
  setInterval(() => void refreshDetectedProjects(shell), 10_000)

  await launchAgent(shell.view)
})

app.on("window-all-closed", () => app.quit())

// Close the bridge connection when the app closes — the bridge stops serving sync until the next connect (the IDE
// stays open). Deferred via before-quit: disconnect (a connector round-trip) before really quitting, but bounded so
// a slow/absent connector can't hold the app open more than ~1.5s.
let disconnectedOnQuit = false
app.on("before-quit", (e) => {
  const root = shell.status?.workspaceRoot
  if (disconnectedOnQuit || root === undefined) return
  disconnectedOnQuit = true
  e.preventDefault()
  void Promise.race([
    (async () => {
      try {
        const id = await boundProjectId(root) // THIS workspace's project, not the tray's active one
        if (id !== undefined) await disconnect(id)
      } catch { /* connector down / already gone */ }
    })(),
    new Promise((r) => setTimeout(r, 1500)),
  ]).then(() => app.quit())
})
app.on("quit", () => {
  shell.status?.dispose()
  killServer()
})
