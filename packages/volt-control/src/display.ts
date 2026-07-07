/**
 * UI-agnostic **display model** — the one place health/aggregate/drift becomes user-facing text.
 *
 * Node-free by contract (no `node:*` value imports; `HealthState`/`StatusJson` are `import type`,
 * erased at runtime) so the **sandboxed** Solid renderer can import it via the
 * `@opencode-ai/volt-control/display` subpath — the same trick as `/channels`. Before this module,
 * the health→string mapping was derived three times (volt-control `healthLabel`, volt-vscode
 * `updateGlobalUi`, volt-app `HealthDot`) and drifted; every surface now renders these functions.
 */
import type { HealthState } from "./health.js"
import type { StatusJson } from "./types.js"
import { changeCount } from "./types.js"

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
      return `${state.health.ideName ?? "IDE"} — ${state.health.plcProjectName ?? state.health.projectName ?? "(no project)"}`
    case "degraded":
      return `Degraded: ${state.health.degradedReason ?? "previous call failed"}`
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

// ── aggregate across all bound workspaces (worst-state-wins) ──────────────────
export type VoltSeverity =
  | "uninitialized"
  | "merging"
  | "mismatch"
  | "offline"
  | "noproject"
  | "degraded"
  | "drift"
  | "insync"

export interface WorkspaceState {
  status?: StatusJson
  health: HealthState
}

export interface VoltDisplay {
  severity: VoltSeverity
  label: string
  tooltip: string
  /** Where the surface's status affordance should point when clicked. */
  action?: "status" | "startBridge" | "acceptRename"
  incoming: number
  outgoing: number
}

/**
 * Reduce every bound workspace to one display model, worst-state-wins:
 * merge > mismatch > offline > no-project > degraded > drift > in-sync.
 * (`uninitialized` when nothing is bound — the surface hides its indicator.)
 */
export function aggregate(workspaces: readonly WorkspaceState[]): VoltDisplay {
  if (workspaces.length === 0) {
    return { severity: "uninitialized", label: "Volt", tooltip: "No Volt workspace bound", incoming: 0, outgoing: 0 }
  }

  let merging = false
  let mismatch = false
  let incoming = 0
  let outgoing = 0
  let conn: "ok" | "offline" | "noproject" | "degraded" = "ok"

  for (const w of workspaces) {
    const c = w.status
    if (c !== undefined) {
      if (c.merging !== null) merging = true
      if (c.projectMismatch !== null) mismatch = true
      incoming += changeCount(c.incoming)
      outgoing += changeCount(c.outgoing)
    }
    switch (w.health.kind) {
      case "unreachable":
        conn = "offline"
        break
      case "disconnected":
        if (conn === "ok") conn = "noproject"
        break
      case "degraded":
        if (conn === "ok") conn = "degraded"
        break
    }
  }

  if (merging)
    return {
      severity: "merging",
      label: "Volt: merge",
      tooltip: "Merge in progress — resolve conflicts with your editor's Git tools, then Pull again",
      action: "status",
      incoming,
      outgoing,
    }
  if (mismatch)
    return {
      severity: "mismatch",
      label: "Volt: project mismatch",
      tooltip: "The IDE's project differs from the binding (likely a rename) — accept it and re-bind",
      action: "acceptRename",
      incoming,
      outgoing,
    }
  if (conn === "offline")
    return {
      severity: "offline",
      label: "Volt: bridge offline",
      tooltip: "No bridge on the configured port — start it via the connector",
      action: "startBridge",
      incoming,
      outgoing,
    }
  if (conn === "noproject")
    return {
      severity: "noproject",
      label: "Volt: no project",
      tooltip: "The IDE is running but no project is loaded",
      action: "status",
      incoming,
      outgoing,
    }
  if (conn === "degraded")
    return {
      severity: "degraded",
      label: "Volt: degraded",
      tooltip: "The IDE channel had recent errors — read-only-safe; heavy writes may retry",
      action: "status",
      incoming,
      outgoing,
    }
  if (incoming > 0 || outgoing > 0)
    return {
      severity: "drift",
      label: `Volt ${outgoing}↑ ${incoming}↓`,
      tooltip: `${outgoing} outgoing, ${incoming} incoming — open the Volt view`,
      action: "status",
      incoming,
      outgoing,
    }
  return {
    severity: "insync",
    label: "Volt",
    tooltip: "Connected and in sync with the IDE",
    action: "status",
    incoming,
    outgoing,
  }
}
