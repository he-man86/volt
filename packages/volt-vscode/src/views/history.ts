import * as vscode from "vscode"
import { spawnVolt } from "../cli.js"
import { buildUri } from "../providers/content.js"

type HistoryNode = { kind: "commit"; sha: string; date: string; summary: string; pathCount: number } | { kind: "path"; sha: string; path: string } | { kind: "empty" }

export class VoltHistoryTree implements vscode.TreeDataProvider<HistoryNode> {
	private readonly emitter = new vscode.EventEmitter<HistoryNode | undefined>()
	readonly onDidChangeTreeData = this.emitter.event

	private workspaceRoot: string
	private commits: { sha: string; date: string; summary: string; paths: string[] }[] = []

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	async refresh(): Promise<void> {
		const r = await spawnVolt(this.workspaceRoot, ["log", "--json", "--limit", "50", "--workspace", this.workspaceRoot])
		if (r.code !== 0) { this.commits = []; this.emitter.fire(undefined); return }
		try {
			const parsed = JSON.parse(r.stdout) as { sha: string; date: string; summary: string; paths: string[] }[]
			this.commits = parsed
		} catch {
			this.commits = []
		}
		this.emitter.fire(undefined)
	}

	getTreeItem(node: HistoryNode): vscode.TreeItem {
		if (node.kind === "empty") return new vscode.TreeItem("No sync history yet", vscode.TreeItemCollapsibleState.None)

		if (node.kind === "commit") {
			const item = new vscode.TreeItem(`${node.date} ${node.summary}`, node.pathCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
			item.id = node.sha
			item.contextValue = "volt.historyCommit"
			item.description = node.sha.slice(0, 8)
			item.tooltip = `${node.summary}\n${node.sha}`
			if (node.pathCount > 0) item.description += ` (${node.pathCount})`
			return item
		}

		const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None)
		item.id = `${node.sha}-${node.path}`
		item.contextValue = "volt.historyFile"
		item.resourceUri = buildUri(this.workspaceRoot, node.sha, node.path)
		item.command = { command: "vscode.diff", title: "Show historical diff", arguments: [item.resourceUri, item.resourceUri] }
		return item
	}

	getChildren(node?: HistoryNode): HistoryNode[] | undefined {
		if (node === undefined) {
			if (this.commits.length === 0) return [{ kind: "empty" }]
			return this.commits.map((c) => ({ kind: "commit", sha: c.sha, date: c.date.split("T")[0]!, summary: c.summary, pathCount: c.paths?.length ?? 0 }))
		}
		if (node.kind === "commit") {
			const commit = this.commits.find((c) => c.sha === node.sha)
			if (commit === undefined) return []
			return (commit.paths ?? []).map((p) => ({ kind: "path", sha: node.sha, path: p }))
		}
		return []
	}
}
