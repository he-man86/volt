/**
 * Per-workspace drift view-model — one projection of a bound workspace's IDE-sync state, so neither shell
 * re-derives A/M/D tags, the paused reason, or the `src/`-strip. Node-free: the caller (VS Code extension
 * host / desktop main — both Node) supplies `port` (read via readBridgePort in their context); this stays
 * pure so it's unit-testable without a filesystem and both frontends render the same model.
 */
import { vendorForPort, type HealthState, type Vendor } from "../bridge/health.js"
import type { StatusJson } from "./types.js"
import { healthDisplay, type HealthDisplay } from "./display.js"

/** One drifted item, direction implied by which array it's in. `relPath` is tree-relative (`src/` stripped);
 *  a shell builds its own affordance from it (VS Code its `vscode.diff` command, desktop a row). */
export interface DriftItem {
  name: string
  sub: "A" | "M" | "D"
  relPath: string
}

export interface WorkspaceInput {
  workspaceRoot: string
  status?: StatusJson
  health: HealthState
  statusError?: string
  /** From readBridgePort in the caller's Node context; defined ⇒ this folder is an initialized Volt workspace. */
  port?: number
}

export interface WorkspaceView {
  initialized: boolean
  workspaceRoot: string
  port?: number
  /** The bound vendor (derived from `port`) — what the UI shows; the port is an internal pipe selector. */
  vendor?: Vendor
  health: HealthDisplay
  /** Why the IDE axis is paused (distinct reasons drive distinct affordances), or null when live. */
  paused: "mismatch" | "merging" | null
  incoming: DriftItem[]
  outgoing: DriftItem[]
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
  return {
    initialized: input.port !== undefined,
    workspaceRoot: input.workspaceRoot,
    port: input.port,
    vendor: input.port !== undefined ? vendorForPort(input.port) : undefined,
    health: healthDisplay(input.health),
    paused,
    incoming: st !== undefined && paused === null ? driftItems(st, "incoming") : [],
    outgoing: st !== undefined && paused === null ? driftItems(st, "outgoing") : [],
    error: input.statusError,
  }
}
