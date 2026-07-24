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

export type Vendor = "codesys" | "twincat"

/** The two vendors, for iterating. */
export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]

/** The user-facing IDE name for a bound vendor — what the UI shows instead of the internal pipe/port selector.
 *  Lives here beside the Vendor type so the type, its values, and its label are one module. */
export function vendorLabel(vendor: Vendor): string {
  return vendor === "twincat" ? "TwinCAT" : "CODESYS"
}

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
