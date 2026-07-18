// Volt desktop shell — entry point. Volt owns the frame (frameless window + titlebar + toolbar + right IDE
// panel, see shell.html); opencode renders as the inner content pane in a WebContentsView. This file owns the
// window and lifecycle; the concern-split siblings mirror the extension: `agent` (opencode), `panel` (the
// IDE-sync data feed), `commands` (pull/push/init). The active workspace follows the project opencode's GUI
// is on (sniffed from its x-opencode-directory header), like VS Code binding to its open folder.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { setBundledCli, setLspServer } from "@volt/control"
import { READY, launchAgent, killServer } from "./agent.js"
import { bindWorkspace } from "./panel.js"
import { registerCommands } from "./commands.js"
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

const shell: Shell = { win: null, view: null, status: null, boundRoot: undefined, panelOpen: false }

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
    setBundledCli(join(__dirname, "..", "volt-git", "dist", "bin.js"))
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

function watchActiveProject() {
  shell.view!.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const dir = activeDirFromRequest(details)
    if (dir !== undefined && dir !== shell.boundRoot && existsSync(dir)) void bindWorkspace(shell, dir)
    cb({ requestHeaders: details.requestHeaders })
  })
}

async function startWorkspace() {
  // An explicit override for dev; otherwise the workspace follows opencode's active project (watchActiveProject).
  const root = process.env.VOLT_WORKSPACE
  if (root && existsSync(root)) await bindWorkspace(shell, root)
}

registerCommands(ipcMain, dialog, shell)

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

  shell.view = new WebContentsView()
  // Tell opencode's GUI our real locale. Without this the view sends an Accept-Language opencode's server-side
  // detector maps to Turkish on first load; here we pin it to the OS locale (override with VOLT_LOCALE).
  const locale = process.env.VOLT_LOCALE || app.getLocale() || "en-US"
  const sess = shell.view.webContents.session
  sess.setUserAgent(sess.getUserAgent(), locale)
  shell.win.contentView.addChildView(shell.view)
  layoutView()
  shell.win.on("resize", layoutView)
  shell.view.webContents.setWindowOpenHandler(({ url }) => (electronShell.openExternal(url), { action: "deny" }))

  configureTools()
  watchActiveProject() // bind to whatever project opencode's GUI is on
  void startWorkspace()

  await launchAgent(shell.view)
})

app.on("window-all-closed", () => app.quit())
app.on("quit", () => {
  shell.status?.dispose()
  killServer()
})
