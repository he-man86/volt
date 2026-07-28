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
import { readBridgeVendor, readBoundProject, type BoundProject, type HealthState, type Vendor } from "./health.js"

// The connector's control plane. Fixed at :8550 in production (the one port every client knows); an e2e can point
// the real client at a test harness on another port via VOLT_CONTROL_BASE. Read lazily so the override can be set
// after this module is imported.
function controlBase(): string {
  return process.env.VOLT_CONTROL_BASE || "http://127.0.0.1:8550"
}

/** One detected project — the vendor-agnostic unit the UI's init/connect surface lists (use case B). */
export interface DetectedProject {
  id: string
  displayName: string
  vendor: Vendor
  dirty: boolean
  /** The bridge pipe serving it (per-pid for CODESYS) — the shells set it as VOLT_PIPE for `volt init`. */
  pipe?: string | null
  /** IDE version, shown in the label when a vendor has more than one live instance. */
  ideVersion?: string | null
  /** The name the workspace BINDING matches on (the vendor's health.ProjectName). Equals `displayName` for
   *  CODESYS, but for TwinCAT it's the TwinCAT project while `displayName` is the PLC sub-project — so binding
   *  lookups must use this, not `displayName`. Always present (the connector stamps every row). */
  projectName: string
  /** GROUND TRUTH: the row's full connection state — "idle" (detected, not the served one), "healthy" (served,
   *  channel OK), "degraded" (served, recent errors). Connection state is read from THIS ({@link isServing}), never
   *  from the project merely appearing in the list (a disconnected bridge stays listed — that list is how you
   *  reconnect, so "detected" never meant "connected"). Absent → not serving. */
  status?: "idle" | "healthy" | "degraded"
}

/** Is this project's bridge serving it right now (pull/push work) — a non-idle row. The ONE connection-state
 *  predicate every surface uses; `serving` folded into `status`, so a missing/idle status reads as not serving. */
export function isServing(p: DetectedProject | undefined): boolean {
  return p?.status === "healthy" || p?.status === "degraded"
}

/** Does this detected project satisfy a workspace's binding — same vendor AND the binding name (`projectName`)? The
 *  ONE "is this MY project" predicate, shared by the session client's interest resolution, boundStatus, and
 *  connectOptions. */
export function matchesBinding(p: DetectedProject, bound: BoundProject): boolean {
  return p.vendor === bound.vendor && p.projectName === bound.projectName
}

/** What clicking a detected project in the connection surface does:
 *  - `init`    — the folder is unbound: first-time set up (git init + pull).
 *  - `connect` — it matches this workspace's binding: a plain reconnect.
 *  - `rebind`  — a DIFFERENT project (typically the bound one, renamed in the IDE): re-point the binding to it
 *                (confirm first). This REPLACES the old project-mismatch "accept rename" flow — a rename is just a
 *                project in the list under a new name. */
export type ConnectAction = "init" | "connect" | "rebind"
export interface ConnectOption {
  project: DetectedProject
  action: ConnectAction
}

/** Tag every detected project with what picking it does for a given binding (undefined ⇒ unbound folder, so every
 *  option is a first-time `init`). Shared so both shells render the SAME picker rather than each re-deciding. */
export function connectOptions(projects: DetectedProject[], bound: BoundProject | undefined): ConnectOption[] {
  return projects.map((project) => ({
    project,
    action: bound === undefined ? "init" : matchesBinding(project, bound) ? "connect" : "rebind",
  }))
}

/** The connection surface, partitioned so both shells frame + emphasize it identically instead of each re-deciding
 *  (they diverged before — the desktop rendered every reconnect option with equal weight and neither put the
 *  matching project first). A surface is homogeneous by construction: `connectOptions` tags every option `init` for
 *  an unbound folder (⇒ `create`) or connect/rebind for a bound one (⇒ `reconnect`). */
