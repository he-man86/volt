import { readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { join } from "node:path"

export interface BridgeHealth {
	status: "healthy" | "degraded" | "unavailable" | string
	connected: boolean
	degraded?: boolean
	degradedReason?: string | null
	ideName?: string | null
	ideVersion?: string | null
	projectName?: string | null
	plcProjectName?: string | null
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

export function readBridgePort(workspaceRoot: string): number | undefined {
	try {
		const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
		const parsed = JSON.parse(raw) as { bridge?: { port?: unknown } }
		const port = parsed.bridge?.port
		if (typeof port === "number" && Number.isFinite(port)) return port
	} catch {}
	return undefined
}

/** Per-extension access from .git/volt/config.json: ".st" → "rw", ".fbd" → "r", etc.
 *  Drives the read-only badge — graphical/config files the AI reads but can't push. */
export function readExtensionAccess(workspaceRoot: string): Record<string, "r" | "rw"> {
	try {
		const raw = readFileSync(join(workspaceRoot, ".git", "volt", "config.json"), "utf-8")
		const parsed = JSON.parse(raw) as { extensionAccess?: Record<string, "r" | "rw"> }
		return parsed.extensionAccess ?? {}
	} catch {
		return {}
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
		req.on("timeout", () => { req.destroy(); resolve({ kind: "unreachable", reason: `timeout after ${timeoutMs}ms` }) })
		req.end()
	})
}

export function healthLabel(state: HealthState): string {
	switch (state.kind) {
		case "unknown": return "Probing IDE..."
		case "connected": return `${state.health.ideName ?? "IDE"} \u2014 ${state.health.plcProjectName ?? state.health.projectName ?? "(no project)"}`
		case "degraded": return `Degraded: ${state.health.degradedReason ?? "previous call failed"}`
		case "disconnected": return "No project loaded"
		case "unreachable": return `Bridge unreachable: ${state.reason.slice(0, 80)}`
	}
}

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
