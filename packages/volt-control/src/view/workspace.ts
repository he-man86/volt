/**
 * Per-workspace drift view-model — one projection of a bound workspace's IDE-sync state, so neither shell
 * re-derives A/M/D tags, the paused reason, or the `src/`-strip. Node-free: the caller (VS Code extension
 * host / desktop main — both Node) supplies `vendor` (read via readBridgeVendor in their context); this stays
 * pure so it's unit-testable without a filesystem and both frontends render the same model.
 */
import { type HealthState, type Vendor } from "../bridge/health.js"
import type { StatusJson } from "./types.js"
import { healthDisplay, type HealthDisplay } from "./display.js"

/** One drifted item, direction implied by which array it's in. `relPath` is tree-relative (`src/` stripped);
 *  a shell builds its own affordance from it (VS Code its `vscode.diff` command, desktop a row). */
export interface DriftItem {
  name: string
  sub: "A" | "M" | "D"
  relPath: string
}

/** One conflicted file in an in-progress merge. `relPath` is tree-relative — exactly what
 *  `volt merge --resolve <relPath> --use-ours|--use-theirs` takes for per-file take-a-side resolution. */
export interface ConflictItem {
  name: string
  relPath: string
}

export interface WorkspaceInput {
  workspaceRoot: string
  status?: StatusJson
  health: HealthState
  statusError?: string
  /** From readBridgeVendor in the caller's Node context; defined ⇒ this folder is an initialized Volt workspace. */
  vendor?: Vendor
  /** The bound project's name (`readBoundProject`), so the offline connection row can name THIS workspace's project
   *  even when the IDE-reported health label can't (it reads "No project loaded" while the bridge is down). */
  boundProjectName?: string
  /** The IDE was edited since the last full refresh (VoltStatus.ideChanged) — surfaced as a "Refresh to check" hint,
   *  never an auto-walk. */
  ideChanged?: boolean
}

/** The one state machine both frontends switch on to decide what the IDE-Sync surface shows. Derived once here
 *  so the extension and the desktop never re-derive (and drift). `uninitialized` is the onboarding state — see
 *  {@link onboardingMode}, which splits it. */
export type SyncMode = "uninitialized" | "merging" | "offline" | "ready"

/** Precedence: a local merge must be resolvable even when the bridge is down, so it outranks `offline`;
 *  `ready` (the action row + drift) only when initialized, online, and not merging. */
export function syncMode(initialized: boolean, paused: WorkspaceView["paused"], online: boolean): SyncMode {
  if (!initialized) return "uninitialized"
  if (paused === "merging") return "merging"
  if (!online) return "offline"
  return "ready"
}

/** The header's one connection state-word + action. `disconnect` while syncing; `connect` = "not syncing" (the
 *  reconnect surface is the detected-project list below — pick your project to reconnect, or a renamed one to
 *  rebind — never a single button, so a rename is just another project in that list). */
export type ConnectionAction = "connect" | "disconnect"

/** The bound-connection affordance, decided ONCE here so both shells render an identical decision (they diverged
 *  before — one stacked accept-rename on connect/disconnect, the other made it outrank). Each shell maps the enum
 *  to its own widget (VS Code TreeNode / desktop DOM); only the DECISION lives here. */
export interface ConnectionAffordance {
  /** Row-1 status word — whether THIS workspace's bridge is serving it. */
  caption: "connected" | "not connected"
  /** The one primary action to offer. */
  action: ConnectionAction
}

export function connectionAffordance(view: Pick<WorkspaceView, "health">): ConnectionAffordance {
  return view.health.online
    ? { caption: "connected", action: "disconnect" }
    : { caption: "not connected", action: "connect" }
}

/** How an UNBOUND folder gets connected — the three states of the onboarding ladder, which the connection
 *  surface (VS Code's "IDE Connection" view / the desktop's section) renders one row-set per. */
export type OnboardingMode =
  /** The connector isn't answering — nothing can be detected until Volt is started. */
  | "no-connector"
  /** Connector up, but no IDE has a project open (or CODESYS isn't activated). */
  | "no-project"
  /** Projects are detected — name them and let the user pick which one this folder binds to. */
  | "choose-project"

