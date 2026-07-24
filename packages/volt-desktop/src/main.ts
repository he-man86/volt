// Volt desktop shell — entry point. Volt owns the frame (frameless window + titlebar + toolbar + right IDE
// panel, see shell.html); opencode renders as the inner content pane in a WebContentsView. This file owns the
// window and lifecycle; the concern-split siblings mirror the extension: `agent` (opencode), `panel` (the
// IDE-sync data feed), `commands` (pull/push/init). The active workspace follows the project opencode's GUI
// is on (sniffed from its x-opencode-directory header), like VS Code binding to its open folder.
import { existsSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { setBundledCli, setLspServer } from "@volt/control"
import { READY, launchAgent, killServer, OPENCODE_PORT } from "./agent.js"
import { bindWorkspace, refreshDetectedProjects } from "./panel.js"
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

const shell: Shell = { win: null, view: null, status: null, boundRoot: undefined, panelOpen: false, projects: [], connectorUp: false }

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

// Accept-Language for opencode's GUI. Default ENGLISH. opencode detects locale SERVER-SIDE from this header
// (verified against its lib/language.ts); left to Electron's default it forwards navigator.languages verbatim, so
// a stray extra keyboard language (e.g. Turkish) that opencode supports while the user's primary (Dutch) it does
// not would win — the GUI came up in Turkish. English is the right default for a coding tool and is what was
// asked for. Override with VOLT_LOCALE for a specific language (opencode maps e.g. "de" → German). Set on the
// request header directly because setUserAgent's acceptLanguages arg does NOT control it here.
function acceptLanguageHeader(): string {
  return process.env.VOLT_LOCALE || "en-US"
}

function watchActiveProject() {
  const acceptLang = acceptLanguageHeader()
  shell.view!.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const dir = activeDirFromRequest(details)
    if (dir !== undefined && dir !== shell.boundRoot && existsSync(dir)) void bindWorkspace(shell, dir)
    details.requestHeaders["Accept-Language"] = acceptLang
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

  // ponytail: boot smoke — the window + Volt shell loaded here (opencode/agent is optional and comes later), so
  // exit before spawning it. Proves the electron entry, the frameless window, and shell.html actually render —
  // the one thing the pure-logic unit tests can't. Driven by test/e2e/boot.test.ts.
  if (process.env.VOLT_SMOKE) {
    const ok = !shell.win.isDestroyed() && shell.win.webContents.getURL().endsWith("shell.html")
    app.exit(ok ? 0 : 1)
    return
  }

  shell.view = new WebContentsView()
  const sess = shell.view.webContents.session

  // The Accept-Language that forces English is set per-request in watchActiveProject (setUserAgent's language arg
  // does NOT control the header here). But opencode caches its chosen language in an `oc_locale` COOKIE that
  // OUTRANKS Accept-Language — so a machine that already came up in Turkish has `oc_locale=tr` stored, which keeps
  // winning. Clear that web storage once so opencode re-detects from the (now English) header. Gated by a marker
  // so a user's later in-app language choice isn't wiped each launch. Bumped to v2: the v1 pass ran before the
  // header was actually forced, so it re-detected tr; v2 clears it now that the header is correct. Safe —
  // opencode's auth lives in its OWN data dir, not this web storage; only the language/GUI prefs reset.
  const localeResetMarker = join(app.getPath("userData"), ".opencode-locale-reset-v2")
  if (!existsSync(localeResetMarker)) {
    try {
      await sess.clearStorageData({ origin: `http://127.0.0.1:${OPENCODE_PORT}`, storages: ["localstorage", "cookies"] })
    } catch { /* best-effort — a stale language is cosmetic, never block launch */ }
    try { writeFileSync(localeResetMarker, new Date().toISOString()) } catch { /* marker best-effort; worst case we reset again next launch */ }
  }
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
app.on("quit", () => {
  shell.status?.dispose()
  killServer()
})
