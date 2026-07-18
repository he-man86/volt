import { readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
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

/** The one fixed bridge port per vendor (CLAUDE.md: CODESYS 8556, TwinCAT/Beckhoff 8555). One source, no
 *  per-user override — both shells and onboarding read these instead of duplicating the literals. */
export const BRIDGE_PORT: Record<Vendor, number> = { codesys: 8556, twincat: 8555 }

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

export async function probeHealth(port: number, timeoutMs = 2_000): Promise<HealthState> {
  return new Promise<HealthState>((resolve) => {
    const req = httpRequest(
      {
        method: "GET",
        hostname: "127.0.0.1",
        port,
        path: "/health",
        timeout: timeoutMs,
        headers: { connection: "close" },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8")
          let parsed: BridgeHealth | undefined
          try {
            parsed = JSON.parse(raw) as BridgeHealth
          } catch {
            resolve({ kind: "unreachable", reason: `invalid health response` })
            return
          }
          if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300 && parsed !== undefined) {
            if (parsed.connected && parsed.status === "healthy") resolve({ kind: "connected", health: parsed })
            else if (parsed.connected && parsed.status === "degraded") resolve({ kind: "degraded", health: parsed })
            else resolve({ kind: "disconnected", health: parsed })
            return
          }
          resolve({ kind: "unreachable", reason: `HTTP ${res.statusCode ?? "?"}` })
        })
        res.on("error", (err) => resolve({ kind: "unreachable", reason: err.message }))
      },
    )
    req.on("error", (err) => resolve({ kind: "unreachable", reason: err.message }))
    req.on("timeout", () => {
      req.destroy()
      resolve({ kind: "unreachable", reason: `timeout after ${timeoutMs}ms` })
    })
    req.end()
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