/** This used to be left to each shell ("split `uninitialized` yourself"), and they promptly diverged — different
 *  states, different wording, and one of them couldn't tell "connector down" (start Volt) from "no project open"
 *  (open one), which need opposite fixes. It's three lines; it lives here so both shells answer identically. */
export function onboardingMode(connectorUp: boolean, projectCount: number): OnboardingMode {
  if (!connectorUp) return "no-connector"
  return projectCount > 0 ? "choose-project" : "no-project"
}

export interface WorkspaceView {
  initialized: boolean
  workspaceRoot: string
  /** The bound vendor — what the UI shows. */
  vendor?: Vendor
  /** The bound project's name (from the binding) — lets a shell match detected projects to THIS workspace
   *  (connect vs rebind) without re-reading the binding file. */
  boundProjectName?: string
  /** Row-1 connection label the shells render verbatim (no vendor branching in the UI): the IDE-reported
   *  "&lt;IDE&gt; — &lt;project&gt;" when online, else the binding's own "&lt;VENDOR&gt; — &lt;project&gt;" so an
   *  offline row still names this workspace's project (the health label there is just "No project loaded"). */
  connectionLabel: string
  health: HealthDisplay
  /** Set while a local merge is in progress (resolvable even with the bridge down), else null. */
  paused: "merging" | null
  /** The single state both shells render from — gates the action row, the Connect affordance, and the drift list. */
  mode: SyncMode
  /** The bound-connection affordance (caption + the ONE action + whether to show the vendor row) — carried on the
   *  view so neither shell re-derives it (see {@link connectionAffordance}). */
  affordance: ConnectionAffordance
  /** The IDE was edited since the last full refresh — a HINT for the shell to prompt "Refresh to check for incoming"
   *  (detecting it is cheap; computing the incoming list is the IDE-freezing walk, so it runs only on that refresh). */
  ideChanged: boolean
  incoming: DriftItem[]
  outgoing: DriftItem[]
  /** Conflicted files while `paused === "merging"` (empty otherwise) — drives per-file take-a-side rows. */
  conflicts: ConflictItem[]
  error?: string
}

function driftItems(status: StatusJson, dir: "incoming" | "outgoing"): DriftItem[] {
  const cs = dir === "incoming" ? status.incoming : status.outgoing
  const tag = (names: string[], sub: DriftItem["sub"]): DriftItem[] =>
    names.map((name) => {
      const raw = status.pathByName[name] ?? name
      return { name, sub, relPath: raw.startsWith("src/") ? raw.slice(4) : raw }
    })
  return [...tag(cs.added, "A"), ...tag(cs.modified, "M"), ...tag(cs.removed, "D")]
}

export function projectWorkspace(input: WorkspaceInput): WorkspaceView {
  const st = input.status
  const paused: WorkspaceView["paused"] = st?.merging != null ? "merging" : null
  const initialized = input.vendor !== undefined
  const health = healthDisplay(input.health)
  // Vendor-blind: a workspace is identified by its PROJECT NAME (from the binding), never the vendor. Prefer the
  // bound name; fall back to the IDE-derived health label only when the binding has no project name (older binding).
  const connectionLabel = input.boundProjectName ?? health.label
  return {
    initialized,
    workspaceRoot: input.workspaceRoot,
    vendor: input.vendor,
    boundProjectName: input.boundProjectName,
    connectionLabel,
    health,
    paused,
    mode: syncMode(initialized, paused, health.online),
    affordance: connectionAffordance({ health }),
    ideChanged: input.ideChanged === true && paused === null, // only meaningful while actively syncing (not mid-merge/mismatch)
    incoming: st !== undefined && paused === null ? driftItems(st, "incoming") : [],
    outgoing: st !== undefined && paused === null ? driftItems(st, "outgoing") : [],
    conflicts:
      paused === "merging" && st?.merging != null
        ? st.merging.conflicts.map((c) => ({ name: c.path.split("/").pop() ?? c.path, relPath: c.path }))
        : [],
    error: input.statusError,
  }
}
