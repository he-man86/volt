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

/** The fixed per-vendor selector the workspace binding still persists as a "port" (CODESYS 8556, TwinCAT/Beckhoff
 *  8555). The wire is now a named pipe, not HTTP — this number only picks the vendor (→ `pipeForPort`). One
 *  source, no per-user override — both shells and onboarding read these instead of duplicating the literals. */
export const BRIDGE_PORT: Record<Vendor, number> = { codesys: 8556, twincat: 8555 }

/** The per-vendor named pipe the bridge serves (mirrors C#'s PipeNames.ForPort): 8555 → TwinCAT, else CODESYS. */
function pipeForPort(port: number): string {
  return port === BRIDGE_PORT.twincat ? "volt.bridge.beckhoff" : "volt.bridge.codesys"
}

export function vendorPort(vendor: Vendor): number {
  return BRIDGE_PORT[vendor]
}

/** Inverse: which vendor a bound workspace's port belongs to (the TwinCAT bridge is 8555, else CODESYS).
 *  Takes a definite port — call it only for a bound workspace (readBridgePort !== undefined); an undefined
 *  port means the caller ran on an unbound workspace, which is the bug to fix, not to default away. */
export function vendorForPort(port: number): Vendor {
  return port === BRIDGE_PORT.twincat ? "twincat" : "codesys"
}

export function readBridgePort(workspaceRoot: string): number | undefined {
  try {
    const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
    const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } }
    const port = parsed.bridge?.port
    if (typeof port === "number" && Number.isFinite(port)) return port
  } catch {}
  return undefined
}

/** Probe the bridge's `health` op over its named pipe (one request per connection, newline-delimited JSON frames —
 *  the same wire the CLI's PipeClient speaks). `port` only selects the vendor pipe. Never throws: every failure
 *  path resolves to `unreachable`. */
export async function probeHealth(port: number, timeoutMs = 2_000): Promise<HealthState> {
  const pipe = pipeForPort(port)
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

export type VendorProbe = { vendor: "twincat" | "codesys"; port: number; state: HealthState }

/** Probe the two configured bridge ports in parallel → which vendor's IDE is live. The one place both
 *  renderers' onboarding shares: gating the init buttons + the "pick a live IDE" flow. */
export async function probeVendors(twincatPort: number, codesysPort: number, timeoutMs = 1500): Promise<VendorProbe[]> {
  const [tc, cs] = await Promise.all([probeHealth(twincatPort, timeoutMs), probeHealth(codesysPort, timeoutMs)])
  return [
    { vendor: "twincat", port: twincatPort, state: tc },
    { vendor: "codesys", port: codesysPort, state: cs },
  ]
}
