import { readFileSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"

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

/** The two vendors, for probing both / iterating. */
export const VENDORS: readonly Vendor[] = ["codesys", "twincat"]

/** The per-vendor named pipe the bridge serves (mirrors C#'s PipeNames.ForVendor). */
function pipeForVendor(vendor: Vendor): string {
  return `volt.bridge.${vendor}`
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

/** Probe the bridge's `health` op over its named pipe (one request per connection, newline-delimited JSON frames —
 *  the same wire the CLI's PipeClient speaks). Never throws: every failure path resolves to `unreachable`. */
export async function probeHealth(vendor: Vendor, timeoutMs = 2_000): Promise<HealthState> {
  const pipe = pipeForVendor(vendor)
  return new Promise<HealthState>((resolve) => {
    const sock = connect(`\\\\.\\pipe\\${pipe}`)
    let buf = ""
    let settled = false
    const done = (s: HealthState) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.destroy()
      resolve(s)
    }
    const timer = setTimeout(() => done({ kind: "unreachable", reason: `timeout after ${timeoutMs}ms` }), timeoutMs)
    sock.on("connect", () => sock.write(JSON.stringify({ op: "health" }) + "\n"))
    sock.on("data", (d: Buffer) => {
      buf += d.toString("utf-8")
      let nl: number
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line) continue
        let frame: { result?: BridgeHealth; error?: { message?: string } }
        try {
          frame = JSON.parse(line)
        } catch {
          continue
        }
        if (frame.result !== undefined) {
          const parsed = frame.result
          if (parsed.connected && parsed.status === "healthy") done({ kind: "connected", health: parsed })
          else if (parsed.connected && parsed.status === "degraded") done({ kind: "degraded", health: parsed })
          else done({ kind: "disconnected", health: parsed })
          return
        }
        if (frame.error !== undefined) {
          done({ kind: "unreachable", reason: frame.error.message ?? "bridge error" })
          return
        }
        // progress frames ignored
      }
    })
    sock.on("error", (err) => done({ kind: "unreachable", reason: err.message }))
    sock.on("end", () => done({ kind: "unreachable", reason: "no health frame" }))
  })
}

// healthLabel now lives in display.ts (Node-free, so the sandboxed renderer can import it too);
// it reaches the package barrel via index.ts's `export * from "./view/display.js"`.

export type VendorProbe = { vendor: Vendor; state: HealthState }

/** Probe both vendors' pipes in parallel → which vendor's IDE is live. The one place both renderers' onboarding
 *  shares: gating the init buttons + the "pick a live IDE" flow. */
export async function probeVendors(timeoutMs = 1500): Promise<VendorProbe[]> {
  const states = await Promise.all(VENDORS.map((vendor) => probeHealth(vendor, timeoutMs)))
  return VENDORS.map((vendor, i) => ({ vendor, state: states[i] }))
}
