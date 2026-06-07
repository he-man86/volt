/**
 * Volt's workspace controller. The user-facing surface lives entirely
 * in the dedicated Volt activity-bar view (`volt.scm` tree) —
 * deliberately NOT in VS Code's Source Control sidebar (which stays
 * reserved for the user's standard Git provider).
 *
 * Per-folder `VoltWorkspace` instances poll the bridge via
 * `volt status --json` and expose change events. The TreeView in
 * `volt-tree.ts` listens; commands in this file shell `volt` for
 * pull/push/merge with progress notifications.
 *
 * One `VoltWorkspace` per workspace folder that contains a
 * `.volt/config.json`. We activate lazily via `workspaceContains` in
 * package.json, so non-Volt workspaces pay nothing.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { describeOffline, type HealthState, isBridgeOnline, probeHealth, readBridgePort } from "./bridge-health.js";
import { cliBin, getOutputChannel, spawnCapture } from "./cli.js";
import { isMutationInFlight } from "./mutation-gate.js";
import { VOLT_URI_SCHEME, VoltContentProvider } from "./scm-content-provider.js";
import { VoltHistoryProvider } from "./volt-history-tree.js";
import { changeCount, type StatusJson, totalChanges } from "./volt-types.js";
import { VoltTreeProvider } from "./volt-tree.js";
import { isPouFile, readStateMtime } from "./workspace-detection.js";

/** Log to the shared "Volt" OutputChannel (the same one cli.ts writes
 *  CLI invocations to). One channel for the whole extension. */
function logln(msg: string): void {
	getOutputChannel().appendLine(`[${new Date().toISOString()}] ${msg}`);
}

/** Fire a single toast when the latest status JSON reveals a NEW
 *  project-binding mismatch (previous status had none, or there was no
 *  previous status). Surfaces the rename in the user's face once, then
 *  stays quiet — the SCM tree's yellow warning row keeps carrying the
 *  signal. Buttons: "Accept (run init --force)" → `volt.acceptProjectRename`,
 *  "Show Output" → reveals the Volt OutputChannel. */
function maybeNotifyProjectMismatch(
	prev: StatusJson | undefined,
	next: StatusJson,
): void {
	if (next.projectMismatch === null) return;
	if (prev !== undefined && prev.projectMismatch !== null) return;
	const m = next.projectMismatch;
	const from = m.configuredAs.plcProjectName;
	const to = m.bridgeReports.plcProjectName;
	const accept = "Accept (run init --force)";
	const show = "Show Output";
	void vscode.window
		.showWarningMessage(
			`Volt: PLC project renamed in the IDE — "${from}" → "${to}". Pull/push will refuse until you accept the new name.`,
			accept,
			show,
		)
		.then((pick) => {
			if (pick === accept) {
				void vscode.commands.executeCommand("volt.acceptProjectRename");
			} else if (pick === show) {
				void vscode.commands.executeCommand("volt.showOutput");
			}
		});
}

/** Pluck the first non-blank line out of multi-line stderr. The CLI's
 *  error format is "volt: \`volt\` failed unexpectedly\n      <real
 *  message>\n  hint: ..." — the SECOND line is what the user actually
 *  needs to see. We return the first non-empty AFTER the boilerplate
 *  prefix when present, else just the first non-empty line. */
function firstNonEmptyLine(stderr: string): string | undefined {
	const lines = stderr
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (lines.length === 0) return undefined;
	// Skip the `volt: failed unexpectedly` boilerplate if it's followed
	// by a real message; otherwise fall back to whatever we have.
	if (lines.length > 1 && /^volt:.*failed/i.test(lines[0]!)) {
		return lines[1];
	}
	return lines[0];
}

/**
 * Register the Volt workspace controllers and activity-bar TreeView.
 * Called once from `extension.ts`'s `activate()`.
 */
