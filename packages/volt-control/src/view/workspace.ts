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
    incoming: st !== undefined && paused === null ? driftItems(st, "incoming") : [],
    outgoing: st !== undefined && paused === null ? driftItems(st, "outgoing") : [],
    conflicts:
      paused === "merging" && st?.merging != null
        ? st.merging.conflicts.map((c) => ({ name: c.path.split("/").pop() ?? c.path, relPath: c.path }))
        : [],
    error: input.statusError,
  }
}
