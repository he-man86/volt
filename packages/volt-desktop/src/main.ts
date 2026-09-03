// Volt desktop shell — entry point. A standalone Volt app: the frameless titlebar, the icon rail and the IDE
// panel (see shell.html) ARE the window. It launches from its own executable — the Start Menu shortcut the connector writes points AT it — and
// depends on nothing but the connector. This file owns the window and lifecycle; the concern-split siblings
// mirror the extension: `panel` (the IDE-sync data feed), `commands` (pull/push/init), `recent` (which workspace
// to come back to).
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  setBundledCli,
  setLspServer,
  loadDiff,
  leaveWorkspace,
  shutdownSession,
  startConnectorFeed,
  onConnectorView,
  type DiffDirection,
} from "@volt/control"
import { startupWorkspace, workspaceArg } from "./startup.js"
import { bindWorkspace, refreshDetectedProjects } from "./panel.js"
import { registerCommands } from "./commands.js"
import { readRecent, setRecentFile } from "./recent.js"
import { diffHtml } from "./diff.js"
import type { Shell } from "./context.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

const { app, BrowserWindow, ipcMain, shell: electronShell, dialog } = await import("electron")

// Windows taskbar identity. Without an explicit AppUserModelID the running app inherits Electron's, so the taskbar
// shows the generic Electron icon (most visible in dev) and a pinned shortcut never merges with the live window.
// Match electron-builder.yml's `appId` so the packaged app's window + shortcut share one taskbar button and icon.
// (No-op off Windows; Volt is Windows-only anyway.)
app.setAppUserModelId("dev.volt.desktop")

const shell: Shell = { win: null, status: null, boundRoot: undefined, awaiting: true, projects: [], connectorUp: false }

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

// Which workspace the app opens on. VOLT_WORKSPACE is the dev override; otherwise return to the last one bound
// (see recent.ts for why that memory is load-bearing here). Neither is a guess: both are paths that were
// explicitly chosen, and a missing one leaves the app unbound on the picker rather than binding something else.
async function restoreWorkspace() {
    // The rule lives in startup.ts, pure and tested: `--workspace` (what `volt open <dir>` passes) wins, then
    // VOLT_WORKSPACE as the dev override, then the last one bound. Argv is first because it is the only
    // channel that reaches an ALREADY-RUNNING app, so `volt open <otherDir>` retargets rather than being
    // silently ignored.
    const root = startupWorkspace(process.argv, process.env.VOLT_WORKSPACE, readRecent)
  if (root !== undefined && existsSync(root)) await bindWorkspace(shell, root)
}

registerCommands(ipcMain, dialog, shell)

// Click a change row → a diff POPUP. The diff (which refs, the line diff) is @volt/control's loadDiff; here we
// only open a child window and load the rendered HTML.
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

// window controls (the volt: actions live in commands.ts)
ipcMain.on("win:minimize", () => shell.win?.minimize())
ipcMain.on("win:maximize", () => (shell.win?.isMaximized() ? shell.win.unmaximize() : shell.win?.maximize()))
ipcMain.on("win:close", () => shell.win?.close())

app.whenReady().then(async () => {
  // ONE WINDOW. Without this, `volt open <dir>` on a machine that already has Volt open would start a
  // SECOND instance: two windows over the same connector, each with its own status feed, and the newer one
  // the only place the requested workspace appeared. Electron hands a second launch's argv to the FIRST
  // instance instead, which is what makes `volt open <otherDir>` retarget rather than duplicate.
  //
  // Inside the handler, not at module scope, because of the `return` — a module-scope return is a syntax
  // error, and this file is bundled.
  //
  // Exempt under VOLT_SMOKE: the lock key derives from userData, which is the same path for a packaged app
  // and for `electron .`, so a developer's open window would make the CI boot smoke test quit before it
  // rendered and report a pass for the wrong reason.
  if (!process.env.VOLT_SMOKE && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_e, argv) => {
    // A second `volt open` arrived. Take the workspace it named, if any, and surface the window we already
    // have — the point of the lock is that the engineer's request still lands somewhere.
    const root = workspaceArg(argv)
    if (root !== undefined && existsSync(root)) void bindWorkspace(shell, root)
    if (shell.win) {
      if (shell.win.isMinimized()) shell.win.restore()
      shell.win.focus()
    }
  })

  shell.win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 520,
    minHeight: 480,
    frame: false, // Volt draws the titlebar (shell.html) — not the OS
    backgroundColor: "#16120e",
    icon: join(__dirname, "assets", "volt-icon.ico"), // Volt taskbar/window icon
    webPreferences: { preload: join(__dirname, "preload.cjs") },
  })
  await shell.win.loadFile(join(__dirname, "shell.html"))

  // ponytail: boot smoke — proves the electron entry, the frameless window and shell.html actually render, the one
  // thing the pure-logic unit tests can't. Driven by test/e2e/boot.test.ts.
  if (process.env.VOLT_SMOKE) {
    const ok = !shell.win.isDestroyed() && shell.win.webContents.getURL().endsWith("shell.html")
    app.exit(ok ? 0 : 1)
    return
  }

  configureTools()
  setRecentFile(join(app.getPath("userData"), "last-workspace.json"))
  void restoreWorkspace()

  // The detected-project list rides the connector feed's ONE clock (no second timer here — this used to poll every
  // 10s for a value the session client had already fetched, so the list could be ~14s behind what it knew).
  onConnectorView.event(() => void refreshDetectedProjects(shell))
  void startConnectorFeed()
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
app.on("quit", () => shell.status?.dispose())
