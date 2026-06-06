/**
 * Activity-bar TreeView for Volt — the dedicated "Volt" container's
 * primary view. Mirrors the SCM provider's resource groups so the user
 * sees the same incoming / outgoing / merge changes in their own pane,
 * distinct from VS Code's standard Source Control view (which carries
 * git only when this view is in use).
 *
 * Data flow: each `VoltSourceControl` instance fires `onDidChangeStatus`
 * after every `doRefresh()` poll. This `TreeDataProvider` listens and
 * re-renders. No double-polling — both surfaces share the same 5s
 * bridge round-trip.
 *
 * Click behavior: every leaf item carries a `command: vscode.diff`
 * pointing at the same `volt://` URIs the SCM provider uses, so the
 * diff click experience (HEAD for outgoing, BRIDGE for incoming,
 * MERGE_HEAD for merge) is identical to the Source Control panel.
 */
import * as vscode from "vscode";
import { describeOffline, type HealthState, healthLabel, isBridgeOnline } from "./bridge-health.js";
import { buildVoltUri } from "./scm-content-provider.js";
import { changeCount, type ProjectMismatch, type StatusJson } from "./volt-types.js";

/**
 * Minimal subset of `VoltWorkspace` this view needs. Keeps the
 * coupling lightweight — we depend on the data shape and the event,
 * not on the workspace controller's full surface area.
 */
export interface StatusSource {
	getStatus(): StatusJson | undefined;
	getHealth(): HealthState;
	getFolder(): vscode.WorkspaceFolder;
	/** True while a `volt status` refresh is in flight. Lets the tree
	 *  show "Loading…" instead of "No changes" during the initial walk. */
	isRefreshing(): boolean;
	/** When the last `volt status --json` exited non-zero, captures the
	 *  first stderr line so the tree can render it instead of the
	 *  misleading "in sync" empty state. Undefined when status either
	 *  hasn't run yet (use isRefreshing) or last ran successfully. */
	getStatusError(): string | undefined;
	readonly onDidChangeStatus: vscode.Event<StatusJson | undefined>;
	readonly onDidChangeHealth: vscode.Event<HealthState>;
}

/**
 * Provider configuration. `listSources()` is called lazily on every
 * tree refresh so newly-added workspace folders show up automatically.
 * `onSourcesChanged` fires when a workspace is added or removed at
 * runtime, so the provider can re-subscribe to per-source events.
 */
export interface VoltTreeProviderOptions {
	listSources: () => readonly StatusSource[];
	onSourcesChanged: vscode.Event<void>;
}

type Node =
	| { kind: "health"; state: HealthState; sourceIdx: number }
	| { kind: "group"; label: string; group: "incoming" | "outgoing" | "merge"; sourceIdx: number; count: number }
	| { kind: "item"; label: string; uri: vscode.Uri; group: "incoming" | "outgoing" | "merge"; letter: "A" | "M" | "D"; sourceIdx: number; rel: string }
	| { kind: "empty"; label: string }
	| { kind: "loading"; label: string }
	| { kind: "status-error"; label: string; tooltip: string }
	| { kind: "project-mismatch"; label: string; tooltip: string; sourceIdx: number };

