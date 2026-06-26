import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { StatusJson } from "@opencode-ai/volt-control"
import { readBridgePort, probeHealth, isBridgeOnline, type HealthState } from "@opencode-ai/volt-control"
import { spawnVolt } from "@opencode-ai/volt-control"
import { isMutationInFlight } from "@opencode-ai/volt-control"
import { isPouFile, readStateMtime } from "@opencode-ai/volt-control"

const HEALTH_MS = 30_000
const MTIME_MS = 3_000

export class VoltStatus {
	readonly workspaceRoot: string
	cached: StatusJson | undefined
	health: HealthState = { kind: "unknown" }
	statusError: string | undefined
	isRefreshing = false

	readonly onDidChange = new vscode.EventEmitter<void>()

	private heartbeat: ReturnType<typeof setInterval> | null = null
	private mtimePoll: ReturnType<typeof setInterval> | null = null
	private lastMtime = 0
	private lastRefreshMs = 0
	private bridgePort: number | undefined

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	async start(): Promise<void> {
		this.bridgePort = readBridgePort(this.workspaceRoot)
		this.heartbeat = setInterval(() => this.probeHealth(), HEALTH_MS)
		this.mtimePoll = setInterval(() => this.pollMtime(), MTIME_MS)
		this.probeHealth()
		await this.refresh()
	}

	dispose(): void {
		if (this.heartbeat !== null) clearInterval(this.heartbeat)
		if (this.mtimePoll !== null) clearInterval(this.mtimePoll)
		this.onDidChange.dispose()
	}

	async refresh(force = false): Promise<void> {
		if (this.isRefreshing) return
		if (!force && Date.now() - this.lastRefreshMs < 1_000) return
		this.lastRefreshMs = Date.now()
		this.isRefreshing = true

		try {
			const configPath = join(this.workspaceRoot, ".volt", "config.json")
			if (!existsSync(configPath)) {
				this.cached = undefined
				this.statusError = undefined
				return
			}

			const port = this.bridgePort
			if (port === undefined) { this.statusError = "no bridge port in config"; return }

			const health = await probeHealth(port, 2000)
			this.health = health
			if (!isBridgeOnline(health)) { this.statusError = "bridge offline"; return }

			const r = await spawnVolt(this.workspaceRoot, ["status", "--json", "--port", String(port)])
			if (r.code !== 0) { this.statusError = r.stderr || r.stdout; return }

			const parsed = JSON.parse(r.stdout) as StatusJson
			this.cached = parsed
			this.statusError = undefined
		} catch (err) {
			this.statusError = err instanceof Error ? err.message : String(err)
		} finally {
			this.isRefreshing = false
			this.onDidChange.fire()
		}
	}

	private async probeHealth(): Promise<void> {
		if (isMutationInFlight(this.workspaceRoot)) return
		const port = this.bridgePort
		if (port === undefined) return
		this.health = await probeHealth(port, 2000)
		this.onDidChange.fire()
	}

	private pollMtime(): void {
		const mtime = readStateMtime(this.workspaceRoot)
		if (mtime > this.lastMtime && this.lastMtime > 0) {
			this.lastMtime = mtime
			this.refresh()
			return
		}
		this.lastMtime = mtime
	}

	/** True when a save on this file should trigger a refresh. */
	isTrackedFile(path: string): boolean {
		return isPouFile(path)
	}
}

export function workspaceFolders(): readonly vscode.WorkspaceFolder[] {
	return vscode.workspace.workspaceFolders ?? []
}

export function hasVoltConfig(folder: vscode.WorkspaceFolder): boolean {
	return existsSync(join(folder.uri.fsPath, ".volt", "config.json"))
}
