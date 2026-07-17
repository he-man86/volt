// The IDE panel's data feed — the desktop counterpart of the extension's panel.ts. It projects a bound
// workspace into the SAME @volt/control view-model the VS Code panel renders (share the logic, not the
// pixels; the renderer draws it in shell.html), and drives the headless diagnostics collector.
import {
  VoltStatus,
  projectWorkspace,
  readBridgePort,
  vendorForPort,
  collectDiagnostics,
  type DriftItem,
  type WorkspaceView,
} from "@volt/control"
import type { Shell } from "./context.js"

// The snapshot the renderer draws — the shared @volt/control view-model plus `bound`. The bound case spreads
// WorkspaceView, so a new field on the view-model reaches the renderer with nothing to update here; the unbound
// case only carries the empty arrays renderRail reads unconditionally. (`paused` is a reason treated truthily.)
type Snap = { bound: false; incoming: DriftItem[]; outgoing: DriftItem[] } | ({ bound: true } & WorkspaceView)

function snapshot(vs: VoltStatus | null): Snap {
  if (!vs) return { bound: false, incoming: [], outgoing: [] }
  return {
    bound: true,
    ...projectWorkspace({
      workspaceRoot: vs.workspaceRoot,
      status: vs.cached,
      health: vs.health,
      statusError: vs.statusError,
      port: readBridgePort(vs.workspaceRoot),
    }),
  }
}

export function pushStatus(shell: Shell): void {
  shell.win?.webContents.send("volt:status", snapshot(shell.status))
}

let diagRunning = false
let diagPending = false
export async function runDiagnostics(shell: Shell): Promise<void> {
  const st = shell.status
  if (!st) return
  const port = readBridgePort(st.workspaceRoot)
  if (port === undefined) return // unbound workspace — nothing to diagnose (and no vendor to resolve)
  // Latest-wins: if a run is already in flight, mark that the currently-bound workspace still needs one and
  // let the finishing run re-fire — a fast project switch must not drop the NEW workspace's diagnostics.
  if (diagRunning) {
    diagPending = true
    return
  }
  diagRunning = true
  const root = st.workspaceRoot
  const vendor = vendorForPort(port)
  shell.win?.webContents.send("volt:diagnostics", { loading: true })
  try {
    const result = await collectDiagnostics(root, vendor)
    if (shell.status?.workspaceRoot === root) shell.win?.webContents.send("volt:diagnostics", { loading: false, ...result })
  } catch (err) {
    if (shell.status?.workspaceRoot === root) shell.win?.webContents.send("volt:diagnostics", { loading: false, error: (err as Error).message })
  } finally {
    diagRunning = false
    if (diagPending) {
      diagPending = false
      void runDiagnostics(shell) // re-run for whatever workspace is bound now
    }
  }
}

export async function bindWorkspace(shell: Shell, root: string): Promise<void> {
  shell.boundRoot = root // set synchronously so the header watcher won't re-bind the same dir mid-flight
  shell.status?.dispose()
  shell.status = new VoltStatus(root)
  shell.status.onDidChange.event(() => pushStatus(shell))
  await shell.status.start()
  pushStatus(shell)
  void runDiagnostics(shell)
}