export class VoltTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;
	private readonly options: VoltTreeProviderOptions;
	private readonly perSourceSubs: vscode.Disposable[] = [];
	private readonly disposables: vscode.Disposable[] = [];

	constructor(options: VoltTreeProviderOptions) {
		this.options = options;
		this.resubscribe();
		this.disposables.push(options.onSourcesChanged(() => this.resubscribe()));
	}

	/**
	 * (Re-)subscribe to the per-source `onDidChangeStatus` events.
	 * Called on construction and whenever the source set changes
	 * (workspace folder added/removed, `.volt/config.json` appears).
	 * Disposes old subscriptions so listener counts don't leak.
	 */
	private resubscribe(): void {
		for (const d of this.perSourceSubs) d.dispose();
		this.perSourceSubs.length = 0;
		for (const s of this.options.listSources()) {
			this.perSourceSubs.push(s.onDidChangeStatus(() => this.emitter.fire(undefined)));
			this.perSourceSubs.push(s.onDidChangeHealth(() => this.emitter.fire(undefined)));
		}
		// Source set changed → refresh the tree once so newly-added
		// workspaces render immediately (don't wait for their first poll).
		this.emitter.fire(undefined);
	}

	dispose(): void {
		this.emitter.dispose();
		for (const d of this.perSourceSubs) d.dispose();
		for (const d of this.disposables) d.dispose();
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === "health") {
			const item = new vscode.TreeItem(healthLabel(node.state), vscode.TreeItemCollapsibleState.None);
			// Single contextValue (not per-state) so menu when-clauses
			// don't need regex/startsWith. State is conveyed by the icon
			// + label, not the contextValue.
			item.contextValue = "volt.health";
			// Color the dot to match the state — green when connected,
			// yellow when degraded, red when disconnected/unreachable,
			// neutral while probing. ThemeColor pulls from the user's
			// theme so it matches dark/light/high-contrast automatically.
			const [iconName, colorId] = healthIcon(node.state);
			item.iconPath = colorId === undefined
				? new vscode.ThemeIcon(iconName)
				: new vscode.ThemeIcon(iconName, new vscode.ThemeColor(colorId));
			item.tooltip = healthTooltip(node.state);
			// Click the health row → open the shared Volt output channel
			// so the user can see the actual error log when things are
			// red. Connected / degraded states also benefit — quick way
			// to see recent pull/push activity.
			item.command = {
				command: "volt.showOutput",
				title: "Show Volt output",
			};
			return item;
		}
		if (node.kind === "empty") {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.contextValue = "volt.empty";
			return item;
		}
		if (node.kind === "loading") {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.contextValue = "volt.loading";
			// `loading~spin` is VS Code's built-in animated spinner glyph;
			// shows a rotating ring instead of a static icon so the user
			// sees that work is in progress rather than thinking the view
			// is stuck.
			item.iconPath = new vscode.ThemeIcon("loading~spin");
			return item;
		}
		if (node.kind === "status-error") {
			// Surfaces real status failures (bridge protocol mismatch,
			// bridge offline, malformed config) instead of the misleading
			// "in sync" empty state. Click → reveal the Output channel
			// where the full stderr lives.
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.contextValue = "volt.statusError";
			item.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
			item.tooltip = node.tooltip;
			item.command = { command: "volt.showOutput", title: "Show Volt Output" };
			return item;
		}
		if (node.kind === "project-mismatch") {
			// Yellow warning: bridge reports a different project identity
			// than `.volt/config.json` recorded. Click runs
			// `volt.acceptProjectRename` which shells `volt init --force`
			// against the bound port — snapshot history is preserved.
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.contextValue = "volt.projectMismatch";
			item.iconPath = new vscode.ThemeIcon(
				"warning",
				new vscode.ThemeColor("editorWarning.foreground"),
			);
			item.tooltip = node.tooltip;
			item.command = {
				command: "volt.acceptProjectRename",
				title: "Accept new project name",
			};
			return item;
		}
		if (node.kind === "group") {
			const item = new vscode.TreeItem(
				`${node.label} (${node.count})`,
				vscode.TreeItemCollapsibleState.Expanded,
			);
			item.contextValue = `volt.group.${node.group}`;
			item.iconPath = new vscode.ThemeIcon(
				node.group === "incoming"
					? "arrow-down"
					: node.group === "outgoing"
						? "arrow-up"
						: "git-merge",
			);
			return item;
		}
		// kind === "item"
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
		item.resourceUri = node.uri;
		item.contextValue = `volt.item.${node.group}`;
		item.iconPath = new vscode.ThemeIcon(
			node.letter === "A"
				? "diff-added"
				: node.letter === "M"
					? "diff-modified"
					: "diff-removed",
		);
		item.tooltip =
			node.group === "incoming"
				? "Incoming change from IDE — click to preview"
				: node.group === "outgoing"
					? "Your local change — click to diff against last pull"
					: "Merge conflict — click to open merge editor, or right-click to pick a side";
		item.command = this.buildClickCommand(node);
		return item;
	}

	private buildClickCommand(node: Node & { kind: "item" }): vscode.Command | undefined {
		// Deleted-side rows have no diff target.
		if (node.letter === "D" && node.group === "outgoing") return undefined;
		const folder = this.options.listSources()[node.sourceIdx]!.getFolder();
		if (node.group === "merge") {
			return {
				command: "volt.merge.openEditor",
				title: "Open Merge Editor",
				arguments: [node.uri],
			};
		}
		const leftRef = node.group === "incoming" ? "BRIDGE" : "HEAD";
		const title =
			node.group === "incoming"
				? `${node.rel} (Volt: incoming from IDE)`
				: `${node.rel} (Volt: workspace vs HEAD)`;
		return {
			command: "vscode.diff",
			title: "Open Diff",
			arguments: [buildVoltUri(folder, leftRef, node.rel), node.uri, title],
		};
	}

	getChildren(node?: Node): Node[] {
		if (node === undefined) {
			// Root order: per source, a single health header. The IDE +
			// project name shown there ("Connected: CODESYS — …") already
			// tells the user which bridge they're hitting; a separate
			// "Bridge: CODESYS on :8556" row would just repeat that.
			//
			// When any source has a project-binding mismatch, a yellow
			// warning row sits between the health line and the change
			// groups — change groups still render so the engineer can
			// see what's pending before they decide to rebind.
			const result: Node[] = [];
			const sources = this.options.listSources();
			for (let i = 0; i < sources.length; i++) {
				result.push({ kind: "health", state: sources[i]!.getHealth(), sourceIdx: i });
				const mismatch = sources[i]!.getStatus()?.projectMismatch;
				if (mismatch !== undefined && mismatch !== null) {
					result.push({
						kind: "project-mismatch",
						sourceIdx: i,
						label: `Project rename detected: "${mismatch.configuredAs.plcProjectName}" → "${mismatch.bridgeReports.plcProjectName}"`,
						tooltip: formatMismatchTooltip(mismatch),
					});
				}
			}
			let totalRows = 0;
			let anySourceRefreshing = false;
			let anySourceWithoutStatus = false;
			let firstStatusError: string | undefined;
			let firstOfflineReason: string | undefined;
			for (let i = 0; i < sources.length; i++) {
				const src = sources[i]!;
				if (src.isRefreshing()) anySourceRefreshing = true;
				const s = src.getStatus();
				if (s === undefined) {
					anySourceWithoutStatus = true;
					if (firstStatusError === undefined) {
						firstStatusError = src.getStatusError();
					}
					if (firstOfflineReason === undefined && !isBridgeOnline(src.getHealth())) {
						firstOfflineReason = describeOffline(src.getHealth());
					}
					continue;
				}
				const m = s.merging?.conflicts.length ?? 0;
				const inc = changeCount(s.incoming);
				const out = changeCount(s.outgoing);
				if (m > 0) result.push({ kind: "group", label: "Merge Changes", group: "merge", sourceIdx: i, count: m });
				if (inc > 0) result.push({ kind: "group", label: "Incoming Changes", group: "incoming", sourceIdx: i, count: inc });
				if (out > 0) result.push({ kind: "group", label: "Changes", group: "outgoing", sourceIdx: i, count: out });
				totalRows += m + inc + out;
			}
			if (totalRows === 0 && sources.length > 0) {
				// Mutually-exclusive empty states, in priority order:
				//   1. refresh in flight + no status yet → "Loading…"
				//      (so we don't flash a stale offline / error message
				//       while a fresh probe is on the wire)
				//   2. bridge offline → "Bridge offline: <reason>"
				//      (the refresh deliberately skipped `volt status` —
				//       this is the honest answer, not a CLI error)
				//   3. status failed → show the actual stderr
				//   4. status succeeded with zero changes → "in sync"
				//   5. no status, no refresh, no error, no offline →
				//      "Waiting for first refresh…"
				// Order matters: (2) before (3) so that when the bridge
				// is down we don't blame the CLI; (1) before everything
				// so a fresh refresh doesn't flicker through stale states.
				if (anySourceRefreshing && anySourceWithoutStatus) {
					result.push({ kind: "loading", label: "Loading changes from IDE…" });
				} else if (firstOfflineReason !== undefined) {
					result.push({
						kind: "status-error",
						label: `Bridge offline: ${truncate(firstOfflineReason, 80)}`,
						tooltip:
							`Volt skipped \`volt status --json\` because the bridge isn't reachable.\n\n` +
							`Reason: ${firstOfflineReason}\n\n` +
							`Start your PLC IDE (TwinCAT XAE or CODESYS) and run the bridge, then refresh.\n\n` +
							`Click to open the Volt Output channel for the full log.`,
					});
				} else if (firstStatusError !== undefined) {
					result.push({
						kind: "status-error",
						label: `Status failed: ${truncate(firstStatusError, 80)}`,
						tooltip: `volt status --json exited non-zero.\n\n${firstStatusError}\n\nClick to open the Volt Output channel for the full log.`,
					});
				} else if (!anySourceWithoutStatus) {
					result.push({ kind: "empty", label: "No changes — workspace and IDE in sync" });
				} else {
					result.push({ kind: "loading", label: "Waiting for first refresh…" });
				}
			}
			return result;
		}
		if (node.kind === "group") return this.buildItemsForGroup(node);
		return [];
	}

	private buildItemsForGroup(group: Node & { kind: "group" }): Node[] {
		const source = this.options.listSources()[group.sourceIdx];
		if (source === undefined) return [];
		const status = source.getStatus();
		if (status === undefined) return [];
		const folder = source.getFolder();
		const out: Node[] = [];
		if (group.group === "merge") {
			for (const c of status.merging?.conflicts ?? []) {
				const uri = vscode.Uri.joinPath(folder.uri, c.path);
				out.push({
					kind: "item",
					label: c.path,
					uri,
					group: "merge",
					letter: "M",
					sourceIdx: group.sourceIdx,
					rel: c.path,
				});
			}
			return out;
		}
		const change = group.group === "incoming" ? status.incoming : status.outgoing;
		const triples: Array<[string[], "A" | "M" | "D"]> = [
			[change.added, "A"],
			[change.modified, "M"],
			[change.removed, "D"],
		];
		for (const [names, letter] of triples) {
			for (const name of names) {
				// Use the agent-supplied path; never guess extensions. For
				// incoming-added items the file may not exist on disk yet
				// — the diff editor's RIGHT side will render empty via the
				// content provider's missing-file handling, which is the
				// correct "new file" UX.
				const rel = status.pathByName[name];
				if (rel === undefined) continue;
				const uri = vscode.Uri.joinPath(folder.uri, rel);
				out.push({
					kind: "item",
					label: rel,
					uri,
					group: group.group,
					letter,
					sourceIdx: group.sourceIdx,
					rel,
				});
			}
		}
		return out;
	}
}

