// Volt desktop shell.
// Volt owns the frame (frameless window + titlebar + toolbar + right IDE panel, see shell.html); opencode
// renders as the inner content pane in a WebContentsView. Spawns the INSTALLED opencode's server and loads
// its embedded GUI by URL — no opencode packages are bundled (opencode is a provisioned runtime).
// The IDE panel mirrors the volt-vscode sections (IDE Sync / Diagnostics / Bridge) over the SAME
// @volt/control the extension uses — share the logic, not the pixels. The active workspace
// follows the project opencode's GUI is on (sniffed from its x-opencode-directory header), like VS Code
// binding to its open folder.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  VoltStatus,
  healthDisplay,
  readBridgePort,
  setBundledCli,
  pull,
  push,
  build,
  init,
  collectDiagnostics,
  setLspServer,
  type StatusJson,
} from "@volt/control"

const BRIDGE_PORT = { codesys: 8556, twincat: 8555 } as const // CLAUDE.md: CODESYS 8556, Beckhoff 8555

const __dirname = dirname(fileURLToPath(import.meta.url))
// Installed opencode. Default: `opencode` on PATH. On Windows the PATH entry is a `.cmd` shim, which Node
// can't spawn without shell:true — so point OPENCODE_BIN at the real `opencode.exe`.
// ponytail: the installer resolves the provisioned .exe directly; PATH resolution isn't our problem to solve.
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode"
const READY = /listening on (https?:\/\/\S+)/i // matches `opencode serve` stdout
// Layout — keep in sync with shell.html. A thin icon rail is always reserved on the right; the panel
// expands beside it. opencode fills whatever's left.
const TITLEBAR_H = 40
const RAIL_W = 46
const PANEL_W = 320

let child: ReturnType<typeof spawn> | null = null

