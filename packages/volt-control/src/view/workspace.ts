/**
 * Per-workspace drift view-model — one projection of a bound workspace's IDE-sync state, so neither shell
 * re-derives A/M/D tags, the paused reason, or the `src/`-strip. Node-free: the caller (VS Code extension
 * host / desktop main — both Node) supplies `vendor` (read via readBridgeVendor in their context); this stays
 * pure so it's unit-testable without a filesystem and both frontends render the same model.
 */
import type { HealthState, Vendor } from "../bridge/health.js"
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
}

/** The one state machine both frontends switch on to decide what the IDE-Sync surface shows. Derived once here
 *  so the extension and the desktop never re-derive (and drift). `uninitialized` is the onboarding state — see
 *  {@link onboardingMode}, which splits it. */
export type SyncMode = "uninitialized" | "merging" | "mismatch" | "offline" | "ready"

/** Precedence: a local merge/mismatch must be resolvable even when the bridge is down, so they outrank `offline`;
 *  `ready` (the action row + drift) only when initialized, online, and not paused. */
export function syncMode(initialized: boolean, paused: WorkspaceView["paused"], online: boolean): SyncMode {
  if (!initialized) return "uninitialized"
  if (paused === "merging") return "merging"
  if (paused === "mismatch") return "mismatch"
  if (!online) return "offline"
  return "ready"
}

/** The ONE bound-connection action a shell offers — never two, never none. Accept-rename OUTRANKS connect/disconnect:
 *  a mismatch PAUSES sync, so offering connect/disconnect there answers a question the user didn't ask (the desktop
 *  learned this; the VS Code view used to stack them). */
export type ConnectionAction = "connect" | "disconnect" | "accept-rename"

/** The bound-connection affordance, decided ONCE here so both shells render an identical decision (they diverged
 *  before — one stacked accept-rename on connect/disconnect, the other made it outrank). Each shell maps the enum
 *  to its own widget (VS Code TreeNode / desktop DOM); only the DECISION lives here. */
export interface ConnectionAffordance {
  /** Row-1 status word — whether THIS workspace's bridge is serving it. */
  caption: "connected" | "not connected"
  /** The one primary action to offer. */
  action: ConnectionAction
  /** Show the bound-platform ("· CODESYS") row — only alongside `connect` (offline), where the health label is an
   *  error string that can't name the IDE. Connected, the label already reads "&lt;IDE&gt; — &lt;project&gt;". */
  showVendorRow: boolean
}

export function connectionAffordance(view: Pick<WorkspaceView, "health" | "paused" | "vendor">): ConnectionAffordance {
  const caption = view.health.online ? "connected" : "not connected"
  if (view.paused === "mismatch") return { caption, action: "accept-rename", showVendorRow: false }
  if (!view.health.online) return { caption, action: "connect", showVendorRow: view.vendor !== undefined }
  return { caption, action: "disconnect", showVendorRow: false }
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
  health: HealthDisplay
  /** Why the IDE axis is paused (distinct reasons drive distinct affordances), or null when live. */
  paused: "mismatch" | "merging" | null
  /** The single state both shells render from — gates the action row, the Connect affordance, and the drift list. */
  mode: SyncMode
  /** The bound-connection affordance (caption + the ONE action + whether to show the vendor row) — carried on the
   *  view so neither shell re-derives it (see {@link connectionAffordance}). */
  affordance: ConnectionAffordance
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
  // merging wins over mismatch (worst-state-first, matching aggregate); items hide while paused.
  const paused: WorkspaceView["paused"] = st?.merging != null ? "merging" : st?.projectMismatch != null ? "mismatch" : null
  const initialized = input.vendor !== undefined
  const health = healthDisplay(input.health)
  return {
    initialized,
    workspaceRoot: input.workspaceRoot,
    vendor: input.vendor,
    health,
    paused,
    mode: syncMode(initialized, paused, health.online),
    affordance: connectionAffordance({ health, paused, vendor: input.vendor }),
    incoming: st !== undefined && paused === null ? driftItems(st, "incoming") : [],
    outgoing: st !== undefined && paused === null ? driftItems(st, "outgoing") : [],
    conflicts:
      paused === "merging" && st?.merging != null
        ? st.merging.conflicts.map((c) => ({ name: c.path.split("/").pop() ?? c.path, relPath: c.path }))
        : [],
    error: input.statusError,
  }
}
