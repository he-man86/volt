/**
 * Activity-bar TreeView for Volt's IDE sync history.
 *
 * Data source: `volt log --json` — walks `.volt/snapshot/`'s commit
 * chain and returns one entry per pull (each `volt pull` advances
 * the snapshot's refs/heads/main with a new commit whose tree
 * mirrors the IDE state at that moment). The "history" is therefore
 * a chronological record of "what the engineer did in the IDE",
 * NOT a record of the user's own workspace edits. Labeling
 * matters — this view is "Sync history", separate from the user's
 * own git history (which lives in VS Code's standard Source Control).
 *
 * UX:
 *   • Top-level rows = commits, newest first, labeled `<time>  <subject>`.
 *   • Expanding a commit shows the files changed in that pull.
 *   • Clicking a file → opens a diff between that commit's version
 *     and the live workspace file. (Past version of the file vs what
 *     the user has now.)
 *
 * Lazy + cheap: `volt log --json --limit 50` returns in ~5-20ms
 * locally (it's just a git log walk; no bridge involved). The view
 * refreshes on `onDidChangeStatus` from any workspace (signaling
 * "things may have changed" after a pull or push).
 */
import * as vscode from "vscode";
import { cliBin, spawnCapture } from "./cli.js";
import { buildVoltUri } from "./scm-content-provider.js";
import type { StatusSource } from "./volt-tree.js";

interface CommitEntry {
	sha: string;
	shaShort: string;
	timestampSec: number;
	subject: string;
	paths: string[];
}

interface LogJson {
	commits: CommitEntry[];
}

export interface VoltHistoryProviderOptions {
	listSources: () => readonly StatusSource[];
	onSourcesChanged: vscode.Event<void>;
	/** How many commits to fetch per source. Defaults to 50. */
	limit?: number;
}

type Node =
	| { kind: "commit"; sourceIdx: number; entry: CommitEntry }
	| { kind: "file"; sourceIdx: number; entry: CommitEntry; path: string }
	| { kind: "empty"; label: string };

export class VoltHistoryProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;
	private readonly options: VoltHistoryProviderOptions;
	private readonly limit: number;
	private readonly disposables: vscode.Disposable[] = [];
	private perSourceSubs: vscode.Disposable[] = [];
	/** Per-source cached log. Keyed by folder fsPath; invalidated on status change. */
	private logCache = new Map<string, CommitEntry[]>();

	constructor(options: VoltHistoryProviderOptions) {
		this.options = options;
		this.limit = options.limit ?? 50;
		this.resubscribe();
		this.disposables.push(options.onSourcesChanged(() => this.resubscribe()));
	}

	private resubscribe(): void {
		for (const d of this.perSourceSubs) d.dispose();
		this.perSourceSubs = [];
		for (const s of this.options.listSources()) {
			this.perSourceSubs.push(
				s.onDidChangeStatus(() => {
					// Invalidate this source's cached log — next render will
					// re-shell `volt log`.
					this.logCache.delete(s.getFolder().uri.fsPath);
					this.emitter.fire(undefined);
				}),
			);
		}
		this.emitter.fire(undefined);
	}

	dispose(): void {
		this.emitter.dispose();
		for (const d of this.perSourceSubs) d.dispose();
		for (const d of this.disposables) d.dispose();
	}

	getTreeItem(node: Node): vscode.TreeItem {
		if (node.kind === "empty") {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon("history");
			return item;
		}
		if (node.kind === "commit") {
			const date = new Date(node.entry.timestampSec * 1000);
			const label = formatTimestamp(date);
			const item = new vscode.TreeItem(
				label,
				node.entry.paths.length > 0
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None,
			);
			item.description = `${node.entry.shaShort}  ${node.entry.subject}`;
			item.tooltip = `${date.toLocaleString()} — ${node.entry.subject}\n${node.entry.paths.length} file(s) changed`;
			item.iconPath = new vscode.ThemeIcon("git-commit");
			item.contextValue = "volt.history.commit";
			return item;
		}
		// kind === "file"
		const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon("file");
		item.tooltip = `Diff ${node.path} at ${node.entry.shaShort} against the live workspace`;
		const folder = this.options.listSources()[node.sourceIdx]?.getFolder();
		if (folder !== undefined) {
			const left = buildVoltUri(folder, node.entry.sha, node.path);
			const right = vscode.Uri.joinPath(folder.uri, node.path);
			item.command = {
				command: "vscode.diff",
				title: "Diff at this pull",
				arguments: [left, right, `${node.path} @ ${node.entry.shaShort} ↔ workspace`],
			};
		}
		item.resourceUri = vscode.Uri.parse(`volt-history:/${node.entry.sha}/${node.path}`);
		item.contextValue = "volt.history.file";
		return item;
	}

	async getChildren(node?: Node): Promise<Node[]> {
		if (node === undefined) {
			// Root — load (or use cached) log per source.
			const sources = this.options.listSources();
			if (sources.length === 0) {
				return [{ kind: "empty", label: "No Volt workspace bound — run `volt init` first" }];
			}
			const out: Node[] = [];
			for (let i = 0; i < sources.length; i++) {
				const src = sources[i]!;
				const folderPath = src.getFolder().uri.fsPath;
				let entries = this.logCache.get(folderPath);
				if (entries === undefined) {
					entries = await this.loadLog(folderPath);
					this.logCache.set(folderPath, entries);
				}
				for (const e of entries) out.push({ kind: "commit", sourceIdx: i, entry: e });
			}
			if (out.length === 0) {
				return [{ kind: "empty", label: "No sync history yet — run `volt pull` to populate" }];
			}
			return out;
		}
		if (node.kind === "commit") {
			return node.entry.paths.map((p) => ({
				kind: "file",
				sourceIdx: node.sourceIdx,
				entry: node.entry,
				path: p,
			}));
		}
		return [];
	}

	private async loadLog(folderPath: string): Promise<CommitEntry[]> {
		try {
			const result = await spawnCapture(
				cliBin(),
				["log", "--json", `--limit=${this.limit}`],
				folderPath,
			);
			if (result.code !== 0) return [];
			const parsed = JSON.parse(result.stdout) as LogJson;
			return Array.isArray(parsed.commits) ? parsed.commits : [];
		} catch {
			return [];
		}
	}
}

/**
 * Format a timestamp for the commit row label. Relative phrasing for
 * recent entries (more scannable in a list), absolute for older ones.
 * Mirrors how GitHub renders commit times.
 */
function formatTimestamp(date: Date): string {
	const nowMs = Date.now();
	const ageMs = nowMs - date.getTime();
	const min = 60_000;
	const hour = 60 * min;
	const day = 24 * hour;
	if (ageMs < min) return "just now";
	if (ageMs < hour) return `${Math.floor(ageMs / min)} min ago`;
	if (ageMs < day) return `${Math.floor(ageMs / hour)} hr ago`;
	if (ageMs < 7 * day) return `${Math.floor(ageMs / day)} days ago`;
	// Older: absolute date.
	return date.toISOString().slice(0, 10);
}
