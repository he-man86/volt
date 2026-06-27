import * as vscode from "vscode"
import { join } from "node:path"
import { healthLabel, isBridgeOnline, type HealthState } from "@opencode-ai/volt-control"
import { buildUri } from "../providers/content.js"
import { changeCount, type StatusJson, type ProjectMismatch } from "@opencode-ai/volt-control"

type TreeNode =
	| { kind: "health"; state: HealthState; idx: number }
	| { kind: "group"; label: string; group: string; idx: number; count: number }
	| { kind: "item"; label: string; uri: vscode.Uri; group: string; letter: string; idx: number; rel: string; tooltip: string; command: vscode.Command }
	| { kind: "empty"; label: string }
	| { kind: "loading"; label: string }
	| { kind: "error"; label: string; tooltip: string }
	| { kind: "mismatch"; label: string; tooltip: string; idx: number }

export class VoltScmTree implements vscode.TreeDataProvider<TreeNode> {
	private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>()
	readonly onDidChangeTreeData = this.emitter.event

	statuses: readonly { status: StatusJson | undefined; health: HealthState; error: string | undefined; refCount: number; workspaceRoot: string }[] = []

	setSources(sources: typeof this.statuses): void {
		this.statuses = sources
		this.emitter.fire(undefined)
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
		if (node.kind === "health") {
			const item = new vscode.TreeItem(healthLabel(node.state), vscode.TreeItemCollapsibleState.None)
			item.id = `health-${node.idx}`
			item.contextValue = "volt.health"
			const [icon, color] = healthIcon(node.state)
			item.iconPath = color ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(color)) : new vscode.ThemeIcon(icon)
			item.tooltip = healthTooltip(node.state)
			return item
		}
		if (node.kind === "empty") return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		if (node.kind === "loading") return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		if (node.kind === "error") return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		if (node.kind === "mismatch") return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)

		if (node.kind === "group") {
			const item = new vscode.TreeItem(node.label, node.count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
			item.id = `${node.group}-${node.idx}`
			item.contextValue = "volt.group"
			if (node.count > 0) item.description = `${node.count}`
			return item
		}

		// node.kind === "item" — an incoming (IDE-side) or outgoing (workspace-side) changed file.
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		item.id = `${node.group}-${node.letter}-${node.rel}`
		item.contextValue = `volt.item.${node.group}`
		item.description = node.letter
		item.tooltip = node.tooltip
		item.resourceUri = node.uri
		item.command = node.command
		return item
	}

	getChildren(node?: TreeNode): TreeNode[] | undefined {
		if (node !== undefined) {
			if (node.kind === "group") {
				const s = this.statuses[node.idx]
				if (s === undefined || s.status === undefined) return []
				return renderGroup(s.status, node.idx, s.workspaceRoot, node.group === "outgoing" ? "outgoing" : "incoming")
			}
			return []
		}

		return this.statuses.flatMap((s, idx) => {
			if (s.status === undefined) {
				if (s.health.kind === "unknown") return [{ kind: "loading" as const, label: "Probing IDE..." }]
				if (s.error !== undefined) return [{ kind: "error" as const, label: `Error: ${s.error}`, tooltip: s.error }]
				return [{ kind: "empty" as const, label: "No project loaded" }]
			}

			const nodes: TreeNode[] = [{ kind: "health", state: s.health, idx }]

			if (s.status.projectMismatch !== null) {
				nodes.push({ kind: "mismatch", label: "Project mismatch", tooltip: mismatchTooltip(s.status.projectMismatch), idx })
				return nodes
			}

			// Merge in progress → defer to the editor's built-in Git merge tools (no custom resolve UI).
			if (s.status.merging !== null) {
				nodes.push({ kind: "empty", label: `Merge in progress — resolve in the editor, then Pull again (${s.status.merging.conflicts.length} conflict(s))` })
				return nodes
			}

			// Both are the IDE axis git's UI can't show — each diffs against the last-synced baseline
			// (refs/remotes/volt/ide): incoming = baseline ↔ live IDE (what pull brings), outgoing = baseline ↔
			// HEAD (what push sends). (Source Control shows working-vs-HEAD — a different, git-side axis.)
			const inc = changeCount(s.status.incoming)
			if (inc > 0) nodes.push({ kind: "group", label: "Incoming (IDE → pull)", group: "incoming", idx, count: inc })

			const out = changeCount(s.status.outgoing)
			if (out > 0) nodes.push({ kind: "group", label: "Outgoing (push → IDE)", group: "outgoing", idx, count: out })

			if (inc === 0 && out === 0) {
				nodes.push({ kind: "empty", label: "In sync with IDE" })
			}

			return nodes
		})
	}
}

function renderGroup(status: StatusJson, idx: number, workspaceRoot: string, dir: "incoming" | "outgoing"): TreeNode[] {
	// pathByName gives `src/…`; the tree path drops that prefix (src is the tree root).
	const mk = (rawPath: string): { treePath: string; onDisk: vscode.Uri } => {
		const treePath = rawPath.startsWith("src/") ? rawPath.slice(4) : rawPath
		return { treePath, onDisk: vscode.Uri.file(join(workspaceRoot, "src", treePath)) }
	}

	const cs = dir === "incoming" ? status.incoming : status.outgoing
	const names = [...cs.added, ...cs.modified, ...cs.removed]

	return names.map((name) => {
		const { treePath, onDisk } = mk(status.pathByName[name] ?? name)
		const sub = cs.added.includes(name) ? "A" : cs.removed.includes(name) ? "D" : "M"
		// Both diff the last-synced baseline (VOLTIDE = refs/remotes/volt/ide):
		//   incoming → baseline ↔ BRIDGE (what a pull brings in)
		//   outgoing → baseline ↔ HEAD   (what a push sends to the IDE)
		const [right, verb] = dir === "incoming" ? (["BRIDGE", "incoming (IDE)"] as const) : (["HEAD", "outgoing (push)"] as const)
		const command: vscode.Command = {
			command: "vscode.diff",
			title: "Diff",
			arguments: [buildUri(workspaceRoot, "VOLTIDE", treePath), buildUri(workspaceRoot, right, treePath), `${name} — ${verb}`],
		}
		return { kind: "item" as const, label: treePath, uri: onDisk, group: dir, letter: sub, idx, rel: treePath, tooltip: `${verb} ${sub.toLowerCase()}: ${name}`, command }
	})
}

function healthIcon(state: HealthState): [string, string | undefined] {
	switch (state.kind) {
		case "connected": return ["check", "charts.green"]
		case "degraded": return ["warning", "charts.yellow"]
		case "disconnected": return ["circle-slash", "charts.red"]
		case "unreachable": return ["circle-slash", "charts.red"]
		default: return ["circle-outline", undefined]
	}
}

function healthTooltip(state: HealthState): string {
	switch (state.kind) {
		case "connected": return `Connected to ${state.health.ideName ?? "IDE"} ${state.health.ideVersion ?? ""}`
		case "degraded": return `Degraded — ${state.health.degradedReason ?? "previous call failed"}`
		case "disconnected": return "PLC IDE is running but no project is loaded"
		case "unreachable": return `Cannot reach bridge — ${state.reason}`
		default: return "Probing IDE connection..."
	}
}

function mismatchTooltip(m: ProjectMismatch): string {
	return `Expected: ${m.configuredAs.platform}/${m.configuredAs.projectName}/${m.configuredAs.plcProjectName}\nActual: ${m.bridgeReports.platform}/${m.bridgeReports.projectName}/${m.bridgeReports.plcProjectName}`
}
