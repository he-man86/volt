import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The bridge-health TYPES + the bound-vendor read. Live connection status now comes from the connector
 * (`bridge/connector.ts` → `:8550`), the one aggregator — the UI no longer probes the bridge pipes itself, so
 * the old `probeHealth`/`probeVendors` pipe probes are gone. These types are still the shape callers render;
 * `connector.ts` produces a `HealthState` from the connector's per-vendor view.
 */
// The UI-facing health fields, DERIVED from a `/status` row by `connector.ts:healthStateOf`. Deliberately only the
// fields a renderer reads: the connected/degraded/unavailable distinction is the `HealthState.kind` tag (below), so
// it is NOT re-encoded here. (The old `status`/`degraded`/`degradedReason`/`ideVersion` fields were removed with the
// C# `degradedReason` wire field — they were unset or unread; the live IDE version is `DetectedProject.ideVersion`.)
export interface BridgeHealth {
  connected: boolean
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

// No vendor→label helper here on purpose: the UI is vendor-blind — a project is identified by its NAME, never its
// vendor. `vendor` survives only as routing/identity below the wire (which pipe `volt.bridge.<vendor>`, which LSP
// `--codesys/--twincat`, which detected project matches a saved binding), never as anything a renderer shows.

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

/** The identity a workspace is bound to — vendor + the name the binding matches the IDE's project on. */
export interface BoundProject {
  vendor: Vendor
  projectName: string
}

/** The project a workspace is bound to (`.git/volt/config.json`: vendor + projectName), for re-pointing the
 *  bridge at it. undefined ⇒ unbound / malformed. */
export function readBoundProject(workspaceRoot: string): BoundProject | undefined {
  const vendor = readBridgeVendor(workspaceRoot)
  if (vendor === undefined) return undefined
  try {
    const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
    const projectName = (JSON.parse(raw) as { project?: { projectName?: unknown } }).project?.projectName
    if (typeof projectName === "string" && projectName.length > 0) return { vendor, projectName }
  } catch {}
  return undefined
}