export function registerScm(context: vscode.ExtensionContext): void {
	// Shared Volt OutputChannel is lazy-created in cli.ts; touching it
	// here ensures it shows up in the Output dropdown before any CLI
	// invocation has run.
	getOutputChannel();
	logln(`registerScm: starting. workspaceFolders=${(vscode.workspace.workspaceFolders ?? []).length}`);

	const contentProvider = new VoltContentProvider();
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(VOLT_URI_SCHEME, contentProvider),
	);

	const workspaces = new Map<string, VoltWorkspace>();
	const sourcesChangedEmitter = new vscode.EventEmitter<void>();
	context.subscriptions.push(sourcesChangedEmitter);

	const addWorkspace = (folder: vscode.WorkspaceFolder): void => {
		logln(`addWorkspace: ${folder.uri.fsPath}`);
		try {
			maybeRegisterRepo(folder, workspaces, contentProvider, context, sourcesChangedEmitter);
			watchForVoltConfig(folder, workspaces, contentProvider, context, sourcesChangedEmitter);
		} catch (err) {
			logln(`addWorkspace: ERROR for ${folder.uri.fsPath}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
		}
	};

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		addWorkspace(folder);
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((evt) => {
			for (const f of evt.added) addWorkspace(f);
			for (const f of evt.removed) {
				const ws = workspaces.get(f.uri.fsPath);
				if (ws !== undefined) {
					ws.dispose();
					workspaces.delete(f.uri.fsPath);
					sourcesChangedEmitter.fire();
				}
			}
		}),
	);
	logln(`registerScm: done. ${workspaces.size} workspace(s) registered.`);

	// ── Activity-bar TreeView (the SOLE Volt UI surface) ─────────────
	// The TreeView reads from current `workspaces.values()` lazily on
	// every getChildren() call, and re-subscribes to status events
	// whenever the set of workspaces changes (folder added/removed,
	// .volt/config.json appears mid-session). One bridge round-trip
	// per workspace per 5s poll → entire UI stays in sync.
	const treeProvider = new VoltTreeProvider({
		listSources: () => [...workspaces.values()],
		onSourcesChanged: sourcesChangedEmitter.event,
	});
	context.subscriptions.push(treeProvider);

	const tree = vscode.window.createTreeView("volt.scm", {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(tree);

	// ── Visibility-driven refresh + health heartbeat ────────────────
	// No more 5s blanket polling. The model now:
	//   - When the Volt view becomes visible: refresh full status +
	//     probe /health for every workspace.
	//   - While visible: keep /health refreshed every 30s so the
	//     connection badge stays truthful without re-walking /refs.
	//   - When hidden: stop the heartbeat entirely.
	// Full status refreshes off this heartbeat (vs every tick) because
	// /refs walks the whole project tree in the bridge — expensive.
	// /health is single-call, single-COM-probe — cheap.
	let heartbeatHandle: NodeJS.Timeout | undefined;
	const startHeartbeat = (): void => {
		if (heartbeatHandle !== undefined) return;
		logln(`heartbeat: starting (/health every ${HEALTH_HEARTBEAT_MS}ms)`);
		heartbeatHandle = setInterval(() => {
			for (const ws of workspaces.values()) {
				// Skip the probe while a mutating CLI invocation is
				// running against this workspace — the bridge's COM
				// thread is busy with /fetch or /push and would time
				// out the 2s /health probe, causing a spurious
				// "connection lost" toast mid-pull. The next heartbeat
				// after the verb finishes catches up.
				if (isMutationInFlight(ws.folder.uri.fsPath)) continue;
				void ws.probeHealth();
			}
		}, HEALTH_HEARTBEAT_MS);
	};
	const stopHeartbeat = (): void => {
		if (heartbeatHandle === undefined) return;
		logln(`heartbeat: stopping (view hidden)`);
		clearInterval(heartbeatHandle);
		heartbeatHandle = undefined;
	};

	// state.json mtime poll — ALWAYS ON, independent of view visibility.
	//
	// Why decoupled from the /health heartbeat: /health is an HTTP probe
	// to the bridge — worth gating on view visibility to avoid useless
	// network chatter. The mtime poll is a single `statSync` per workspace
	// per tick — effectively free. Gating it on visibility was a bug: if
	// the user has the Volt activity-bar collapsed and runs `volt pull`
	// from a terminal, state.json gets rewritten, no poll runs, and when
	// they next focus the view they'd see stale data until the
	// onDidChangeVisibility-driven refresh catches up.
	//
	// Polling unconditionally trades ~one stat call every 3s (negligible)
	// for "the tree is always fresh when the user looks at it". The poll
	// only fires `ws.refresh()` on actual mtime changes — no extra work
	// on a quiet workspace.
	const stateMtimePollHandle = setInterval(() => {
		for (const ws of workspaces.values()) {
			if (isMutationInFlight(ws.folder.uri.fsPath)) continue;
			if (ws.pollStateMtime()) void ws.refresh();
		}
	}, STATE_MTIME_POLL_MS);
	context.subscriptions.push({
		dispose: () => clearInterval(stateMtimePollHandle),
	});
	context.subscriptions.push({
		dispose: stopHeartbeat,
	});
	context.subscriptions.push(
		tree.onDidChangeVisibility((evt) => {
			logln(`tree.onDidChangeVisibility: visible=${evt.visible}`);
			if (evt.visible) {
				// No auto-refresh on view focus. The state.json mtime
				// poll (always-on) catches external CLI mutations within
				// 3s; `onDidSaveTextDocument` catches editor saves;
				// `runCliMutating`'s finally catches UI-driven mutations.
				// Re-walking /refs every time the user glances at the
				// sidebar wastes bridge time and surprised the user.
				startHeartbeat();
			} else {
				stopHeartbeat();
			}
		}),
	);
	// If the view is already visible at registration time (rare — usually
	// it activates on first open), kick off the heartbeat immediately.
	logln(`tree.visible at registration = ${tree.visible}`);
	if (tree.visible) startHeartbeat();

	// ── Sync history view ────────────────────────────────────────────
	// Separate view in the same Volt container — shows the snapshot's
	// pull-by-pull history (each `volt pull` = one commit in
	// `.volt/snapshot/`). Click any file row to diff that commit's
	// version against the live workspace. EXPLICITLY labeled "Sync
	// history" / "IDE activity" — not the user's own git history,
	// which lives in VS Code's standard Source Control.
	const historyProvider = new VoltHistoryProvider({
		listSources: () => [...workspaces.values()],
		onSourcesChanged: sourcesChangedEmitter.event,
	});
	context.subscriptions.push(historyProvider);
	const historyView = vscode.window.createTreeView("volt.history", {
		treeDataProvider: historyProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(historyView);

	// Live count badge on the activity-bar icon — VS Code renders it
	// as a small number badge so the user sees "3 incoming" at a
	// glance even with the view collapsed.
	const updateBadge = (): void => {
		let total = 0;
		let anyMerging = false;
		for (const ws of workspaces.values()) {
			const s = ws.getStatus();
			total += totalChanges(s);
			if (s?.merging != null) anyMerging = true;
		}
		tree.badge = total > 0
			? { value: total, tooltip: `Volt: ${total} change(s) to review` }
			: undefined;
		// Drive `volt.merging` so package.json `when` clauses can hide
		// Continue/Abort and bulk-resolve actions when no merge is active.
		void vscode.commands.executeCommand("setContext", "volt.merging", anyMerging);
	};
	// The IDE/project name lives on the per-source health row in the
	// tree itself (the green-dot row at position 0). We deliberately
	// don't ALSO write it into `tree.description` — same data shown
	// twice in adjacent surfaces just reads as clutter. Health changes
	// only need to drive the per-workspace tree re-render (already wired
	// inside VoltTreeProvider via the health emitter).
	const subscribePerWorkspace = (ws: VoltWorkspace): void => {
		context.subscriptions.push(ws.onDidChangeStatus(updateBadge));
	};
	for (const ws of workspaces.values()) subscribePerWorkspace(ws);
	context.subscriptions.push(
		sourcesChangedEmitter.event(() => {
			updateBadge();
			// Re-subscribe to newly-added workspaces so their first
			// status fires update the badge too.
			for (const ws of workspaces.values()) subscribePerWorkspace(ws);
		}),
	);

	// Editor-save refresh.
	//
	// Replaces the .st/.gvl/.struct/... half of the dead FileSystemWatcher.
	// `onDidSaveTextDocument` fires from VS Code's own document buffer,
	// not from the OS-level file watcher — so it's reliable on OneDrive-
	// synced folders. We filter by PLC extension and only refresh the
	// workspace that owns the saved file.
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (doc.uri.scheme !== "file") return;
			if (!isPouFile(doc.uri.fsPath)) return;
			const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
			if (folder === undefined) return;
			const ws = workspaces.get(folder.uri.fsPath);
			if (ws === undefined) return;
			logln(`onDidSaveTextDocument[${folder.name}] ${vscode.workspace.asRelativePath(doc.uri, false)}`);
			void ws.refresh();
		}),
	);

	// Internal command — apply a CLI-emitted post-state directly to the
	// workspace, skipping the slow `volt status --json` walk.
	//
	// Fired by `runCliMutating` (cli.ts) when the CLI's stdout carried a
	// `__VOLT_POST_STATE__` sentinel line — pull/push emit it on clean
	// success because the agent already walked /refs to do the mutation
	// and knows the post-state is inc=0/out=0. Skipping the extension's
	// own status walk eliminates the 8s "dead time" the user otherwise
	// saw between pull completing and the tree clearing on a 243-item
	// CODESYS project. Same architectural idea as the bridge /health
	// cache: each layer publishes what it already knows so the next
	// layer doesn't re-compute it.
	context.subscriptions.push(
		vscode.commands.registerCommand("volt._applyPostState", (cwd: unknown, status: unknown) => {
			if (typeof cwd !== "string") return;
			const ws = workspaces.get(cwd);
			if (ws === undefined) return;
			if (typeof status !== "object" || status === null) return;
			ws.applyStatus("post-mutation", status as StatusJson);
		}),
	);

	// Internal command — refresh a specific workspace by cwd, optionally
	// skipping the /health probe.
	//
	// Fired by `runCliMutating`'s finally (cli.ts) to update the SCM tree
	// after a UI-driven pull/push/init/rebind completes. Distinct from the
	// public `volt.refresh` command, which uses `pickRepo()` heuristics —
	// here cli.ts already knows the exact cwd, so route directly. Marked
	// `_` to signal "extension-internal, not for human invocation".
	//
	// `skipHealthProbe` is passed by the post-mutation caller: the bridge
	// just talked to us via the CLI body, the probe is redundant, and
	// running it races the bridge's COM-thread recovery (2s timeout
	// spuriously flips to "unreachable" right after a clean inc=0).
	context.subscriptions.push(
		vscode.commands.registerCommand("volt._refreshFolder", async (cwd: unknown, options?: unknown) => {
			if (typeof cwd !== "string") return;
			const ws = workspaces.get(cwd);
			if (ws === undefined) return;
			const opts = (typeof options === "object" && options !== null)
				? options as { skipHealthProbe?: boolean }
				: {};
			await ws.refresh(opts);
		}),
	);

	registerWorkspaceCommands(context, workspaces);
}

function maybeRegisterRepo(
	folder: vscode.WorkspaceFolder,
	repos: Map<string, VoltWorkspace>,
	contentProvider: VoltContentProvider,
	context: vscode.ExtensionContext,
	sourcesChanged: vscode.EventEmitter<void>,
): void {
	if (repos.has(folder.uri.fsPath)) {
		logln(`maybeRegisterRepo: ${folder.uri.fsPath} already registered, skipping`);
		return;
	}
	const configPath = join(folder.uri.fsPath, ".volt", "config.json");
	const has = existsSync(configPath);
	logln(`maybeRegisterRepo: ${folder.uri.fsPath} — configPath=${configPath} exists=${has}`);
	if (!has) return; // not a Volt workspace
	try {
		const ws = new VoltWorkspace(folder, contentProvider);
		repos.set(folder.uri.fsPath, ws);
		context.subscriptions.push(ws);
		logln(`maybeRegisterRepo: created VoltWorkspace for ${folder.uri.fsPath}`);
		sourcesChanged.fire();
		// Kick off the first refresh in the background so activation stays fast.
		void ws.refresh();
	} catch (err) {
		logln(`maybeRegisterRepo: ERROR creating VoltWorkspace: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
	}
}

/**
 * Watch a non-Volt folder for the appearance of `.volt/config.json`.
 * When `volt init` is run AFTER the extension activated (the common
 * case for a fresh workspace), the workspace controller must register
 * without requiring a window reload. The watcher also fires on delete
 * so an abandoned Volt workspace cleans up correctly.
 */
function watchForVoltConfig(
	folder: vscode.WorkspaceFolder,
	repos: Map<string, VoltWorkspace>,
	contentProvider: VoltContentProvider,
	context: vscode.ExtensionContext,
	sourcesChanged: vscode.EventEmitter<void>,
): void {
	const watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(folder, ".volt/config.json"),
	);
	const onAppear = (): void => {
		maybeRegisterRepo(folder, repos, contentProvider, context, sourcesChanged);
	};
	const onGone = (): void => {
		const ws = repos.get(folder.uri.fsPath);
		if (ws !== undefined) {
			ws.dispose();
			repos.delete(folder.uri.fsPath);
			sourcesChanged.fire();
		}
	};
	watcher.onDidCreate(onAppear);
	watcher.onDidChange(onAppear);
	watcher.onDidDelete(onGone);
	context.subscriptions.push(watcher);
}

