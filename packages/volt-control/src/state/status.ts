/**
 * VoltStatus — the reactive IDE-changes state for ONE workspace: bridge health + `volt status --json` drift. Health
 * follows the connector feed (`onConnectorView` — the product's one live-connection clock, so this owns NO timer for
 * it); drift follows a state-file mtime poll, a src/ watcher, and explicit refreshes. Pure over volt-control (no
 * `vscode`), so the VS Code extension and the desktop shell share ONE tracker and each renders `onDidChange` in its
 * own UI.
 *
 * An IDE-side edit (the project going dirty, or a rebind) is detected from the connector feed's view and raises the
 * {@link VoltStatus.ideChanged} HINT — it does NOT auto-run `volt status`/`/refs`, which walks the whole project on
 * the IDE's single thread and freezes it (measured ~9s on a 10 MB CODESYS project). The UI surfaces the hint and the
 * user refreshes when they choose to; a full refresh recomputes incoming and clears the hint.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { fetchStatus, enterWorkspace, leaveWorkspace } from "../bridge/actions.js";
import { describeConnect, describeDisconnect, type OutcomeView } from "../view/outcomes.js";
import { Emitter, type Disposable } from "./emitter.js";
import { onConnectorView } from "../bridge/session.js";
import { isMutationInFlight } from "../bridge/gate.js";
import { readBridgeVendor, healthOf, type HealthState, type Vendor } from "../bridge/health.js";
import { boundStatus } from "../bridge/connector.js";
import type { PullOutcome, PushOutcome, MergeOutcome } from "../bridge/actions.js";
import type { StatusJson } from "../view/types.js";
import { isPouFile, readStateMtime } from "./files.js";

const MTIME_MS = 3_000;
// Coalesce a burst of src writes (e.g. the agent rewriting many files) into one refresh.
const WATCH_DEBOUNCE_MS = 400;

/** After a pull/push: adopt the resulting status the action already returned (ONE bridge call, no follow-up
 *  `volt status`). Adopt on ANY outcome that carried a status (ok, and a pull conflict — which already fetched
 *  everything needed to build the merging status); only re-fetch when no status came back (state uncertain,
 *  e.g. a push rejected before the receipt, or an error). The ONE settle rule — both shells call it, so they
 *  can't diverge. */
export async function settleOutcome(st: VoltStatus, out: PullOutcome | PushOutcome | MergeOutcome): Promise<void> {
	const status = "status" in out ? out.status : undefined;
	if (status) {
		st.adopt(status);
		// …and re-read health, which `adopt` does not carry. A connector view that changed WHILE the mutation held the
		// gate was dropped (the read skips under the gate, and the feed fires once per change — it does not repeat
		// itself), so without this the panel could sit on "connected" against an IDE that closed mid-push. This is the
		// gate's release valve; it is a projection of the feed's view, not a fetch.
		await st.refreshHealth();
	} else if (out.kind !== "ok") await st.refresh(true); // merge outcomes carry no status → always re-fetch
}

/** Connect this workspace (the manual Connect / Reconnect) and settle the UI — the ONE flow both shells run, so
 *  they can't drift; each only decides how to SHOW the returned view.
 *
 *  The settle is health-only on purpose. Both shells used to `await refresh(true)` here, which runs `volt status`
 *  and walks the whole project over the bridge (~9s on a big one) — so the result message, and the buttons, waited
 *  on a walk that has nothing to do with connecting. `refreshHealth()` reads the connector's view (no CLI, no IDE
 *  traffic), which is exactly what changed; the drift re-scan then runs in the BACKGROUND and lands via
 *  `onDidChange` whenever it's ready. */
export async function connectWorkspace(st: VoltStatus): Promise<OutcomeView> {
	const r = await enterWorkspace(st.workspaceRoot);
	await st.refreshHealth();
	if (r.ok) void st.refresh(true); // recompute incoming/outgoing against the now-serving bridge, off the click path
	return describeConnect(r);
}

/** Disconnect this workspace and settle the UI. Health-only, and NO background status: we just asked the connector
 *  to gate this bridge, so a `volt status` would walk an IDE that is no longer serving us — seconds of waiting to
 *  end in an error. Nothing git-side changed anyway; only whether the bridge serves. */
export async function disconnectWorkspace(st: VoltStatus): Promise<OutcomeView> {
	const r = await leaveWorkspace(st.workspaceRoot);
	await st.refreshHealth();
	return describeDisconnect(r);
}

