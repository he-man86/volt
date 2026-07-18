// The IDE panel's data feed — the desktop counterpart of the extension's panel.ts. It projects a bound
// workspace into the SAME @volt/control view-model the VS Code panel renders (share the logic, not the
// pixels; the renderer draws it in shell.html), and drives the headless diagnostics collector.
import {
  VoltStatus,
  projectWorkspace,
  readBridgeVendor,
  probeVendors,
  isBridgeOnline,
  collectDiagnostics,
  type DriftItem,
  type WorkspaceView,
} from "@volt/control"
import type { Shell } from "./context.js"

// The snapshot the renderer draws — the shared @volt/control view-model plus `bound` and `vendorsLive`. The bound
// case spreads WorkspaceView, so a new field on the view-model reaches the renderer with nothing to update here;
// the unbound case only carries the empty arrays renderRail reads unconditionally. (`paused` is a reason treated
// truthily.) `vendorsLive` rides on both so the Initialize buttons gate the same way regardless of bound state.
type Snap = { vendorsLive: { codesys: boolean; twincat: boolean } } & (
  | { bound: false; incoming: DriftItem[]; outgoing: DriftItem[] }
  | ({ bound: true } & WorkspaceView)
)

function snapshot(shell: Shell): Snap {
  const vendorsLive = shell.vendorsLive
  const vs = shell.status
  if (!vs) return { bound: false, incoming: [], outgoing: [], vendorsLive }
  return {
    bound: true,
    vendorsLive,
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

/** Probe both vendor bridge ports so the renderer enables each Initialize button only when that vendor's IDE is
 *  actually live with a project — mirrors the VS Code welcome's codesysLive/twincatLive gating. Pushes to the
 *  renderer only when the live set changes, so the 10s poll is otherwise silent. */
export async function refreshVendorsLive(shell: Shell): Promise<void> {
  // The Initialize buttons only show while no Volt workspace is bound (an initialized one shows the sync actions
  // instead), so once bound there's nothing to gate — skip the probe entirely, like VS Code probing only unbound.
  if (shell.status && readBridgeVendor(shell.status.workspaceRoot) !== undefined) return
  const probes = await probeVendors()
  const live = (v: "twincat" | "codesys"): boolean => probes.some((p) => p.vendor === v && isBridgeOnline(p.state))
  const next = { codesys: live("codesys"), twincat: live("twincat") }
  if (next.codesys === shell.vendorsLive.codesys && next.twincat === shell.vendorsLive.twincat) return
  shell.vendorsLive = next
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