function startServer(): Promise<string> {
  // ponytail: parse the URL opencode prints instead of pre-choosing a port. Reject if it never prints one.
  return new Promise((resolve, reject) => {
    child = spawn(OPENCODE_BIN, ["serve"], { stdio: ["ignore", "pipe", "pipe"] })
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

// ── the snapshot the renderer draws (mirrors volt-vscode panel.ts's node model) ──
type Sub = "A" | "M" | "D"
interface Snap {
  bound: boolean // a project is open (tracked)
  initialized: boolean // …and it's a Volt workspace (.git/volt/config.json exists)
  workspaceRoot?: string
  health?: { label: string; tone: "ok" | "warn" | "error"; online: boolean }
  port?: number
  paused: boolean
  incoming: { name: string; sub: Sub }[]
  outgoing: { name: string; sub: Sub }[]
  error?: string
}

function names(cs: StatusJson["incoming"]): { name: string; sub: Sub }[] {
  return [
    ...cs.added.map((name) => ({ name, sub: "A" as Sub })),
    ...cs.modified.map((name) => ({ name, sub: "M" as Sub })),
    ...cs.removed.map((name) => ({ name, sub: "D" as Sub })),
  ]
}

function snapshot(vs: VoltStatus | null): Snap {
  if (!vs) return { bound: false, initialized: false, paused: false, incoming: [], outgoing: [] }
  const st = vs.cached
  const hd = healthDisplay(vs.health)
  const port = readBridgePort(vs.workspaceRoot) // defined ⇒ this folder is a bound Volt workspace
  const paused = !!(st && (st.projectMismatch !== null || st.merging !== null))
  return {
    bound: true,
    initialized: port !== undefined,
    workspaceRoot: vs.workspaceRoot,
    health: { label: hd.label, tone: hd.tone, online: hd.online },
    port,
    paused,
    incoming: st && !paused ? names(st.incoming) : [],
    outgoing: st && !paused ? names(st.outgoing) : [],
    error: vs.statusError,
  }
}

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

const { app, BrowserWindow, WebContentsView, ipcMain, shell } = await import("electron")

let win: import("electron").BrowserWindow | null = null
let view: import("electron").WebContentsView | null = null
let status: VoltStatus | null = null
let boundRoot: string | undefined // the project currently bound (from opencode's active dir / VOLT_WORKSPACE)
let panelOpen = false

function layoutView() {
  if (!win || !view) return
  const [w, h] = win.getContentSize()
  const right = RAIL_W + (panelOpen ? PANEL_W : 0) // rail is always visible; panel expands beside it
  view.setBounds({ x: 0, y: TITLEBAR_H, width: Math.max(0, w - right), height: Math.max(0, h - TITLEBAR_H) })
}

function pushStatus() {
  win?.webContents.send("volt:status", snapshot(status))
}

// volt-control spawns the volt CLI + LSP as node scripts (ELECTRON_RUN_AS_NODE). Point them at the built bins.
// ponytail: dev-monorepo paths (sibling packages' dist/). The packaged app resolves these from the bundled
// resources instead — wired up with the electron-builder packaging (the `distribution` change), not here.
function configureTools() {
  setBundledCli(join(__dirname, "..", "volt-git", "dist", "bin.js"))
  setLspServer(join(__dirname, "..", "volt-lsp-iec", "dist", "src", "bin.js"))
}

let diagRunning = false
async function runDiagnostics() {
  if (!status || diagRunning) return
  diagRunning = true
  win?.webContents.send("volt:diagnostics", { loading: true })
  const root = status.workspaceRoot
  const vendor = readBridgePort(root) === 8555 ? "twincat" : "codesys" // TwinCAT bridge = 8555, else CODESYS
  try {
    win?.webContents.send("volt:diagnostics", { loading: false, ...(await collectDiagnostics(root, vendor)) })
  } catch (err) {
    win?.webContents.send("volt:diagnostics", { loading: false, error: (err as Error).message })
  } finally {
    diagRunning = false
  }
}

async function bindWorkspace(root: string) {
  boundRoot = root // set synchronously so the header watcher won't re-bind the same dir mid-flight
  status?.dispose()
  status = new VoltStatus(root)
  status.onDidChange.event(() => pushStatus())
  await status.start()
  pushStatus()
  void runDiagnostics()
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
  view!.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const dir = activeDirFromRequest(details)
    if (dir !== undefined && dir !== boundRoot && existsSync(dir)) void bindWorkspace(dir)
    cb({ requestHeaders: details.requestHeaders })
  })
}

async function startWorkspace() {
  // An explicit override for dev; otherwise the workspace follows opencode's active project (watchActiveProject).
  const root = process.env.VOLT_WORKSPACE
  if (root && existsSync(root)) await bindWorkspace(root)
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    frame: false, // Volt draws the titlebar (shell.html) — not the OS
    backgroundColor: "#16120e",
    icon: join(__dirname, "assets", "volt-icon.ico"), // Volt taskbar/window icon
    webPreferences: { preload: join(__dirname, "preload.cjs") },
  })
  await win.loadFile(join(__dirname, "shell.html"))

  view = new WebContentsView()
  win.contentView.addChildView(view)
  layoutView()
  win.on("resize", layoutView)
  view.webContents.setWindowOpenHandler(({ url }) => (shell.openExternal(url), { action: "deny" }))

  configureTools()
  watchActiveProject() // bind to whatever project opencode's GUI is on
  void startWorkspace()

  try {
    const url = await startServer()
    await view.webContents.loadURL(url)
  } catch (err) {
    await view.webContents.loadURL(
      "data:text/html," +
        encodeURIComponent(`<body style="font:14px system-ui;padding:2rem;background:#16120e;color:#f3ead9">
      <h2>Volt couldn't start opencode</h2><p>${(err as Error).message}</p>
      <p>Install opencode, or set <code>OPENCODE_BIN</code> to its binary path.</p></body>`),
    )
  }
})

// window controls
ipcMain.on("win:minimize", () => win?.minimize())
ipcMain.on("win:maximize", () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
ipcMain.on("win:close", () => win?.close())

// IDE panel
ipcMain.on("volt:togglePanel", (_e, open: boolean) => {
  panelOpen = open
  layoutView()
})
ipcMain.handle("volt:pull", async () => {
  if (!status) return { kind: "error", message: "no workspace bound" }
  const out = await pull(status.workspaceRoot)
  await status.refresh(true)
  return out
})
ipcMain.handle("volt:push", async () => {
  if (!status) return { kind: "error", message: "no workspace bound" }
  const out = await push(status.workspaceRoot)
  await status.refresh(true)
  return out
})
ipcMain.handle("volt:build", async () => {
  if (!status) return { stdout: "", stderr: "no workspace bound", code: 255 }
  const r = await build(status.workspaceRoot)
  await status.refresh(true)
  void runDiagnostics() // a build can change diagnostics
  return r
})
ipcMain.on("volt:refresh", () => void status?.refresh(true))
ipcMain.on("volt:refreshDiagnostics", () => void runDiagnostics())
ipcMain.handle("volt:init", async (_e, vendor: "codesys" | "twincat") => {
  // Init the project opencode is on — no folder picker (like the extension initing its open workspace).
  const root = boundRoot
  if (root === undefined || !existsSync(root)) return { stdout: "", stderr: "No project open in opencode.", code: 255 }
  const out = await init(root, BRIDGE_PORT[vendor])
  if (out.code === 0) await bindWorkspace(root)
  return out
})

app.on("window-all-closed", () => app.quit())
app.on("quit", () => {
  status?.dispose()
  child?.kill()
})