/** An IDE-edit edge from two consecutive health reads: a projectDirty false→true transition, or a switch between
 *  two DIFFERENT live projects. The name check requires BOTH names defined — an `undefined ↔ name` transition is a
 *  disconnect/reconnect (the bridge dropping and coming back), NOT an edit, and flagging it "IDE changed — Refresh"
 *  on every reconnect was a false positive. `seen` gates the very first read (start()'s explicit refresh covers the
 *  initial state). Pure so the branching is unit-tested without a live bridge. */
export function isIdeChangeEdge(
	prev: { seen: boolean; dirty: boolean; name: string | undefined },
	next: { dirty: boolean; name: string | undefined },
): boolean {
	const switched = prev.name !== undefined && next.name !== undefined && next.name !== prev.name;
	return prev.seen && ((next.dirty && !prev.dirty) || switched);
}

export class VoltStatus {
	readonly workspaceRoot: string;
	cached: StatusJson | undefined;
	health: HealthState = { kind: "unknown" };
	statusError: string | undefined;
	isRefreshing = false;
	/** The IDE was edited (project went dirty, or a rebind) since the last full refresh — a HINT for the UI to
	 *  prompt "Refresh to check for incoming". Set from the connector feed; NEVER auto-runs the IDE-freezing
	 *  `/refs` walk. Cleared when a full (non-local) refresh recomputes incoming. */
	ideChanged = false;

	/** Fires whenever health / drift / error changes. Shaped like `vscode.EventEmitter` (`.event` / `.fire`). */
	readonly onDidChange = new Emitter<void>();

	private viewSub: Disposable | null = null;
	private mtimePoll: ReturnType<typeof setInterval> | null = null;
	private srcWatcher: FSWatcher | null = null;
	private watchDebounce: ReturnType<typeof setTimeout> | null = null;
	private lastMtime = 0;
	private lastRefreshMs = 0;
	private bridgeVendor: Vendor | undefined;
	// Change-detection baselines: a health read fires a refresh on a projectDirty false→true edge or a
	// projectName change. `seenHealth` gates the first probe (start()'s explicit refresh covers the initial state).
	private lastDirty = false;
	private lastProjectName: string | undefined;
	private seenHealth = false;
	private pendingForce = false; // a forced refresh requested while one was in flight — run it after, don't drop it

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async start(): Promise<void> {
		this.bridgeVendor = readBridgeVendor(this.workspaceRoot);
		// Health (and the IDE-change edge read off it) follows the connector feed's ONE clock — no timer here. This
		// tracker used to poll every 4s for a value the session client had already fetched on ITS 4s timer, so the
		// two drifted and a connection change could take ~8s to reach the UI. Now it lands as soon as it changes.
		this.viewSub = onConnectorView.event(() => void this.readHealth());
		this.mtimePoll = setInterval(() => this.pollMtime(), MTIME_MS);
		this.watchSrc();
		void this.readHealth();
		await this.refresh();
	}

	/** Watch the workspace `src/` tree so an OUTGOING change is detected however it's made — the agent's tools, a
	 *  terminal, git, an external editor — not just an in-editor save (the extension's onDidSaveTextDocument, absent
	 *  on the desktop). The mtime poll + the connector feed can't see src edits (they watch ide-refs.json + IDE
	 *  health), so this is the only auto-trigger for outgoing. refresh()'s 1s debounce + the mutation gate absorb our own pull/push
	 *  writes. ponytail: fs.watch recursive is Windows/macOS only — Volt is Windows-only, so no extra dep. */
	private watchSrc(): void {
		const srcDir = join(this.workspaceRoot, "src");
		if (!existsSync(srcDir)) return; // uninitialized → nothing to push; init creates src/ before start()
		try {
			this.srcWatcher = watch(srcDir, { recursive: true }, (_event, filename) => {
				// Only tracked source kinds are push candidates; ignore editor temp/other files. A null filename
				// (rare) is treated as "something changed" → refresh.
				if (typeof filename === "string" && !isPouFile(filename)) return;
				if (this.watchDebounce !== null) clearTimeout(this.watchDebounce);
				this.watchDebounce = setTimeout(() => {
					this.watchDebounce = null;
					// LOCAL refresh: a src/ write can only change OUTGOING. A full status issues a /refs, which walks
					// the whole project on the IDE's single thread — seconds of frozen CODESYS, per edit, for an
					// answer the IDE cannot have changed. This is the desktop's ONLY outgoing trigger, so it is also
					// where the freeze hurt most (the agent rewriting many files debounces into one of these).
					void this.refresh(false, true);
				}, WATCH_DEBOUNCE_MS);
			});
		} catch {
			/* watch unsupported / src vanished → fall back to the save-hook + polls */
		}
	}