/** Map a HealthState to (codicon-name, ThemeColor id). The codicon is
 *  always a filled circle so the badge is visually consistent — only
 *  the COLOR carries the state. Returns undefined color for "probing"
 *  so the neutral icon picks up the user's theme foreground. */
function healthIcon(state: HealthState): [string, string | undefined] {
	switch (state.kind) {
		case "connected":
			return ["circle-filled", "charts.green"];
		case "degraded":
			return ["circle-filled", "charts.yellow"];
		case "disconnected":
			// Bridge is up, no IDE attached → red filled circle (bridge
			// reachable, but waiting for the IDE).
			return ["circle-filled", "charts.red"];
		case "unreachable":
			// Bridge process itself isn't responding → "plug" icon to
			// signal "not even plugged in". Different shape from the
			// filled circle so the two red states are distinguishable
			// at a glance.
			return ["plug", "charts.red"];
		case "unknown":
			return ["loading~spin", undefined];
	}
}

/** Multi-line hover tooltip with the underlying error reason or bridge
 *  metadata, so the user can self-diagnose without opening the Output
 *  panel. */
function healthTooltip(state: HealthState): string {
	switch (state.kind) {
		case "connected": {
			const h = state.health;
			return [
				"Bridge connected.",
				`IDE: ${h.ideName ?? "?"} ${h.ideVersion ?? ""}`.trim(),
				`Project: ${h.projectName ?? "(none)"} / ${h.plcProjectName ?? "(none)"}`,
				h.projectDirty === true ? "Project has unsaved IDE edits." : "",
			].filter((s) => s.length > 0).join("\n");
		}
		case "degraded":
			return `Bridge degraded — previous call failed.\nReason: ${state.health.degradedReason ?? "(unknown)"}`;
		case "disconnected":
			return "Bridge is up but no IDE is attached.\nOpen the PLC IDE with a project loaded.";
		case "unreachable":
			return `Cannot reach the bridge.\n${state.reason}\nIs the bridge process running? (it starts with your IDE)`;
		case "unknown":
			return "Probing the bridge…";
	}
}

/** Keep tree-row labels readable when the underlying error is a wall
 *  of text. The full message stays in the tooltip + Output channel. */
function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** Multi-line tooltip for the project-mismatch warning row. Lists each
 *  field that diverged, then the recovery hint. The exact same wording
 *  as the agent's stderr (`bindingMismatchMessage`) — single source of
 *  truth for the user-facing copy. */
function formatMismatchTooltip(m: ProjectMismatch): string {
	const lines = [
		"The bridge is reporting a different project identity than .volt/config.json recorded.",
		"",
	];
	for (const f of m.diffFields) {
		lines.push(`  ${f}:  "${m.configuredAs[f]}"  →  "${m.bridgeReports[f]}"`);
	}
	lines.push("");
	lines.push("Click to accept the new name (runs `volt init --force`).");
	lines.push("Snapshot history is preserved.");
	return lines.join("\n");
}