/**
 * Per-folder source-control instance. Owns its SourceControl, three
 * resource groups, a file watcher, and the CLI shell-outs that
 * populate them.
 */
/**
 * Health-heartbeat interval (ms). Hits the bridge's cheap `/health`
 * endpoint — NOT `/refs` — and only while the Volt activity-bar view
 * is visible. The bridge probes IDE liveness on each `/health` call,
 * so this doubles as a "is the IDE still alive?" signal for the badge.
 *
 * Full status refreshes (`volt status --json`, which walks `/refs`)
 * fire on user-driven events only: view becomes visible, manual
 * refresh, local file change. The 5s blanket poll that used to run
 * here was retired — too heavy for too little signal, and `/refs`
 * walks the whole project tree on every call.
 */
const HEALTH_HEARTBEAT_MS = 30_000;

/**
 * Mtime-poll interval (ms) for `.volt/snapshot/state.json`. Always on,
 * independent of view visibility — `statSync` is essentially free, and
 * gating on visibility hid external CLI mutations from users with the
 * sidebar collapsed. Catches `volt pull/push/init` run from a terminal
 * on OneDrive-synced folders, where VS Code's RelativePattern watcher
 * silently drops bulk-write events.
 *
 * 3s is the trade-off between responsiveness (user expects the tree
 * to update soon after a terminal pull) and overhead (each tick is
 * one stat per workspace — negligible). `lastStateMtime` is updated by
 * `doRefresh` on success, so a UI-button pull's post-mutation refresh
 * also claims the new mtime — the next poll tick sees no change and
 * skips, avoiding a redundant second refresh that would race the bridge.
 */
