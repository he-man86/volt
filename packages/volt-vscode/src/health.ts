import { readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { join } from "node:path"

export interface BridgeHealth {
	status: "healthy" | "degraded" | "unavailable" | string
	connected: boolean
	ideAlive?: boolean
	degraded?: boolean
	degradedReason?: string | null
	ideName?: string | null
	ideVersion?: string | null
	platform?: string
	projectName?: string | null
	plcProjectName?: string | null
	version?: string
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

export function describeOffline(h: HealthState): string {
	if (h.kind === "disconnected") return String(h.health.degradedReason ?? h.health.status ?? "PLC disconnected")
	if (h.kind === "unreachable") return h.reason
	if (h.kind === "unknown") return "probing…"
	return ""
}

export function readBridgePort(workspaceRoot: string): number | undefined {
	try {
		const raw = readFileSync(join(workspaceRoot, ".volt", "config.json"), "utf-8")
		const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } }
		const port = parsed.bridge?.port
		if (typeof port === "number" && Number.isFinite(port)) return port
		return undefined
	} catch {
		return undefined
	}
}

export async function probeHealth(port: number, timeoutMs = 2_000): Promise<HealthState> {
	return new Promise<HealthState>((resolve) => {
		const req = httpRequest(
			{ method: "GET", hostname: "127.0.0.1", port, path: "/health", timeout: timeoutMs, headers: { connection: "close" } },
			(res) => {
				const chunks: Buffer[] = []
				res.on("data", (c: Buffer) => chunks.push(c))
				res.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf-8")
					let parsed: BridgeHealth | undefined
					try { parsed = JSON.parse(raw) as BridgeHealth } catch {
						resolve({ kind: "unreachable", reason: `invalid JSON (HTTP ${res.statusCode ?? "?"})` }); return
					}
					if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300 && parsed.status !== undefined) {
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
		req.on("timeout", () => { req.destroy(); resolve({ kind: "unreachable", reason: `timeout after ${timeoutMs}ms` }) })
		req.end()
	})
}

export function healthLabel(state: HealthState): string {
	switch (state.kind) {
		case "unknown": return "Probing IDE…"
		case "connected": {
			const ide = state.health.ideName ?? "IDE"
			const project = state.health.plcProjectName ?? state.health.projectName ?? "(no project)"
			return `${ide} — ${project}`
		}
		case "degraded": return `Degraded: ${state.health.degradedReason ?? "previous call failed"}`
		case "disconnected": return "No project loaded"
		case "unreachable": return `Bridge unreachable: ${friendlyReason(state.reason)}`
	}
}

function friendlyReason(raw: string): string {
	const lower = raw.toLowerCase()
	if (lower.includes("econnrefused")) return "bridge not running"
	if (lower.includes("timeout") || lower.includes("etimedout")) return "bridge not responding"
	if (lower.includes("enetunreach") || lower.includes("enotfound")) return "network unreachable"
	if (lower.includes("ehostunreach")) return "host unreachable"
	if (lower.includes("config.json")) return "no Volt config"
	if (lower.includes("non-json")) return "invalid response"
	if (lower.startsWith("http ")) return raw
	return raw.replace(/^connect\s+/i, "").slice(0, 80)
}
