// The IDE panel's data feed — the desktop counterpart of the extension's panel.ts. It projects a bound
// workspace into the SAME @volt/control view-model the VS Code panel renders (share the logic, not the
// pixels; the renderer draws it in shell.html), and drives the headless diagnostics collector.
import {
  VoltStatus,
  projectWorkspace,
  readBridgeVendor,
  detectedProjects,
  collectDiagnostics,
  type DriftItem,
  type WorkspaceView,
  type DetectedProject,
} from "@volt/control"
import type { Shell } from "./context.js"

// The snapshot the renderer draws — the shared @volt/control view-model plus `bound` and the detected `projects`.
// The bound case spreads WorkspaceView, so a new field on the view-model reaches the renderer with nothing to
// update here; the unbound case only carries the empty arrays renderRail reads unconditionally. `projects` rides
// on both so the init surface (pick a project) renders the same regardless of bound state.
type Snap = { projects: DetectedProject[] } & (
  | { bound: false; incoming: DriftItem[]; outgoing: DriftItem[] }
  | ({ bound: true } & WorkspaceView)
)

// Exported for the panel smoke test — the shell → shared view-model projection is pure (no electron).
export function snapshot(shell: Shell): Snap {
  const projects = shell.projects
  const vs = shell.status
  if (!vs) return { bound: false, incoming: [], outgoing: [], projects }
  return {
    bound: true,
    projects,
    ...projectWorkspace({
      workspaceRoot: vs.workspaceRoot,
      status: vs.cached,
      health: vs.health,
      statusError: vs.statusError,
      vendor: readBridgeVendor(vs.workspaceRoot),
    }),
  }
}

export function pushStatus(shell: Shell): void {
  shell.win?.webContents.send("volt:status", snapshot(shell))
}

/** Refresh the detected-project list from the connector — the init surface. Pushes to the renderer only when the
 *  list changes, so the 10s poll is otherwise silent. Skipped once a Volt workspace is bound (the sync actions
 *  show instead of the init picker). */
export async function refreshDetectedProjects(shell: Shell): Promise<void> {
  if (shell.status && readBridgeVendor(shell.status.workspaceRoot) !== undefined) return
  const next = await detectedProjects()
  const key = (ps: DetectedProject[]): string => ps.map((p) => p.id).sort().join("|")
  if (key(next) === key(shell.projects)) return
  shell.projects = next
  pushStatus(shell)
}

let diagRunning = false
let diagPending = false
export async function runDiagnostics(shell: Shell): Promise<void> {
  const st = shell.status
  if (!st) return
  const vendor = readBridgeVendor(st.workspaceRoot)
  if (vendor === undefined) return // unbound workspace — nothing to diagnose
  // Latest-wins: if a run is already in flight, mark that the currently-bound workspace still needs one and
  // let the finishing run re-fire — a fast project switch must not drop the NEW workspace's diagnostics.
  if (diagRunning) {
    diagPending = true
    return
  }
  diagRunning = true
  const root = st.workspaceRoot
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