const STATE_MTIME_POLL_MS = 3_000;

/**
 * Per-workspace Volt state — polls the bridge, caches status, fires
 * change events. UI consumers (the activity-bar TreeView, commands)
 * subscribe to `onDidChangeStatus`. There is intentionally NO
 * `vscode.scm.createSourceControl` registration — Volt does NOT
 * appear in VS Code's Source Control sidebar. That tab is reserved
 * for the user's standard Git provider. Volt lives entirely in its
 * own activity-bar entry (registered via `volt.scm` view in
 * `package.json`).
 */
class VoltWorkspace implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private refreshInflight: Promise<void> | undefined;
	/** Latest parsed status JSON — surfaced for the activity-bar TreeView. */
	private latestStatus: StatusJson | undefined;
	/** Stderr (first non-empty line) captured when `volt status --json`
	 *  exits non-zero. Cleared on the next successful run. Lets the
	 *  TreeView show the real failure instead of pretending we're in sync. */
	private latestStatusError: string | undefined;
	/** Latest health-probe result — drives the connection badge. */
	private latestHealth: HealthState = { kind: "unknown" };
	/** Fires after `doRefresh()` produces new status. The activity-bar
	 *  `TreeDataProvider` listens so it can re-render off the same poll. */
	private readonly statusEmitter = new vscode.EventEmitter<StatusJson | undefined>();
	readonly onDidChangeStatus: vscode.Event<StatusJson | undefined> = this.statusEmitter.event;
	/** Fires after `probeHealth()` completes — lets the badge update
	 *  without re-running the full status walk. */
	private readonly healthEmitter = new vscode.EventEmitter<HealthState>();
	readonly onDidChangeHealth: vscode.Event<HealthState> = this.healthEmitter.event;
	/** Get the most recently observed status (or undefined before the first refresh). */
	getStatus(): StatusJson | undefined {
		return this.latestStatus;
	}
	/** Get the last `volt status --json` stderr (first line), or undefined
	 *  if the call hasn't failed since the last success. */
	getStatusError(): string | undefined {
		return this.latestStatusError;
	}
	/** Get the most recently observed health (or { kind: "unknown" } before the first probe). */
	getHealth(): HealthState {
		return this.latestHealth;
	}
	getFolder(): vscode.WorkspaceFolder {
		return this.folder;
	}
	/** True while a `volt status` walk is in progress. Used by the
	 *  TreeView to render "Loading…" during the initial fetch instead
	 *  of the misleading "No changes" empty state. */
	isRefreshing(): boolean {
		return this.refreshInflight !== undefined;
	}

	/** Last-seen mtime of `.volt/snapshot/state.json` (ms since epoch).
	 *  Captured at construction so the first `pollStateMtime` call doesn't
	 *  trigger a phantom refresh. Updated each time the mtime changes —
	 *  see `pollStateMtime`. Zero = file didn't exist at last check. */
	private lastStateMtime = 0;

	constructor(
		readonly folder: vscode.WorkspaceFolder,
		private readonly contentProvider: VoltContentProvider,
	) {
		// No FileSystemWatcher here on purpose.
		//
		// We used to subscribe a RelativePattern watcher to every tracked
		// PLC extension and `.volt/snapshot/state.json`. It silently
		// dropped bulk-write events on OneDrive-synced workspace folders:
		// 247 files written by `volt pull`, zero onDidChange callbacks.
		// (Confirmed live on C:\Users\marce\OneDrive\Bureaublad\hauzer.)
		//
		// Single watcher → two purpose-built sources, each reliable in
		// its domain:
		//
		//   - External CLI mutations (terminal `volt pull/push/init`) →
		//     the `state.json` mtime poll in `registerScm`'s heartbeat
		//     (3s cadence, `statSync` is reliable on OneDrive).
		//   - Editor saves on tracked PLC sources → `onDidSaveTextDocument`
		//     subscription in `registerScm` (VS Code owns the document
		//     buffer, so the event doesn't go through OneDrive's reparse
		//     points and never gets dropped).
		//   - UI-driven mutations (Pull/Push buttons) → explicit refresh
		//     fired by `runCliMutating`'s finally (cli.ts).
		this.lastStateMtime = readStateMtime(this.folder.uri.fsPath);
	}

	dispose(): void {
		this.statusEmitter.dispose();
		this.healthEmitter.dispose();
		for (const d of this.disposables) d.dispose();
	}

	/**
	 * Probe `/health` directly via HTTP — cheap (single COM round-trip
	 * in the bridge). Called by the activity-bar heartbeat and by
	 * `refresh()` so the badge updates whenever the tree does.
	 *
	 * Side effect: shows a one-shot toast when health transitions from
	 * a working state (connected / degraded) to a broken one
	 * (disconnected / unreachable). The toast suppresses on the inverse
	 * transition — when state comes back, we don't bother the user.
	 * Also suppresses on first probe (no prior state to compare).
	 */
	async probeHealth(): Promise<void> {
		const port = readBridgePort(this.folder.uri.fsPath);
		const prev = this.latestHealth;
		const next: HealthState = port === undefined
			? {
				kind: "unreachable",
				reason: ".volt/config.json missing or has no bridge.port",
			}
			: await probeHealth(port);
		this.latestHealth = next;
		this.healthEmitter.fire(next);
		maybeNotifyConnectionLoss(this.folder, prev, next);
	}

	/** Public refresh — optional /health probe, then status conditionally.
	 *
	 *  Lifecycle: optionally `probe /health` → if offline, stop (clear
	 *  stale status, surface offline state). If online, shell `volt status
	 *  --json`. Skipping /health is for the post-mutation refresh fired
	 *  by `runCliMutating`'s finally: the bridge JUST talked to us via
	 *  the CLI body, so the probe is redundant — and it races the bridge's
	 *  COM-thread recovery (a 2s /health timeout right after a pull
	 *  spuriously flips state to "unreachable" and clobbers the clean
	 *  `inc=0` we just got).
	 *
	 *  Coalesces concurrent calls via `refreshInflight`: if a refresh is
	 *  already in flight, drop the new trigger. No queue — with the
	 *  watcher gone and visibility-refresh removed, triggers don't burst.
	 *  Any genuinely-missed mtime change is picked up by the next 3s poll
	 *  tick since `lastStateMtime` only updates on a successful
	 *  `doRefresh`. */
	async refresh(options: { skipHealthProbe?: boolean } = {}): Promise<void> {
		if (this.refreshInflight !== undefined) {
			// Expected during long refreshes — the 3s mtime poll fires
			// every tick while volt status walks /refs (~12s on CODESYS),
			// and each subsequent tick is correctly coalesced into the
			// in-flight refresh. Logged so the log reads "we noticed and
			// chose not to spawn a duplicate" rather than "an event was
			// silently lost".
			logln(`refresh[${this.folder.name}]: already running — coalesced (in-flight refresh will pick up any change)`);
			return;
		}
		const skipHealth = options.skipHealthProbe ?? false;
		logln(`refresh[${this.folder.name}]: starting (mutationInFlight=${isMutationInFlight(this.folder.uri.fsPath)} skipHealth=${skipHealth})`);
		this.refreshInflight = (async () => {
			if (!skipHealth) {
				await this.probeHealth();
				logln(`refresh[${this.folder.name}]: probeHealth done — kind=${this.latestHealth.kind}`);
			}
			if (skipHealth || isBridgeOnline(this.latestHealth)) {
				await this.doRefresh();
			} else {
				// Bridge offline — drop any stale status so the tree
				// shows the offline state instead of last-seen data.
				// Clear errors too: "Bridge offline" is a clearer story
				// than re-rendering a status-failed message from when
				// the bridge died mid-call.
				logln(
					`refresh[${this.folder.name}]: skipping volt status — bridge is ${this.latestHealth.kind} ` +
					`(${describeOffline(this.latestHealth)})`,
				);
				this.clearStatusForError(undefined);
			}
		})().finally(() => {
			this.refreshInflight = undefined;
			// Fire so the tree renders the new (or unchanged) status
			// AND its just-cleared refreshing state.
			logln(`refresh[${this.folder.name}]: finished — firing statusEmitter (status=${this.latestStatus === undefined ? "undefined" : `inc=${changeCount(this.latestStatus.incoming)} out=${changeCount(this.latestStatus.outgoing)}`})`);
			this.statusEmitter.fire(this.latestStatus);
		});
		// Tell the tree provider a refresh started — it can show
		// "Loading…" while we wait. Re-emits the current cached status
		// (or undefined on first refresh); isRefreshing() reads true now.
		this.statusEmitter.fire(this.latestStatus);
		return this.refreshInflight;
	}

	private scheduleRefresh(): void {
		// Debounce: file-system bursts (e.g. a multi-file pull) fire many
		// events; we re-coalesce via refreshQueued.
		logln(`scheduleRefresh[${this.folder.name}]`);
		void this.refresh();
	}

	/** Apply a fresh status snapshot from any source — `volt status
	 *  --json` walk, `volt pull --json` post-state, or any future writer.
	 *
	 *  Single write-path into `latestStatus`. Centralizes the four side
	 *  effects every successful status update must perform:
	 *    1. Replace the cached status + clear any prior error.
	 *    2. Claim the current state.json mtime so the mtime poll doesn't
	 *       re-trigger a redundant refresh.
	 *    3. Notify on a NEW project-binding mismatch (one-shot toast).
	 *    4. Fire the status emitter + invalidate `volt://` virtual URIs
	 *       so any open diff editor refreshes.
	 *
	 *  `source` is only for the log line — every source goes through the
	 *  same side effects so adding a new caller can't drift. */
	applyStatus(source: "walk" | "post-mutation", status: StatusJson): void {
		logln(`applyStatus[${this.folder.name}] source=${source} inc=${changeCount(status.incoming)} out=${changeCount(status.outgoing)} projectMismatch=${status.projectMismatch !== null}`);
		const prevStatus = this.latestStatus;
		this.latestStatus = status;
		this.latestStatusError = undefined;
		this.lastStateMtime = readStateMtime(this.folder.uri.fsPath);
		maybeNotifyProjectMismatch(prevStatus, status);
		this.statusEmitter.fire(status);
		this.contentProvider.notifyAllRefs();
	}

	/** Single error/offline-clearing path. Drops the cached status so
	 *  the tree shows the offline/error state instead of stale data.
	 *  `reason` of undefined = the bridge is offline (red-dot health row
	 *  carries the message — no separate error row needed); a string is
	 *  a `volt status` failure (rendered as a status-error row). */
	private clearStatusForError(reason: string | undefined): void {
		this.latestStatus = undefined;
		this.latestStatusError = reason;
		this.statusEmitter.fire(undefined);
	}

	/** Returns true when `.volt/snapshot/state.json`'s mtime differs from
	 *  the cached value. Pure read — does NOT update the cache. The
	 *  cache is claimed by `doRefresh` on success, so a poll that
	 *  triggers a refresh which then fails to complete will keep
	 *  returning true on subsequent ticks (natural retry); the post-
	 *  mutation refresh ALSO claims the cache on success, which
	 *  suppresses redundant mtime-poll triggers after a UI-button pull. */
	pollStateMtime(): boolean {
		const current = readStateMtime(this.folder.uri.fsPath);
		if (current !== this.lastStateMtime) {
			logln(`pollStateMtime[${this.folder.name}]: state.json mtime differs (cached=${this.lastStateMtime} current=${current})`);
			return true;
		}
		return false;
	}

	private async doRefresh(): Promise<void> {
		logln(`doRefresh: spawning '${cliBin()} status --json' in ${this.folder.uri.fsPath}`);
		const result = await spawnCapture(
			cliBin(),
			["status", "--json"],
			this.folder.uri.fsPath,
		);
		logln(`doRefresh: exit=${result.code} stdout.len=${result.stdout.length} stderr.len=${result.stderr.length}`);
		if (result.code !== 0) {
			logln(`doRefresh: non-zero exit, stderr: ${result.stderr.slice(0, 500)}`);
			const firstErrLine = firstNonEmptyLine(result.stderr) ?? `volt status exited ${result.code}`;
			const transitionedToError = this.latestStatusError === undefined;
			this.clearStatusForError(firstErrLine);
			// One-shot toast on the FIRST failure after a working state.
			// Repeated failures stay quiet — the TreeView's error node
			// keeps the message visible, and a steady stream of toasts
			// would be hostile UX during a longer outage.
			if (transitionedToError) {
				const action = "Show Output";
				void vscode.window
					.showErrorMessage(`Volt: status failed — ${firstErrLine}`, action)
					.then((pick) => {
						if (pick === action) {
							void vscode.commands.executeCommand("volt.showOutput");
						}
					});
			}
			return;
		}

		let parsed: StatusJson;
		try {
			parsed = JSON.parse(result.stdout) as StatusJson;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logln(`doRefresh: JSON parse failed: ${msg} — stdout was: ${result.stdout.slice(0, 200)}`);
			const transitionedToError = this.latestStatusError === undefined;
			this.clearStatusForError(`volt status produced malformed JSON: ${msg}`);
			if (transitionedToError) {
				const action = "Show Output";
				void vscode.window
					.showErrorMessage(`Volt: status produced unreadable JSON — ${msg}`, action)
					.then((pick) => {
						if (pick === action) {
							void vscode.commands.executeCommand("volt.showOutput");
						}
					});
			}
			return;
		}

		this.applyStatus("walk", parsed);
	}
}

