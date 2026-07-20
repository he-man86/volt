import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The bridge-health TYPES + the bound-vendor read. Live connection status now comes from the connector
 * (`bridge/connector.ts` → `:8550`), the one aggregator — the UI no longer probes the bridge pipes itself, so
 * the old `probeHealth`/`probeVendors` pipe probes are gone. These types are still the shape callers render;
 * `connector.ts` produces a `HealthState` from the connector's per-vendor view.
 */
export interface BridgeHealth {
  status: "healthy" | "degraded" | "unavailable"
  connected: boolean
  degraded?: boolean
  degradedReason?: string | null
  ideName?: string | null
  ideVersion?: string | null
  projectName?: string | null
  projectDirty?: boolean
  activeOp?: string | null
}

export type HealthState =
  | { kind: "unknown" }
  | { kind: "connected"; health: BridgeHealth }
  | { kind: "degraded"; health: BridgeHealth }
  | { kind: "disconnected"; health: BridgeHealth }
  | { kind: "unreachable"; reason: string }

export function isBridgeOnline(h: HealthState): boolean {
  return h.kind === "connected" || h.kind === "degraded"
}

/** The bridge's health payload, or undefined when the state carries none (unknown / unreachable). The one place
 *  that unwraps the HealthState union, so callers read fields without repeating the kind check. */
export function healthOf(h: HealthState): BridgeHealth | undefined {
  return h.kind === "connected" || h.kind === "degraded" || h.kind === "disconnected" ? h.health : undefined
}

/** The mutating op the shared bridge is currently running (init/fetch/push/build), or undefined when idle.
 *  While set, trackers must NOT issue `/refs` — the project is being churned and the single-threaded bridge is
 *  busy, so a status poll would both misread the op's churn as an edit and contend with the running mutation.
 *  This is the ONE signal every frontend shares (the bridge), so it coordinates across separate processes and a
 *  terminal `volt init` where the in-process mutation gate cannot. */
export function bridgeActiveOp(h: HealthState): string | undefined {
  return healthOf(h)?.activeOp ?? undefined
}

export type Vendor = "codesys" | "twincat"

/** The two vendors, for iterating. */
export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]

/** The vendor a workspace is bound to, from `.git/volt/config.json` (`bridge.vendor`); undefined ⇒ unbound (not an
 *  initialized Volt workspace). */
export function readBridgeVendor(workspaceRoot: string): Vendor | undefined {
  try {
    const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
    const vendor = (JSON.parse(raw) as { bridge?: { vendor?: unknown } }).bridge?.vendor
    if (vendor === "codesys" || vendor === "twincat") return vendor
  } catch {}
  return undefined
}

/** The project a workspace is bound to (`.git/volt/config.json`: vendor + projectName), for re-pointing the
 *  bridge at it. undefined ⇒ unbound / malformed. */
export function readBoundProject(workspaceRoot: string): { vendor: Vendor; projectName: string } | undefined {
  const vendor = readBridgeVendor(workspaceRoot)
  if (vendor === undefined) return undefined
  try {
    const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
    const projectName = (JSON.parse(raw) as { project?: { projectName?: unknown } }).project?.projectName
    if (typeof projectName === "string" && projectName.length > 0) return { vendor, projectName }
  } catch {}
  return undefined
}
