// The IDE panel's data feed — the desktop counterpart of the extension's panel.ts. It projects a bound
// workspace into the SAME @volt/control view-model the VS Code panel renders (share the logic, not the
// pixels; the renderer draws it in shell.html), and drives the headless diagnostics collector.
import {
  VoltStatus,
  projectWorkspace,
  readBridgeVendor,
  readBoundProject,
  connectOptions,
  connectSurface,
  connectorStatus,
  collectDiagnostics,
  onboardingMode,
  type DriftItem,
  type WorkspaceView,
  type DetectedProject,
  type ConnectAction,
  type ConnectOption,
  type OnboardingMode,
} from "@volt/control"
import type { Shell } from "./context.js"

// The snapshot the renderer draws — the shared @volt/control view-model plus `bound` and the `surface`. The bound
// case spreads WorkspaceView, so a new field on the view-model reaches the renderer with nothing to update here; the
// unbound case only carries the empty arrays renderRail reads unconditionally. `surface` is the connection picker
// ALREADY partitioned + ordered by @volt/control (create vs reconnect; matching project first) — the renderer draws
// the groups, it never re-decides "which is primary". `onboarding` is the SHARED empty-state decision.
// The UI is vendor-blind: a project is identified by its NAME only — no vendor label rides to the renderer. Each
// project carries its connect `action` (init / connect / rebind) so the picker knows what clicking it does.
type LabeledProject = DetectedProject & { action: ConnectAction }
type Surface = { kind: "create" | "reconnect"; create: LabeledProject[]; primary: LabeledProject[]; alternates: LabeledProject[] }
// `awaiting` splits the unbound state: true = cold start, opencode's project not yet learned ("Connecting…");
// false = a known no-project state ("Open a PLC project…"). Rides both bound/unbound so the renderer reads it flat.
type Snap = { surface: Surface; connectorUp: boolean; onboarding: OnboardingMode; awaiting: boolean; bindStale: boolean } & (
  | { bound: false; incoming: DriftItem[]; outgoing: DriftItem[] }
  | ({ bound: true } & WorkspaceView)
)

// Exported for the panel smoke test — the shell → shared view-model projection is pure (no electron).
export function snapshot(shell: Shell): Snap {
  const vs = shell.status
  const bound = vs ? readBoundProject(vs.workspaceRoot) : undefined
  // The connection picker, partitioned + ordered by @volt/control (create vs reconnect; matching project first).
  // Name-only — the UI is vendor-blind. Both shells render THIS decision; neither re-derives the grouping.
  const label = (o: ConnectOption): LabeledProject => ({ ...o.project, action: o.action })
  const s = connectSurface(connectOptions(shell.projects, bound))
  const surface: Surface = { kind: s.kind, create: s.create.map(label), primary: s.primary.map(label), alternates: s.alternates.map(label) }
  const connectorUp = shell.connectorUp
  const onboarding = onboardingMode(connectorUp, shell.projects.length)
  const awaiting = shell.awaitingOpencode
  const bindStale = shell.bindStale
  if (!vs) return { bound: false, awaiting, bindStale, incoming: [], outgoing: [], surface, connectorUp, onboarding }
  return {
    bound: true,
    awaiting,
    bindStale,
    surface,
    connectorUp,
    onboarding,
    ...projectWorkspace({
      workspaceRoot: vs.workspaceRoot,
      status: vs.cached,
      health: vs.health,
      statusError: vs.statusError,
      vendor: readBridgeVendor(vs.workspaceRoot),
      boundProjectName: bound?.projectName,
      ideChanged: vs.ideChanged,
    }),
  }
}

export function pushStatus(shell: Shell): void {
  shell.win?.webContents.send("volt:status", snapshot(shell))
}

/** Refresh the detected-project list from the connector. Pushes to the renderer only when the list changes, so the
 *  10s poll is otherwise silent. Runs even when BOUND: the list also feeds the offline connection surface (pick your
 *  project to reconnect, or a renamed one to rebind) — not only the unbound init picker. */
export async function refreshDetectedProjects(shell: Shell): Promise<void> {
  // One connector probe drives BOTH the detected-project list AND whether the connector is even running, so the
  // surface can tell "connector not running" apart from "connector up, no IDE project open".
  const view = await connectorStatus()
  const next = view?.projects ?? []
  const up = view !== undefined
  const key = (ps: DetectedProject[]): string => ps.map((p) => p.id).sort().join("|")
  if (up === shell.connectorUp && key(next) === key(shell.projects)) return
  shell.projects = next
  shell.connectorUp = up
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
  shell.awaitingOpencode = false // opencode's state is now known
  shell.status?.dispose()
  shell.status = new VoltStatus(root)
  shell.status.onDidChange.event(() => pushStatus(shell))
  await shell.status.start()
  pushStatus(shell)
  void runDiagnostics(shell)
}

