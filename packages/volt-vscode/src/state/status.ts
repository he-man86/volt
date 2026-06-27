import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { StatusJson } from "@opencode-ai/volt-control"
import { readBridgePort, probeHealth, type HealthState } from "@opencode-ai/volt-control"
import { fetchStatus } from "@opencode-ai/volt-control"
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
			const configPath = join(this.workspaceRoot, ".git", "volt", "config.json")
			if (!existsSync(configPath)) {
				this.cached = undefined
				this.statusError = undefined
				return
			}

			// UI-agnostic probe + `volt status --json` lives in volt-control. On any
			// error keep the last good `cached` (just surface the error), matching the
			// previous behaviour; only a successful fetch replaces it.
			const res = await fetchStatus(this.workspaceRoot, this.bridgePort)
			this.health = res.health
			if (res.status !== undefined) {
				this.cached = res.status
				this.statusError = undefined
			} else {
				this.statusError = res.error
			}
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
	return existsSync(join(folder.uri.fsPath, ".git", "volt", "config.json"))
}