// ─── Workspace-level commands ────────────────────────────────────────

function registerWorkspaceCommands(
	context: vscode.ExtensionContext,
	repos: Map<string, VoltWorkspace>,
): void {
	const pickRepo = (): VoltWorkspace | undefined => {
		// Single-repo case: the only one we have.
		if (repos.size === 1) return [...repos.values()][0];
		// Multi-repo: prefer the one matching the active editor's folder.
		const active = vscode.window.activeTextEditor?.document.uri;
		if (active !== undefined) {
			const folder = vscode.workspace.getWorkspaceFolder(active);
			if (folder !== undefined) {
				const r = repos.get(folder.uri.fsPath);
				if (r !== undefined) return r;
			}
		}
		return [...repos.values()][0];
	};

	// Run a merge-related CLI verb in the context of the picked repo, with
	// a Notification progress popup. Forwarding pull/push/forcePull/
	// forcePush to cli.ts's helpers keeps feedback patterns consistent;
	// this local runner only handles merge ops (which need workspace
	// state to refresh on completion).
	const runMergeOp = async (
		args: string[],
		describe: string,
		progressTitle: string,
	): Promise<void> => {
		const repo = pickRepo();
		if (repo === undefined) {
			vscode.window.showWarningMessage("Volt: no Volt-bound workspace folder found.");
			return;
		}
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: progressTitle,
				cancellable: false,
			},
			async () => {
				const result = await spawnCapture(cliBin(), args, repo.folder.uri.fsPath);
				logln(`${describe} exit=${result.code}`);
				if (result.code !== 0) {
					const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
					const pick = await vscode.window.showErrorMessage(
						`Volt: ${describe} failed: ${firstLine}`,
						"Show Output",
					);
					if (pick === "Show Output") getOutputChannel().show(true);
				} else {
					vscode.window.showInformationMessage(`Volt: ${describe} complete.`);
				}
				await repo.refresh();
			},
		);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("volt.refresh", async () => {
			const repo = pickRepo();
			if (repo === undefined) return;
			await repo.refresh();
			// Acknowledge the click with a 3s status-bar message — the
			// only visible signal of "refresh ran" when nothing changed.
			// Activity-bar badge already handles persistent change-count
			// display; this is just the per-click ack.
			const status = repo.getStatus();
			const inc = status === undefined ? 0 : changeCount(status.incoming);
			const out = status === undefined ? 0 : changeCount(status.outgoing);
			const msg =
				inc === 0 && out === 0
					? "$(check) Volt: refreshed — in sync with IDE"
					: `$(sync) Volt: refreshed — ${inc} incoming, ${out} outgoing`;
			vscode.window.setStatusBarMessage(msg, 3000);
		}),
		vscode.commands.registerCommand("volt.merge.continue", () =>
			runMergeOp(["merge", "--continue"], "merge --continue", "Volt: Continuing merge…"),
		),
		vscode.commands.registerCommand("volt.merge.abort", async () => {
			const ok = await vscode.window.showWarningMessage(
				"Abort the merge? Local changes made during the merge will be lost.",
				{ modal: true },
				"Abort",
			);
			if (ok !== "Abort") return;
			await runMergeOp(["merge", "--abort"], "merge --abort", "Volt: Aborting merge…");
		}),
		vscode.commands.registerCommand("volt.merge.useMine", (arg: unknown) =>
			resolveOne(arg, "ours"),
		),
		vscode.commands.registerCommand("volt.merge.useTheirs", (arg: unknown) =>
			resolveOne(arg, "theirs"),
		),
		vscode.commands.registerCommand("volt.merge.useAllMine", () =>
			resolveAll("ours"),
		),
		vscode.commands.registerCommand("volt.merge.useAllTheirs", () =>
			resolveAll("theirs"),
		),
		vscode.commands.registerCommand("volt.discardOutgoing", (arg: unknown) =>
			discardOutgoing(arg),
		),
	);

	// ── Outgoing-item discard helper ────────────────────────────────
	//
	// Mirrors `git restore <path>` / `git checkout HEAD -- <path>`:
	// overwrites a workspace file with its HEAD (last-pulled) content.
	// Uses `volt show HEAD <rel>` to fetch the blob — same primitive
	// the diff view relies on, no new CLI verb needed. Confirms
	// destructively because this throws away user edits.
	async function discardOutgoing(arg: unknown): Promise<void> {
		const target = extractMergeItemPath(arg);
		if (target === undefined) {
			vscode.window.showWarningMessage("Volt: select a file to discard.");
			return;
		}
		const ok = await vscode.window.showWarningMessage(
			`Discard local changes to ${target.rel}? This restores the file to its last-pulled (HEAD) version. The current edits will be lost.`,
			{ modal: true },
			"Discard",
		);
		if (ok !== "Discard") return;
		const repo = pickRepo();
		if (repo === undefined) return;
		const result = await spawnCapture(
			cliBin(),
			["show", "HEAD", target.rel],
			repo.folder.uri.fsPath,
		);
		if (result.code !== 0) {
			const firstLine = result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
			vscode.window.showErrorMessage(`Volt: couldn't read HEAD for ${target.rel}: ${firstLine}`);
			logln(`discardOutgoing ${target.rel} failed: ${result.stderr.trim()}`);
			return;
		}
		const fileUri = vscode.Uri.joinPath(target.folder.uri, target.rel);
		try {
			await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.stdout, "utf-8"));
		} catch (err) {
			vscode.window.showErrorMessage(
				`Volt: failed to write ${target.rel}: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}
		vscode.window.setStatusBarMessage(`$(check) Volt: discarded local changes to ${target.rel}`, 3000);
		await repo.refresh();
	}

	// ── Per-file resolution helpers ─────────────────────────────────
	//
	// Right-click on a Merge Changes item fires `volt.merge.useMine`
	// or `volt.merge.useTheirs` with the tree Node as the first
	// argument. We extract the relative path and shell `volt merge
	// --resolve <path> --use-ours|--use-theirs`. The CLI mirrors git's
	// verbs exactly (see cli/merge.ts). After the last conflict
	// resolves, the user still has to click Continue — same two-step
	// as `git add` → `git commit`.
	async function resolveOne(arg: unknown, side: "ours" | "theirs"): Promise<void> {
		const target = extractMergeItemPath(arg);
		if (target === undefined) {
			vscode.window.showWarningMessage("Volt: select a merge conflict item to resolve.");
			return;
		}
		const sideFlag = side === "ours" ? "--use-ours" : "--use-theirs";
		await runMergeOp(
			["merge", "--resolve", target.rel, sideFlag],
			`merge --resolve ${target.rel} (${side === "ours" ? "mine" : "IDE's"})`,
			`Volt: Resolving ${target.rel} (use ${side === "ours" ? "mine" : "IDE's"})…`,
		);
	}

	async function resolveAll(side: "ours" | "theirs"): Promise<void> {
		const repo = pickRepo();
		if (repo === undefined) {
			vscode.window.showWarningMessage("Volt: no Volt-bound workspace folder found.");
			return;
		}
		const status = repo.getStatus();
		const conflicts = status?.merging?.conflicts ?? [];
		if (conflicts.length === 0) {
			vscode.window.showInformationMessage("Volt: no merge conflicts to resolve.");
			return;
		}
		const label = side === "ours" ? "my version" : "the IDE's version";
		const ok = await vscode.window.showWarningMessage(
			`Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} using ${label}? This overwrites the workspace for each conflicted file.`,
			{ modal: true },
			"Resolve all",
		);
		if (ok !== "Resolve all") return;
		const sideFlag = side === "ours" ? "--use-ours" : "--use-theirs";
		// Run sequentially — each resolve mutates MERGE_CONFLICTS, so
		// parallel would race on the JSON file. A few CLI shell-outs per
		// merge is fast enough that the simpler loop wins over batching.
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Volt: Resolving ${conflicts.length} conflict(s) using ${label}…`,
				cancellable: false,
			},
			async (progress) => {
				let resolved = 0;
				for (const c of conflicts) {
					progress.report({
						message: `${c.path} (${resolved + 1}/${conflicts.length})`,
					});
					const result = await spawnCapture(
						cliBin(),
						["merge", "--resolve", c.path, sideFlag],
						repo.folder.uri.fsPath,
					);
					if (result.code !== 0) {
						const firstLine =
							result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
						logln(`resolve ${c.path} failed: ${result.stderr.trim()}`);
						vscode.window.showErrorMessage(
							`Volt: failed to resolve ${c.path}: ${firstLine}`,
						);
						break;
					}
					resolved += 1;
				}
				await repo.refresh();
				if (resolved > 0) {
					vscode.window.setStatusBarMessage(
						`$(check) Volt: resolved ${resolved} conflict(s). Run "Continue merge" to finalize.`,
						5000,
					);
				}
			},
		);
	}
}

/**
 * Pull a relative-path out of whatever the menu command handed us. Tree
 * context menus pass the underlying `Node`; click handlers pass a
 * `vscode.Uri`. Returns undefined when we can't resolve a workspace
 * folder, so callers can show a friendly warning instead of crashing.
 */
function extractMergeItemPath(
	arg: unknown,
): { folder: vscode.WorkspaceFolder; rel: string } | undefined {
	const uri = extractUriFromArg(arg);
	if (uri === undefined) return undefined;
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (folder === undefined) return undefined;
	const rel = vscode.workspace.asRelativePath(uri, false);
	return { folder, rel };
}

function extractUriFromArg(arg: unknown): vscode.Uri | undefined {
	if (arg === undefined || arg === null) return undefined;
	if (arg instanceof vscode.Uri) return arg;
	if (typeof arg === "object") {
		const maybeUri = (arg as { uri?: unknown }).uri;
		if (maybeUri instanceof vscode.Uri) return maybeUri;
		const maybeResourceUri = (arg as { resourceUri?: unknown }).resourceUri;
		if (maybeResourceUri instanceof vscode.Uri) return maybeResourceUri;
	}
	return undefined;
}

/**
 * Show a one-shot toast when health transitions from a working state
 * (connected/degraded — bridge is talking to an IDE) to a broken state
 * (disconnected/unreachable — IDE went away or bridge died).
 *
 * Designed to never fire on:
 *   - first probe (prev.kind === "unknown")
 *   - recovery transitions (broken → working)
 *   - lateral transitions within the same severity (disconnected ↔ unreachable)
 *
 * The "Show Output" action opens the Volt SCM channel so users with
 * recurring connection drops can see what's happening in the log.
 */
function maybeNotifyConnectionLoss(
	folder: vscode.WorkspaceFolder,
	prev: HealthState,
	next: HealthState,
): void {
	const isWorking = (s: HealthState): boolean =>
		s.kind === "connected" || s.kind === "degraded";
	const isBroken = (s: HealthState): boolean =>
		s.kind === "disconnected" || s.kind === "unreachable";
	if (!(isWorking(prev) && isBroken(next))) return;
	// Suppress the toast when the apparent connection loss happened
	// while a CLI mutation was in flight — the bridge's COM thread was
	// busy serving /fetch or /push and just couldn't service the 2s
	// /health probe in time. It's not a real disconnect; the next
	// heartbeat after the verb finishes will confirm.
	if (isMutationInFlight(folder.uri.fsPath)) return;

	const reason =
		next.kind === "unreachable"
			? next.reason
			: next.kind === "disconnected"
				? next.health.degradedReason ?? "no IDE attached"
				: "unknown";
	const folderLabel = folder.name;
	void vscode.window
		.showWarningMessage(
			`Volt: lost IDE connection (${folderLabel}) — ${reason}`,
			"Show Output",
		)
		.then((pick) => {
			if (pick === "Show Output") {
				void vscode.commands.executeCommand("volt.showOutput");
			}
		});
}
