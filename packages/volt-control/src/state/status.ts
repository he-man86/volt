/**
 * VoltStatus — the reactive IDE-changes state for ONE workspace: bridge health + `volt status --json` drift,
 * refreshed by a single cheap `/health` poll (drives the health indicator AND detects IDE-side edits) plus a
 * state-file mtime poll. Pure over volt-control (no `vscode`), so the VS Code extension and the desktop shell
 * share ONE tracker and each renders `onDidChange` in its own UI.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fetchStatus } from "../bridge/actions.js";
import { Emitter } from "./emitter.js";
import { isMutationInFlight } from "../bridge/gate.js";
import { probeHealth, readBridgePort, type HealthState } from "../bridge/health.js";
import type { PullOutcome, PushOutcome } from "../bridge/actions.js";
import type { StatusJson } from "../view/types.js";
import { isPouFile, readStateMtime } from "./files.js";

// One cheap /health poll cadence for BOTH the health indicator and IDE-change detection. ~4s keeps
// edit-detection latency close to the old /refs poll without a full-project scan (which is what /refs was).
const HEALTH_MS = 4_000;
const MTIME_MS = 3_000;

/** After a pull/push: adopt the resulting status the action already returned (ONE bridge call, no follow-up
 *  `volt status`). Adopt on ANY outcome that carried a status (ok, and a pull conflict — which already fetched
 *  everything needed to build the merging status); only re-fetch when no status came back (state uncertain,
 *  e.g. a push rejected before the receipt, or an error). The ONE settle rule — both shells call it, so they
 *  can't diverge. */
export async function settleOutcome(st: VoltStatus, out: PullOutcome | PushOutcome): Promise<void> {
	const status = "status" in out ? out.status : undefined;
	if (status) st.adopt(status);
	else if (out.kind !== "ok") await st.refresh(true);
}

/** An IDE-edit edge from two consecutive health reads: a projectDirty false→true transition, or a project
 *  switch. `seen` gates the very first read (start()'s explicit refresh covers the initial state). Pure so
 *  the branching is unit-tested without a live bridge. */
export function isIdeChangeEdge(
	prev: { seen: boolean; dirty: boolean; name: string | undefined },
	next: { dirty: boolean; name: string | undefined },
): boolean {
	return prev.seen && ((next.dirty && !prev.dirty) || next.name !== prev.name);
}

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
	private lastMtime = 0;
	private lastRefreshMs = 0;
	private bridgePort: number | undefined;
	// Change-detection baselines: the health poll fires a refresh on a projectDirty false→true edge or a
	// projectName change. `seenHealth` gates the first probe (start()'s explicit refresh covers the initial state).
	private lastDirty = false;
	private lastProjectName: string | undefined;
	private seenHealth = false;
	private pendingForce = false; // a forced refresh requested while one was in flight — run it after, don't drop it

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async start(): Promise<void> {
		this.bridgePort = readBridgePort(this.workspaceRoot);
		// One /health poll drives health AND IDE-change detection (no separate /refs poll, no slow heartbeat).
		this.heartbeat = setInterval(() => this.probeHealth(), HEALTH_MS);
		this.mtimePoll = setInterval(() => this.pollMtime(), MTIME_MS);
		this.probeHealth();
		await this.refresh();
	}

	dispose(): void {
		if (this.heartbeat !== null) clearInterval(this.heartbeat);
		if (this.mtimePoll !== null) clearInterval(this.mtimePoll);
		this.onDidChange.dispose();
	}

	/** Adopt the status a pull/push already returned — no bridge round-trip. The action's own response carries
	 *  the resulting state, so a UI action stays ONE bridge call (the action). Absorbs the state-file mtime the
	 *  mutation just wrote so the mtime poll doesn't re-refresh on our own write. */
	adopt(status: StatusJson): void {
		this.cached = status;
		this.statusError = undefined;
		this.lastMtime = readStateMtime(this.workspaceRoot);
		this.onDidChange.fire();
	}

	async refresh(force = false): Promise<void> {
		if (this.isRefreshing) {
			// Don't drop a forced refresh (a user click, or an IDE-change edge) — coalesce it to run once the
			// in-flight one settles, so the view reflects the latest state instead of waiting for the next poll.
			if (force) this.pendingForce = true;
			return;
		}
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
			if (this.pendingForce) {
				this.pendingForce = false;
				void this.refresh(true);
			}
		}
	}

	private async probeHealth(): Promise<void> {
		// Skip while a mutation holds the gate: a push/pull dirties the project itself, and we must not read
		// that as an engineer edit (nor contend with the op). Reset the edge baseline so the FIRST post-mutation
		// poll re-baselines to the new dirty state WITHOUT firing a spurious refresh (our own push isn't an edit).
		if (isMutationInFlight(this.workspaceRoot)) {
			this.seenHealth = false;
			return;
		}
		const port = this.bridgePort;
		if (port === undefined) return;
		this.health = await probeHealth(port, 2000);

		// Detect an IDE-side edit from the cheap health payload: a projectDirty false→true edge, or a project
		// switch. Either fires exactly one refresh (its own debounce collapses bursts). No /refs scan.
		const h =
			this.health.kind === "connected" || this.health.kind === "degraded" || this.health.kind === "disconnected"
				? this.health.health
				: undefined;
		const dirty = h?.projectDirty ?? false;
		const name = h?.projectName ?? undefined;
		const edge = isIdeChangeEdge({ seen: this.seenHealth, dirty: this.lastDirty, name: this.lastProjectName }, { dirty, name });
		this.lastDirty = dirty;
		this.lastProjectName = name;
		this.seenHealth = true;

		this.onDidChange.fire();
		if (edge) void this.refresh();
	}

	private pollMtime(): void {
		// Absorb the state-file write our OWN mutation makes (saveIdeRefs) — the UI already adopts the action's
		// returned status, so this write must not trigger a redundant refresh. Out-of-band changes (a terminal
		// `volt pull`) don't hold the gate, so they still refresh.
		if (isMutationInFlight(this.workspaceRoot)) {
			this.lastMtime = readStateMtime(this.workspaceRoot);
			return;
		}
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
