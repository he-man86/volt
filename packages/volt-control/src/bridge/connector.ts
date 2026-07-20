/**
 * The connector control-plane client — the SINGLE source of live IDE/bridge **connection status** for the UI.
 *
 * The connector (`Volt.Cli.Connector`) is the one always-on aggregator: it probes every bridge's health and
 * enumerates every project across vendors, and serves the result at `GET http://127.0.0.1:8550/status`
 * (`ConnectorView`). So the UI reads connection status HERE — it does not re-probe the bridge pipes itself. This
 * covers both status use cases: (A) the bound workspace's live status, and (B) the detected-project list that is
 * the init/connect surface.
 *
 * The split the whole product follows: **connection STATUS ← this client; git-native COMMANDS ← the `volt` CLI**
 * (`volt status` git drift included — it needs the local repo the connector knows nothing about). Never throws:
 * the connector being down resolves to an empty/unreachable state the UI renders as "start Volt".
 */
import { readBridgeVendor, readBoundProject, type BridgeHealth, type HealthState, type Vendor } from "./health.js"

const CONTROL_BASE = "http://127.0.0.1:8550"

/** One detected project — the vendor-agnostic unit the UI's init/connect surface lists (use case B). */
export interface DetectedProject {
  id: string
  displayName: string
  vendor: Vendor
  dirty: boolean
  connected: boolean
  /** The bridge pipe serving it (per-pid for CODESYS) — the shells set it as VOLT_PIPE for `volt init`. */
  pipe?: string | null
  /** IDE version, shown in the label when a vendor has more than one live instance. */
  ideVersion?: string | null
  /** The name the workspace BINDING matches on (the vendor's health.ProjectName). Equals `displayName` for
   *  CODESYS, but for TwinCAT it's the TwinCAT project while `displayName` is the PLC sub-project — so binding
   *  lookups must use this, not `displayName`. */
  projectName?: string | null
}

/** Per-vendor live bridge health from the connector (use case A) — the connector's `BridgeStatus` word. */
export interface BridgeStatusView {
  vendor: Vendor
  displayName: string
  status: "Connected" | "Degraded" | "Unavailable" | "Unreachable" | "Unknown"
  projectName: string | null
  dirty: boolean
  activeOp: string | null
}

/** The connector's one status snapshot (mirrors C# `ConnectorView`, camelCased). */
export interface ConnectorView {
  status: string
  bridges: BridgeStatusView[]
  projects: DetectedProject[]
}

/** GET the connector's aggregated status. Never throws — the connector being down (or any fetch/parse error)
 *  resolves to `undefined`, which callers render as "no projects / start Volt". */
export async function connectorStatus(timeoutMs = 2_000): Promise<ConnectorView | undefined> {
  try {
    const res = await fetch(`${CONTROL_BASE}/status`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return undefined
    return (await res.json()) as ConnectorView
  } catch {
    return undefined
  }
}

/** The unified detected-project list — the init/connect surface (use case B). Empty when the connector is down
 *  or no IDE has a project open. */
export async function detectedProjects(): Promise<DetectedProject[]> {
  return (await connectorStatus())?.projects ?? []
}

/** Bind the bridge to a detected project (POST /connect). Returns whether the connector accepted it. */
export async function connectProject(projectId: string, timeoutMs = 4_000): Promise<boolean> {
  try {
    const res = await fetch(`${CONTROL_BASE}/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return false
    return ((await res.json()) as { ok?: boolean }).ok === true
  } catch {
    return false
  }
}

/** Clear the active connection (POST /disconnect). Every activated host stays live — this only deselects, so the
 *  user can switch by connecting another. Never throws (connector down → false). */
export async function disconnect(timeoutMs = 4_000): Promise<boolean> {
  try {
    const res = await fetch(`${CONTROL_BASE}/disconnect`, { method: "POST", signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** The bound workspace's live connection status (use case A). PER-WORKSPACE: it reflects whether THIS workspace's
 *  bound project is live (its host is serving), NOT the connector's single global "active connection" — so two
 *  frontends bound to two projects each show their own status correctly (with per-pid pipes both hosts are live,
 *  there's no stealing). `unknown` when unbound, `unreachable` when the connector is down. */
export async function boundStatus(workspaceRoot: string): Promise<HealthState> {
  const bound = readBoundProject(workspaceRoot)
  if (bound === undefined) {
    // An old/malformed binding without a project name → fall back to the vendor bridge view (backward compat).
    const vendor = readBridgeVendor(workspaceRoot)
    if (vendor === undefined) return { kind: "unknown" }
    const v = await connectorStatus()
    if (v === undefined) return { kind: "unreachable", reason: "Volt Connector not running" }
    return toHealthState(v.bridges.find((b) => b.vendor === vendor))
  }
  const view = await connectorStatus()
  if (view === undefined) return { kind: "unreachable", reason: "Volt Connector not running" }

  // Match on the binding name (projectName === health.ProjectName), NOT displayName — for TwinCAT displayName is
  // the PLC sub-project, so displayName would never equal the bound TwinCAT-project name. Fall back to displayName
  // for an older connector that doesn't send projectName (and CODESYS, where they're equal).
  const matches = (p: DetectedProject) => (p.projectName ?? p.displayName) === bound.projectName
  const proj = view.projects.find((p) => p.vendor === bound.vendor && matches(p))
  const bridge = view.bridges.find((b) => b.vendor === bound.vendor)
  if (proj === undefined) {
    // The bound project's IDE isn't serving it (not open, or its bridge is down) — not the active one either way.
    return {
      kind: "disconnected",
      health: { status: "unavailable", connected: false, ideName: bridge?.displayName ?? bound.vendor, projectName: bound.projectName },
    }
  }
  // Detected → its host is live, so THIS workspace is connected. When it's also the global active connection the
  // vendor bridge view carries full fidelity (activeOp etc.); otherwise report a plain live-and-connected state.
  if (proj.connected && bridge !== undefined) return toHealthState(bridge)
  return {
    kind: "connected",
    health: {
      status: "healthy",
      connected: true,
      ideName: bridge?.displayName ?? bound.vendor,
      projectName: bound.projectName,
      projectDirty: proj.dirty,
    },
  }
}

/** Map the connector's per-vendor `BridgeStatusView` to the UI's `HealthState` (so consumers keep their type). */
function toHealthState(b: BridgeStatusView | undefined): HealthState {
  if (b === undefined) return { kind: "unknown" }
  const health: BridgeHealth = {
    status: b.status === "Connected" ? "healthy" : b.status === "Degraded" ? "degraded" : "unavailable",
    connected: b.status === "Connected" || b.status === "Degraded",
    ideName: b.displayName,
    projectName: b.projectName,
    projectDirty: b.dirty,
    activeOp: b.activeOp,
  }
  switch (b.status) {
    case "Connected":
      return { kind: "connected", health }
    case "Degraded":
      return { kind: "degraded", health }
    case "Unreachable":
      return { kind: "unreachable", reason: "no bridge running" }
    default: // Unavailable (up, no project) / Unknown
      return { kind: "disconnected", health }
  }
}
