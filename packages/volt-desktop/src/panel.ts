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
  connectWorkspace,
  voltLog,
  type DriftItem,
  type WorkspaceView,
  type DetectedProject,
  type ConnectAction,
  type ConnectOption,
  type OnboardingMode,
} from "@volt/control"
import { writeRecent } from "./recent.js"
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
// `awaiting` splits the unbound state: true = the connector hasn't been probed yet ("Looking for open PLC
// projects…"); false = a known empty state. Without it the first second claims the connector is down before we
// have asked it. Rides both bound/unbound so the renderer reads it flat.
type Snap = { surface: Surface; connectorUp: boolean; onboarding: OnboardingMode; awaiting: boolean } & (
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
  const awaiting = shell.awaiting
  if (!vs) return { bound: false, awaiting, incoming: [], outgoing: [], surface, connectorUp, onboarding }
  return {
    bound: true,
    awaiting,
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
 *  connector feed is otherwise silent. Runs even when BOUND: the list also feeds the offline connection surface (pick your
 *  project to reconnect, or a renamed one to rebind) — not only the unbound init picker. */
export async function refreshDetectedProjects(shell: Shell): Promise<void> {
  // One connector probe drives BOTH the detected-project list AND whether the connector is even running, so the
  // surface can tell "connector not running" apart from "connector up, no IDE project open".
  const view = await connectorStatus()
  const next = view?.projects ?? []
  const up = view !== undefined
  const key = (ps: DetectedProject[]): string => ps.map((p) => p.id).sort().join("|")
  // Clear the cold-start flag FIRST: on a machine with the connector down and no projects, nothing below changes,
  // so an early return here would leave the panel spinning on "Looking for…" forever.
  const wasAwaiting = shell.awaiting
  shell.awaiting = false
  if (!wasAwaiting && up === shell.connectorUp && key(next) === key(shell.projects)) return
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
  voltLog("desktop", `binding workspace ${root}`)
  shell.boundRoot = root // set synchronously so a second bind can't race this one mid-flight
  writeRecent(root) // this is the workspace to come back to on the next launch
  shell.status?.dispose()
  shell.status = new VoltStatus(root)
  shell.status.onDidChange.event(() => pushStatus(shell))
  await shell.status.start()
  pushStatus(shell)
  void runDiagnostics(shell)
  // The active project view owns the connection: connect the bridge on bind, through the SAME shared flow the
  // manual Connect button runs — so an auto-connect settles health cheaply and only re-scans drift if it actually
  // connected (this used to fire a full `volt status` either way, i.e. an IDE walk against a bridge that was not
  // serving). Fire-and-forget so the panel shows the project immediately; a fast rebind disposes this tracker,
  // which makes the settle a no-op. The failure is LOGGED, not popped up: an automatic connect must not interrupt,
  // and the panel already states it — health carries why (connector unreachable vs project not serving) and the
  // reconnect surface offers the fix. The log is what turns "it just says not connected" into a diagnosable event.
  const st = shell.status
  void connectWorkspace(st).then((view) =>
    voltLog("desktop", `auto-connect ${root}: ${view.message}`, view.tone === "error" ? "warn" : "info"),
  )
}


