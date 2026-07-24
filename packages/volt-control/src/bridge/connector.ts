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
import { readBridgeVendor, readBoundProject, vendorLabel, type HealthState, type Vendor } from "./health.js"

const CONTROL_BASE = "http://127.0.0.1:8550"

/** One detected project — the vendor-agnostic unit the UI's init/connect surface lists (use case B). */
export interface DetectedProject {
  id: string
  displayName: string
  vendor: Vendor
  dirty: boolean
  /** The tray HIGHLIGHT — the project the user last picked. A UI nicety; it says nothing about whether sync
   *  works. Never derive connection state from it (see {@link DetectedProject.serving}). */
  connected: boolean
  /** GROUND TRUTH: this project's own bridge is serving it right now, so pull/push work. The ONE signal every
   *  surface renders connection state from. Absent on an older connector → treated as not serving, never as
   *  connected: guessing "connected" is the failure mode this field exists to end (a disconnected bridge stays
   *  listed, because that list is how you reconnect, so "detected" never meant "connected"). */
  serving?: boolean
  /** The bridge pipe serving it (per-pid for CODESYS) — the shells set it as VOLT_PIPE for `volt init`. */
  pipe?: string | null
  /** IDE version, shown in the label when a vendor has more than one live instance. */
  ideVersion?: string | null
  /** The name the workspace BINDING matches on (the vendor's health.ProjectName). Equals `displayName` for
   *  CODESYS, but for TwinCAT it's the TwinCAT project while `displayName` is the PLC sub-project — so binding
   *  lookups must use this, not `displayName`. */
  projectName?: string | null
  /** The bridge channel health for this row — only meaningful while {@link DetectedProject.serving}. Carries the
   *  degraded distinction so a bound workspace reads its full state off its own row, with no separate bridge view. */
  status?: "healthy" | "degraded"
}

/** The connector's status snapshot (mirrors C# `ConnectorView`, camelCased): nothing but the ONE unified,
 *  self-describing project list. Both status use cases read it — the connect surface is the list itself, and a
 *  bound workspace's live status is its own row. */
export interface ConnectorView {
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

/** The outcome of a Disconnect. `ok` — the connector took the request at all. `gated` — the BRIDGE accepted the
 *  deselect and is now refusing sync. They differ on a mixed install: an out-of-date bridge (mid-update, or a
 *  CODESYS in-proc host loaded before the gate shipped) has no `deselect` op and keeps serving `volt push`, so
 *  the selection clears and the UI would claim "disconnected" while sync still worked. Shells must warn on
 *  `ok && !gated` — a Disconnect button that silently does nothing is worse than no button. */
export interface DisconnectResult {
  ok: boolean
  gated: boolean
  /** Why, when `gated` is false: `unsupported` = an out-of-date bridge that KEEPS SYNCING (restart that IDE);
   *  `unreachable` = its IDE is already gone, so there is nothing to warn about. Collapsing these told people to
   *  go fix an out-of-date bridge when they had simply closed the IDE. */
  reason?: "gated" | "unsupported" | "unreachable"
}

/** Disconnect the active connection (POST /disconnect). Every activated host stays LIVE — the bridge just stops
 *  serving sync until the next connect. Never throws (connector down → {ok:false}). */
export async function disconnect(projectId?: string, timeoutMs = 4_000): Promise<DisconnectResult> {
  try {
    // Name the project. A frontend disconnects the project ITS workspace is bound to, which is frequently not the
    // tray's active connection — without this, clicking Disconnect in one window gated a DIFFERENT project and
    // silently stopped another workspace's sync while the row that was clicked stayed connected.
    const res = await fetch(`${CONTROL_BASE}/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(projectId !== undefined ? { projectId } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, gated: false }
    // `gated` is absent on an older CONNECTOR (it answered a bare {ok:true}); that connector can't have gated the
    // bridge either, so absent must read as false — never as success.
    const body = (await res.json().catch(() => ({}))) as { gated?: boolean; reason?: DisconnectResult["reason"] }
    return { ok: true, gated: body.gated === true, reason: body.reason }
  } catch {
    return { ok: false, gated: false }
  }
}

/** The connector's id for the project THIS workspace is bound to, or undefined when it isn't detected. Shells
 *  pass it to {@link disconnect} so they act on their own project rather than the tray's active one. */
export async function boundProjectId(workspaceRoot: string): Promise<string | undefined> {
  const bound = readBoundProject(workspaceRoot)
  if (bound === undefined) return undefined
  const projects = await detectedProjects()
  return projects.find((p) => p.vendor === bound.vendor && (p.projectName ?? p.displayName) === bound.projectName)?.id
}

/** The bound workspace's live connection status (use case A). PER-WORKSPACE: it reflects whether THIS workspace's
 *  bound project is live (its host is serving), NOT the connector's single global "active connection" — so two
 *  frontends bound to two projects each show their own status correctly (with per-pid pipes both hosts are live,
 *  there's no stealing). `unknown` when unbound, `unreachable` when the connector is down. */
export async function boundStatus(workspaceRoot: string): Promise<HealthState> {
  const bound = readBoundProject(workspaceRoot)
  const vendor = bound?.vendor ?? readBridgeVendor(workspaceRoot)
  if (vendor === undefined) return { kind: "unknown" }

  const view = await connectorStatus()
  if (view === undefined) return { kind: "unreachable", reason: "Volt Connector not running" }

  // THIS workspace's row. Match on the binding name (projectName === health.ProjectName), NOT displayName — for
  // TwinCAT displayName is the PLC sub-project, so it would never equal the bound TwinCAT-project name. Fall back to
  // displayName (older connector without projectName / CODESYS, where they're equal). An old binding with no project
  // name at all falls back to the vendor's serving row.
  const proj = bound
    ? view.projects.find((p) => p.vendor === vendor && (p.projectName ?? p.displayName) === bound.projectName)
    : view.projects.find((p) => p.vendor === vendor && p.serving) ?? view.projects.find((p) => p.vendor === vendor)

  return healthStateOf(proj, vendor, bound?.projectName)
}

/** Derive the workspace's HealthState from its project row (or its absence). Connection state comes ONLY from
 *  `serving`: a detected-but-not-serving project is a gated bridge (disconnected), never connected — treating
 *  "detected" as "connected" is what let the UI claim a connection against a gated bridge. Degraded comes off the
 *  row's own `status`, so there is no separate per-vendor bridge view. */
function healthStateOf(proj: DetectedProject | undefined, vendor: Vendor, boundName?: string): HealthState {
  const ideName = vendorLabel(vendor)
  if (proj?.serving !== true)
    return {
      kind: "disconnected",
      health: { status: "unavailable", connected: false, ideName, projectName: proj?.projectName ?? proj?.displayName ?? boundName ?? null },
    }
  const degraded = proj.status === "degraded"
  return {
    kind: degraded ? "degraded" : "connected",
    health: {
      status: degraded ? "degraded" : "healthy",
      connected: true,
      ideName,
      projectName: proj.projectName ?? proj.displayName,
      projectDirty: proj.dirty,
    },
  }
}
