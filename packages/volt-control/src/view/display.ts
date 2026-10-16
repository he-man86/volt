/**
 * UI-agnostic **display model** — bridge health as user-facing text, and the cross-workspace sync state. Node-free by
 * contract (`HealthState`/`StatusJson` are `import type`, erased at runtime) so it stays renderer-safe. The
 * per-workspace drift projection lives beside this in `./workspace.js`.
 */
import type { HealthState } from "../bridge/health.js"
import type { StatusJson } from "./types.js"

// ── per-workspace health → dot/label ─────────────────────────────────────────
export interface HealthDisplay {
  online: boolean
  label: string
  tone: "ok" | "warn" | "error"
}

/** One-line health string (moved here from health.ts so it's importable Node-free). */
export function healthLabel(state: HealthState): string {
  switch (state.kind) {
    case "unknown":
      return "Probing IDE..."
    case "connected":
      // Vendor-blind: name the PROJECT, not the IDE/vendor (a project is identified by its name everywhere in the UI).
      return state.health.projectName ?? "(no project)"
    case "degraded":
      // The bridge carries no per-degrade reason on the wire, so this is a static description.
      return "Degraded: the IDE channel had recent errors"
    case "disconnected":
      return "No project loaded"
    case "unreachable":
      return `Bridge unreachable: ${state.reason.slice(0, 80)}`
  }
}

export function healthDisplay(state: HealthState): HealthDisplay {
  switch (state.kind) {
    case "connected":
      return { online: true, label: healthLabel(state), tone: "ok" }
    case "degraded":
      return { online: true, label: healthLabel(state), tone: "warn" }
    case "unreachable":
      return { online: false, label: healthLabel(state), tone: "error" }
    case "disconnected":
    case "unknown":
      return { online: false, label: healthLabel(state), tone: "warn" }
  }
}

// ── sync state across all bound workspaces (worst-state-wins) ─────────────────
/** What the bound workspaces allow, reduced worst-state-wins (merging > offline > online) to the outcomes a shell
 *  gates on:
 *  - `none`    — nothing is bound.
 *  - `merging` — a merge is in progress somewhere: neither sync nor Connect; the merge's own affordances apply.
 *  - `offline` — some workspace has no serving bridge (unreachable, still probing, or no project loaded): Connect.
 *  - `online`  — every bridge answered: pull/push/build are allowed. A PARTIAL view (an unreadable item, a folder
 *                the bridge could not enumerate), drift and a degraded channel are all online — reasons to warn,
 *                never reasons to take the sync affordances away. */
export type SyncState = "none" | "merging" | "offline" | "online"

export interface WorkspaceSync {
  status?: StatusJson
  health: HealthState
}

export function syncState(workspaces: readonly WorkspaceSync[]): SyncState {
  if (workspaces.length === 0) return "none"
  if (workspaces.some((w) => w.status !== undefined && w.status.merging !== null)) return "merging"
  // `unknown` is pre-probe: a connection NOT yet confirmed must never read as online.
  const down = (h: HealthState): boolean => h.kind === "unreachable" || h.kind === "unknown" || h.kind === "disconnected"
  return workspaces.some((w) => down(w.health)) ? "offline" : "online"
}