export interface ConnectSurface {
  /** `create` — an unbound folder being set up from a live IDE project (all options `init`). `reconnect` — a bound,
   *  offline workspace being re-attached (its matching project + any others to rebind to instead). */
  kind: "create" | "reconnect"
  /** create only: the IDE projects a new workspace can be created from. */
  create: ConnectOption[]
  /** reconnect only: the option(s) matching this workspace's binding — a plain reconnect, shown FIRST and primary. */
  primary: ConnectOption[]
  /** reconnect only: other detected projects, offered as "bind to a different one instead" (rebind) — demoted. */
  alternates: ConnectOption[]
}

export function connectSurface(options: ConnectOption[]): ConnectSurface {
  const create = options.filter((o) => o.action === "init")
  if (create.length > 0) return { kind: "create", create, primary: [], alternates: [] }
  return {
    kind: "reconnect",
    create: [],
    primary: options.filter((o) => o.action === "connect"),
    alternates: options.filter((o) => o.action === "rebind"),
  }
}

/** The connector's status snapshot (mirrors C# `ConnectorView`, camelCased): nothing but the ONE unified,
 *  self-describing project list. Both status use cases read it — the connect surface is the list itself, and a
 *  bound workspace's live status is its own row. */
export interface ConnectorView {
  projects: DetectedProject[]
}

// While the connector feed runs, its sync poll IS the view (declare + renew + read in one call) and nothing else
// may go asking. The session client (session.ts) registers a getter here that answers `undefined` when no feed is
// running, and an ENVELOPE when one is — so "the feed says the connector is down" is distinguishable from "nobody
// is feeding me". Without that distinction every read during an outage fell through to a 2s-timeout GET.
// Registered via a hook so connector.ts never imports session.ts (one-way dep).
let sessionViewGetter: (() => { view: ConnectorView | undefined } | undefined) | undefined
export function registerSessionView(getter: () => { view: ConnectorView | undefined } | undefined): void {
  sessionViewGetter = getter
}

/** The connector's aggregated status: the running feed's view, or — for a one-shot caller with no feed — a direct
 *  GET. Never throws; the connector being down (or any fetch/parse error) resolves to `undefined`, which callers
 *  render as "no projects / start Volt". */
export async function connectorStatus(timeoutMs = 2_000): Promise<ConnectorView | undefined> {
  const feed = sessionViewGetter?.()
  if (feed !== undefined) return feed.view
  try {
    const res = await fetch(`${controlBase()}/status`, { signal: AbortSignal.timeout(timeoutMs) })
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

  // THIS workspace's row, matched on the binding name (projectName === health.ProjectName) — NOT displayName, which
  // for TwinCAT is the PLC sub-project and would never equal the bound TwinCAT-project name. A config with a vendor
  // but no bound project (only reachable mid-init) takes the vendor's serving row.
  const proj = bound
    ? view.projects.find((p) => matchesBinding(p, bound))
    : view.projects.find((p) => p.vendor === vendor && isServing(p)) ?? view.projects.find((p) => p.vendor === vendor)

  return healthStateOf(proj, bound?.projectName)
}

/** Derive the workspace's HealthState from its project row (or its absence). Connection state comes ONLY from the
 *  row's `status` (via {@link isServing}): a detected-but-idle project is a gated bridge (disconnected), never
 *  connected — treating "detected" as "connected" is what let the UI claim a connection against a gated bridge.
 *  Degraded comes off the same `status`, so there is no separate per-vendor bridge view. */
function healthStateOf(proj: DetectedProject | undefined, boundName?: string): HealthState {
  // Not serving = undefined row, or a row whose status is idle/absent (the explicit undefined check narrows `proj`
  // to a defined row below, where its status is necessarily "healthy" | "degraded").
  if (proj === undefined || (proj.status !== "healthy" && proj.status !== "degraded"))
    return {
      kind: "disconnected",
      health: { connected: false, projectName: proj?.projectName ?? boundName ?? null },
    }
  const degraded = proj.status === "degraded"
  return {
    kind: degraded ? "degraded" : "connected",
    health: {
      connected: true,
      projectName: proj.projectName,
      projectDirty: proj.dirty,
    },
  }
}
