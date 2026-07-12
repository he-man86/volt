/**
 * VoltStatus — the reactive IDE-changes state for ONE workspace: bridge health + `volt status --json` drift,
 * refreshed on bridge `change` events, a heartbeat, and state-file mtime. Pure over volt-control (no `vscode`),
 * so the VS Code extension and the desktop shell share ONE tracker and each renders `onDidChange` in its own UI.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fetchStatus } from "./actions.js";
import { Emitter } from "./emitter.js";
import { subscribeChanges } from "./events.js";
import { isMutationInFlight } from "./gate.js";
import { probeHealth, readBridgePort, type HealthState } from "./health.js";
import type { StatusJson } from "./types.js";
import { isPouFile, readStateMtime } from "./workspace.js";

const HEALTH_MS = 30_000;
const MTIME_MS = 3_000;

export class VoltStatus {
	readonly workspaceRoot: string;
	cached: StatusJson | undefined;
	health: HealthState = { kind: "unknown" };
	statusError: string | undefined;
	isRefreshing = false;

	/** Fires whenever health / drift / error changes. Shaped like `vscode.EventEmitter` (`.event` / `.fire`). */
	readonly onDidChange = new Emitter<void>();

	private heartbeat: ReturnType<typeof setInterval> | null = null;
	private mtimePoll: ReturnType<typeof setInterval> | null = null;
	private unsubChanges: (() => void) | null = null;
	private lastMtime = 0;
	private lastRefreshMs = 0;
	private bridgePort: number | undefined;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async start(): Promise<void> {
		this.bridgePort = readBridgePort(this.workspaceRoot);
		this.heartbeat = setInterval(() => this.probeHealth(), HEALTH_MS);
		this.mtimePoll = setInterval(() => this.pollMtime(), MTIME_MS);
		// Reactive IDE-change detection: the bridge signals a `change` when the engineer edits, so the drift view
		// refreshes on its own — no manual "refresh" for IDE-side edits, and no bridge polling.
		if (this.bridgePort !== undefined) this.unsubChanges = subscribeChanges(this.bridgePort, () => void this.refresh());
		this.probeHealth();
		await this.refresh();
	}

	dispose(): void {
		if (this.heartbeat !== null) clearInterval(this.heartbeat);
		if (this.mtimePoll !== null) clearInterval(this.mtimePoll);
		this.unsubChanges?.();
		this.onDidChange.dispose();
	}

	async refresh(force = false): Promise<void> {
		if (this.isRefreshing) return;
		if (!force && Date.now() - this.lastRefreshMs < 1_000) return;
		this.lastRefreshMs = Date.now();
		this.isRefreshing = true;

		try {
			const configPath = join(this.workspaceRoot, ".git", "volt", "config.json");
			if (!existsSync(configPath)) {
				this.cached = undefined;
				this.statusError = undefined;
				return;
			}

			// UI-agnostic probe + `volt status --json` live in volt-control. On any error keep the last good
			// `cached` (just surface the error); only a successful fetch replaces it.
			const res = await fetchStatus(this.workspaceRoot, this.bridgePort);
			this.health = res.health;
			if (res.status !== undefined) {
				this.cached = res.status;
				this.statusError = undefined;
			} else {
				this.statusError = res.error;
			}
		} catch (err) {
			this.statusError = err instanceof Error ? err.message : String(err);
		} finally {
			this.isRefreshing = false;
			this.onDidChange.fire();
		}
	}

	private async probeHealth(): Promise<void> {
		if (isMutationInFlight(this.workspaceRoot)) return;
		const port = this.bridgePort;
		if (port === undefined) return;
		this.health = await probeHealth(port, 2000);
		this.onDidChange.fire();
	}

	private pollMtime(): void {
		const mtime = readStateMtime(this.workspaceRoot);
		if (mtime > this.lastMtime && this.lastMtime > 0) {
			this.lastMtime = mtime;
			this.refresh();
			return;
		}
		this.lastMtime = mtime;
	}

	/** True when a save on this file should trigger a refresh. */
	isTrackedFile(path: string): boolean {
		return isPouFile(path);
	}
}