	dispose(): void {
		this.viewSub?.dispose();
		if (this.mtimePoll !== null) clearInterval(this.mtimePoll);
		if (this.srcWatcher !== null) this.srcWatcher.close();
		if (this.watchDebounce !== null) clearTimeout(this.watchDebounce);
		this.onDidChange.dispose();
	}

	/** Adopt the status a pull/push already returned — no bridge round-trip. The action's own response carries
	 *  the resulting state, so a UI action stays ONE bridge call (the action). Absorbs the state-file mtime the
	 *  mutation just wrote so the mtime poll doesn't re-refresh on our own write. */
	adopt(status: StatusJson): void {
		this.cached = status;
		this.statusError = undefined;
		this.ideChanged = false; // a pull/push settled with fresh incoming/outgoing — the hint is resolved
		this.lastMtime = readStateMtime(this.workspaceRoot);
		this.onDidChange.fire();
	}

	/** @param local Skip the IDE walk — see fetchStatus. Use it for refreshes caused by a LOCAL edit (a save),
	 *  where only `outgoing` can have changed; the IDE cannot have moved because of something we did on disk.
	 *  MEASURED on a real 10 MB CODESYS project: full status 9.16s vs 1.13s local. That 9s ran on EVERY save and
	 *  froze the IDE for its duration, because `/refs` walks the whole project on the IDE's single STA thread. */
	async refresh(force = false, local = false): Promise<void> {
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
			const res = await fetchStatus(this.workspaceRoot, local);
			this.health = res.health;
			if (res.status !== undefined) {
				// A --local status did not compute `incoming` (it never asked the IDE), so carry the last known one
				// forward. Replacing it wholesale would blank the incoming list on every save — reporting "the IDE
				// has nothing for you" purely because we chose not to look.
				this.cached =
					res.status.incomingStale === true && this.cached !== undefined
						? { ...res.status, incoming: this.cached.incoming, pathByName: { ...this.cached.pathByName, ...res.status.pathByName } }
						: res.status;
				this.statusError = undefined;
				// A full refresh (not --local) walked the IDE and recomputed incoming, so the "IDE changed" hint is
				// resolved — the user has now seen what changed. A local refresh only touched outgoing; leave it.
				if (!local) this.ideChanged = false;
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

	/** Re-read connection health from the connector's already-fetched view (no CLI, no IDE walk) and fire. For the
	 *  actions that change nothing but whether the bridge serves — connect/disconnect — where a full `refresh()`
	 *  would cost a `/refs` walk (~9s on a big project) the user is left waiting on. */
	async refreshHealth(): Promise<void> {
		await this.readHealth();
	}

	/** Recompute health + the IDE-change edge from the current connector view. Cheap by construction: `boundStatus`
	 *  reads the session client's cached view, so this is a projection, not a fetch. */
	private async readHealth(): Promise<void> {
		// Skip while OUR OWN mutation holds the in-memory gate — the gate is held until the whole action settles (PAST
		// the bridge op), so it also absorbs the state-file write our own pull/push makes (saveIdeRefs). Reset the edge
		// baseline so the FIRST post-mutation read re-baselines WITHOUT firing a spurious refresh. (Mutations run by
		// ANOTHER frontend or a terminal `volt push` are no longer surfaced — that command reports its own progress;
		// this UI just sees the settled state afterwards.)
		if (isMutationInFlight(this.workspaceRoot)) {
			this.seenHealth = false;
			return;
		}
		if (this.bridgeVendor === undefined) return;
		this.health = await boundStatus(this.workspaceRoot);

		// Detect an IDE-side edit from the cheap health payload: a projectDirty false→true edge, or a project
		// switch. Raise the HINT rather than auto-running `/refs` — that walk freezes the IDE (~9s on a big project);
		// the user refreshes when they choose to, and a full refresh clears the hint by recomputing incoming.
		const h = healthOf(this.health);
		const dirty = h?.projectDirty ?? false;
		const name = h?.projectName ?? undefined;
		const edge = isIdeChangeEdge({ seen: this.seenHealth, dirty: this.lastDirty, name: this.lastProjectName }, { dirty, name });
		this.lastDirty = dirty;
		this.lastProjectName = name;
		this.seenHealth = true;
		if (edge) this.ideChanged = true;

		this.onDidChange.fire();
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
