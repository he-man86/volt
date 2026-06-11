import * as vscode from "vscode"
import { healthLabel, isBridgeOnline, type HealthState } from "../state/health.js"
import { buildUri } from "../providers/content.js"
import { changeCount, type StatusJson, type ProjectMismatch } from "../types.js"

type TreeNode =
	| { kind: "health"; state: HealthState; idx: number }
	| { kind: "group"; label: string; group: string; idx: number; count: number }
	| { kind: "item"; label: string; uri: vscode.Uri; group: string; letter: string; idx: number; rel: string; tooltip: string }
	| { kind: "empty"; label: string }
	| { kind: "loading"; label: string }
	| { kind: "error"; label: string; tooltip: string }
	| { kind: "mismatch"; label: string; tooltip: string; idx: number }

export class VoltScmTree implements vscode.TreeDataProvider<TreeNode> {
	private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>()
	readonly onDidChangeTreeData = this.emitter.event

	statuses: readonly { status: StatusJson | undefined; health: HealthState; error: string | undefined; refCount: number }[] = []

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

		// node.kind === "item"
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		item.id = `${node.group}-${node.letter}-${node.rel}`
		item.contextValue = "volt.item"
		item.description = node.letter
		item.tooltip = node.tooltip
		item.resourceUri = node.uri
		item.command = { command: "vscode.diff", title: "Show diff", arguments: [node.uri, node.uri] }
		return item
	}

	getChildren(node?: TreeNode): TreeNode[] | undefined {
		if (node !== undefined) {
			if (node.kind === "group") {
				const s = this.statuses[node.idx]
				if (s === undefined || s.status === undefined) return []
				return renderItems(s.status, node.group, node.idx)
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

			if (s.status.merging !== null) {
				nodes.push({ kind: "group", label: "Merge", group: "merge", idx, count: s.status.merging.conflicts.length })
			}

			const inc = changeCount(s.status.incoming)
			if (inc > 0) nodes.push({ kind: "group", label: "Incoming", group: "incoming", idx, count: inc })

			const out = changeCount(s.status.outgoing)
			if (out > 0) nodes.push({ kind: "group", label: "Changes", group: "outgoing", idx, count: out })

			if (inc === 0 && out === 0 && s.status.merging === null) {
				nodes.push({ kind: "empty", label: "In sync with IDE" })
			}

			return nodes
		})
	}
}

function renderItems(status: StatusJson, group: string, idx: number): TreeNode[] {
	let names: string[]
	let letter: string
	let labelPrefix: string

	if (group === "merge") {
		return (status.merging?.conflicts ?? []).map((c) => ({
			kind: "item" as const,
			label: c.path,
			uri: buildUri("", "HEAD", c.path),
			group: "merge",
			letter: "C",
			idx,
			rel: c.path,
			tooltip: `Merge conflict: ${c.kind} ${c.reason}`,
		}))
	}

	if (group === "incoming") {
		names = [...status.incoming.added, ...status.incoming.modified, ...status.incoming.removed]
		letter = "i"
		labelPrefix = ""
	} else {
		names = [...status.outgoing.added, ...status.outgoing.modified, ...status.outgoing.removed]
		letter = "o"
		labelPrefix = ""
	}

	return names.map((name) => {
		const path = status.pathByName[name] ?? name
		const isAdded = group === "incoming" ? status.incoming.added.includes(name) : status.outgoing.added.includes(name)
		const isRemoved = group === "incoming" ? status.incoming.removed.includes(name) : status.outgoing.removed.includes(name)
		const sub = isAdded ? "A" : isRemoved ? "D" : "M"
		const dir = group === "incoming" ? "incoming" : "outgoing"
		return {
			kind: "item" as const,
			label: path,
			uri: buildUri("", dir === "incoming" ? "BRIDGE" : "HEAD", path),
			group,
			letter: sub,
			idx,
			rel: path,
			tooltip: `${dir} ${sub.toLowerCase()}: ${name}`,
		}
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
