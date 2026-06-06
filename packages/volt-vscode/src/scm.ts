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
import { type HealthState, probeHealth, readBridgePort } from "./bridge-health.js";
import { cliBin, spawnCapture } from "./cli.js";
import { VOLT_URI_SCHEME, VoltContentProvider } from "./scm-content-provider.js";
import { VoltHistoryProvider } from "./volt-history-tree.js";
import { changeCount, type StatusJson, totalChanges } from "./volt-types.js";
import { VoltTreeProvider } from "./volt-tree.js";

/** OutputChannel for Volt — visible in the Output panel under "Volt SCM". */
let log: vscode.OutputChannel | undefined;

function logln(msg: string): void {
	log?.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Register the Volt workspace controllers and activity-bar TreeView.
 * Called once from `extension.ts`'s `activate()`.
 */
export function registerScm(context: vscode.ExtensionContext): void {
	log = vscode.window.createOutputChannel("Volt SCM");
	context.subscriptions.push(log);
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

	// Title-bar progress indicator while any workspace's `volt status`
	// walk is in flight. /refs against CODESYS now does a real per-item
	// content hash (export_native), which is slower than a stat-only
	// walk but content-accurate — see `feedback_no_fallbacks`. Surfacing
	// busy-ness up front prevents the misleading "No changes" flash.
	const updateBusy = (): void => {
		let busy = false;
		for (const ws of workspaces.values()) {
			if (ws.isRefreshing()) {
				busy = true;
				break;
			}
		}
		tree.message = busy ? "Fetching latest from IDE…" : undefined;
	};
	context.subscriptions.push(
		treeProvider.onDidChangeTreeData(() => updateBusy()),
	);

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
		heartbeatHandle = setInterval(() => {
			for (const ws of workspaces.values()) void ws.probeHealth();
		}, HEALTH_HEARTBEAT_MS);
	};
	const stopHeartbeat = (): void => {
		if (heartbeatHandle !== undefined) {
			clearInterval(heartbeatHandle);
			heartbeatHandle = undefined;
		}
	};
	context.subscriptions.push({
		dispose: stopHeartbeat,
	});
	context.subscriptions.push(
		tree.onDidChangeVisibility((evt) => {
			if (evt.visible) {
				// Snapshot freshness on each focus — user came back, they
				// want to see what's actually true RIGHT NOW.
				for (const ws of workspaces.values()) void ws.refresh();
				startHeartbeat();
			} else {
				stopHeartbeat();
			}
		}),
	);
	// If the view is already visible at registration time (rare — usually
	// it activates on first open), kick off the heartbeat immediately.
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
	// Live IDE/project label next to the "Sync with IDE" header — pulls
	// the project name from the latest /health response. Multi-workspace
	// shows the first connected one (rare case; users typically have
	// one Volt workspace open at a time).
	const updateTitle = (): void => {
		let label: string | undefined;
		for (const ws of workspaces.values()) {
			const h = ws.getHealth();
			if (h.kind === "connected" || h.kind === "degraded") {
				const ide = h.health.ideName ?? "IDE";
				const project = h.health.plcProjectName ?? h.health.projectName;
				label = project !== undefined && project !== null ? `${ide} — ${project}` : ide;
				break;
			}
		}
		tree.description = label;
	};
	const subscribePerWorkspace = (ws: VoltWorkspace): void => {
		context.subscriptions.push(
			ws.onDidChangeStatus(updateBadge),
			ws.onDidChangeHealth(updateTitle),
		);
	};
	for (const ws of workspaces.values()) subscribePerWorkspace(ws);
	context.subscriptions.push(
		sourcesChangedEmitter.event(() => {
			updateBadge();
			updateTitle();
			// Re-subscribe to newly-added workspaces so their first
			// status/health fires update both surfaces too.
			for (const ws of workspaces.values()) subscribePerWorkspace(ws);
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
	private refreshQueued = false;
	/** Latest parsed status JSON — surfaced for the activity-bar TreeView. */
	private latestStatus: StatusJson | undefined;
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

	constructor(
		readonly folder: vscode.WorkspaceFolder,
		private readonly contentProvider: VoltContentProvider,
	) {
		// Refresh on local workspace file changes that affect what `volt
		// status` would report. No timer-based bridge poll runs anymore —
		// IDE-side change detection is driven by the health heartbeat
		// (which checks bridge projectVersion via /health) + view focus.
		const localWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(
				folder,
				"{**/*.{st,gvl,dut,itf,fbd,ld,sfc,cfc},.volt/snapshot/state.json,.volt/snapshot/MERGE_HEAD,.volt/snapshot/MERGE_CONFLICTS,.volt/snapshot/ORIG_HEAD}",
			),
		);
		localWatcher.onDidChange(() => this.scheduleRefresh());
		localWatcher.onDidCreate(() => this.scheduleRefresh());
		localWatcher.onDidDelete(() => this.scheduleRefresh());
		this.disposables.push(localWatcher);
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

	/** Public refresh — runs `volt status --json` AND `/health` in
	 *  parallel; coalesces concurrent calls. The health probe is cheap
	 *  enough that bundling it here keeps the badge fresh on every
	 *  user-driven refresh without an extra round-trip. */
	async refresh(): Promise<void> {
		if (this.refreshInflight !== undefined) {
			this.refreshQueued = true;
			return;
		}
		this.refreshInflight = Promise.all([this.doRefresh(), this.probeHealth()])
			.then(() => undefined)
			.finally(() => {
				this.refreshInflight = undefined;
				// Fire so the tree renders the new (or unchanged) status
				// AND its just-cleared refreshing state.
				this.statusEmitter.fire(this.latestStatus);
				if (this.refreshQueued) {
					this.refreshQueued = false;
					void this.refresh();
				}
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
		void this.refresh();
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
			// Bridge offline / not initialized. Drop cached status so
			// the TreeView shows the empty state instead of stale data.
			// Don't surface an error toast — status failures are common
			// and self-recovering when the bridge comes back.
			this.latestStatus = undefined;
			this.statusEmitter.fire(undefined);
			return;
		}

		let parsed: StatusJson;
		try {
			parsed = JSON.parse(result.stdout) as StatusJson;
		} catch (err) {
			logln(`doRefresh: JSON parse failed: ${err instanceof Error ? err.message : String(err)} — stdout was: ${result.stdout.slice(0, 200)}`);
			return;
		}

		logln(`doRefresh: parsed OK. merging=${parsed.merging !== null} incoming=${changeCount(parsed.incoming)} outgoing=${changeCount(parsed.outgoing)}`);
		this.latestStatus = parsed;
		// Fire the change event AFTER mutating internal state so listeners
		// (the activity-bar TreeView) see the new status when they call
		// getStatus(). One bridge round-trip per poll → the entire Volt
		// UI updates from the same data.
		this.statusEmitter.fire(parsed);
		// Existing `volt://` virtual URIs may now point at different
		// content (e.g. after a pull, HEAD moved; after a bridge edit,
		// the BRIDGE ref's content differs). Fire change events so any
		// open diff editor refreshes.
		this.contentProvider.notifyAllRefs();
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

	const runCli = async (args: string[], description: string, progressTitle: string) => {
		const repo = pickRepo();
		if (repo === undefined) {
			vscode.window.showWarningMessage("Volt: no Volt-bound workspace folder found.");
			return;
		}
		// Wrap the spawn in `vscode.window.withProgress` so the user sees
		// activity instead of silently waiting. On success: ephemeral
		// status-bar message. On failure: error toast with a "Show
		// Output" action that opens the Volt SCM OutputChannel.
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: progressTitle,
				cancellable: false,
			},
			async () => {
				const result = await spawnCapture(cliBin(), args, repo.folder.uri.fsPath);
				if (result.code !== 0) {
					const firstLine =
						result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`;
					logln(`${description} failed (exit ${result.code}): ${result.stderr.trim()}`);
					// Drift on push is the most common recoverable failure
					// — engineer touched the IDE between this user's last
					// pull and push. Offer "Pull first" as the primary
					// action; "Show Output" stays available for diagnosis.
					const isDriftOnPush =
						args[0] === "push" && result.stderr.includes("drift detected");
					const actions: string[] = isDriftOnPush
						? ["Pull first", "Show Output"]
						: ["Show Output"];
					const message = isDriftOnPush
						? `Volt: ${description} refused — the IDE has changed since your last pull. Pull first to absorb the engineer's edits, then push again.`
						: `Volt: ${description} failed: ${firstLine}`;
					const pick = await vscode.window.showErrorMessage(message, ...actions);
					if (pick === "Show Output") log?.show(true);
					if (pick === "Pull first") {
						await vscode.commands.executeCommand("volt.scm.pull");
					}
				} else {
					const headline =
						result.stdout.trim().split("\n")[0] ?? `${description} ok`;
					vscode.window.setStatusBarMessage(`$(check) Volt: ${headline}`, 3000);
				}
				await repo.refresh();
			},
		);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("volt.scm.refresh", async () => {
			const repo = pickRepo();
			if (repo !== undefined) await repo.refresh();
		}),
		// Health row's click target. Surfaces the OutputChannel so the
		// user can read the actual error log when the badge is red.
		// Cheap, side-effect-free — safe to register without a `when`.
		vscode.commands.registerCommand("volt.scm.showOutput", () => {
			log?.show(true);
		}),
		vscode.commands.registerCommand("volt.scm.pull", () => runCli(["pull"], "pull", "Volt: Pulling from IDE…")),
		vscode.commands.registerCommand("volt.scm.push", () => runCli(["push"], "push", "Volt: Pushing to IDE…")),
		vscode.commands.registerCommand("volt.scm.forcePull", () =>
			runCli(["pull", "--force"], "pull --force", "Volt: Force-pulling from IDE…"),
		),
		vscode.commands.registerCommand("volt.scm.forcePush", () =>
			runCli(["push", "--force"], "push --force", "Volt: Force-pushing to IDE…"),
		),
		vscode.commands.registerCommand("volt.scm.mergeContinue", () =>
			runCli(["merge", "--continue"], "merge --continue", "Volt: Continuing merge…"),
		),
		vscode.commands.registerCommand("volt.scm.mergeAbort", async () => {
			const ok = await vscode.window.showWarningMessage(
				"Abort the merge? Local changes made during the merge will be lost.",
				{ modal: true },
				"Abort",
			);
			if (ok !== "Abort") return;
			await runCli(["merge", "--abort"], "merge --abort", "Volt: Aborting merge…");
		}),
		vscode.commands.registerCommand("volt.scm.resolveUseMine", (arg: unknown) =>
			resolveOne(arg, "ours"),
		),
		vscode.commands.registerCommand("volt.scm.resolveUseTheirs", (arg: unknown) =>
			resolveOne(arg, "theirs"),
		),
		vscode.commands.registerCommand("volt.scm.resolveAllUseMine", () =>
			resolveAll("ours"),
		),
		vscode.commands.registerCommand("volt.scm.resolveAllUseTheirs", () =>
			resolveAll("theirs"),
		),
		vscode.commands.registerCommand("volt.scm.discardOutgoing", (arg: unknown) =>
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
	// Right-click on a Merge Changes item fires `volt.scm.resolveUseMine`
	// or `…UseTheirs` with the tree Node as the first argument. We
	// extract the relative path and shell `volt merge --resolve <path>
	// --use-ours|--use-theirs`. The CLI mirrors git's verbs exactly
	// (see cli/merge.ts). After the last conflict resolves, the user
	// still has to click Continue — same two-step as `git add` →
	// `git commit`.
	async function resolveOne(arg: unknown, side: "ours" | "theirs"): Promise<void> {
		const target = extractMergeItemPath(arg);
		if (target === undefined) {
			vscode.window.showWarningMessage("Volt: select a merge conflict item to resolve.");
			return;
		}
		const sideFlag = side === "ours" ? "--use-ours" : "--use-theirs";
		await runCli(
			["merge", "--resolve", target.rel, sideFlag],
			`merge --resolve ${target.rel} ${sideFlag}`,
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
				void vscode.commands.executeCommand("volt.scm.showOutput");
			}
		});
}
