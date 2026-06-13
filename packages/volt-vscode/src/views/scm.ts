import * as vscode from "vscode"
import { join } from "node:path"
import { healthLabel, isBridgeOnline, type HealthState } from "../state/health.js"
import { buildUri } from "../providers/content.js"
import { changeCount, type StatusJson, type ProjectMismatch } from "../types.js"

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

		// node.kind === "item"
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
		item.id = `${node.group}-${node.letter}-${node.rel}`
		// Per-group contextValue so the inline menus (use-mine/theirs on conflicts,
		// discard on outgoing) match their `viewItem ==` when-clauses.
		item.contextValue =
			node.group === "merge" ? "volt.item.merge"
			: node.group === "outgoing" ? "volt.item.outgoing"
			: "volt.item.incoming"
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
				return renderItems(s.status, node.group, node.idx, s.workspaceRoot)
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

function renderItems(status: StatusJson, group: string, idx: number, workspaceRoot: string): TreeNode[] {
	// Snapshot-tree paths have no `src/` prefix (src is the tree root) — incoming/
	// outgoing come through pathByName as `src/…`, merge conflicts come tree-relative.
	// Normalize to the tree path (for `volt show`) + the on-disk file uri.
	const mk = (rawPath: string): { treePath: string; onDisk: vscode.Uri } => {
		const treePath = rawPath.startsWith("src/") ? rawPath.slice(4) : rawPath
		return { treePath, onDisk: vscode.Uri.file(join(workspaceRoot, "src", treePath)) }
	}

	if (group === "merge") {
		return (status.merging?.conflicts ?? []).map((c) => {
			const { treePath, onDisk } = mk(c.path)
			return {
				kind: "item" as const,
				label: treePath,
				uri: onDisk,
				group: "merge",
				letter: "C",
				idx,
				rel: treePath,
				tooltip: `Merge conflict: ${c.kind} ${c.reason}`,
				command: { command: "volt.merge.openEditor", title: "Resolve", arguments: [{ rel: treePath }] },
			}
		})
	}

	const dir = group === "incoming" ? "incoming" : "outgoing"
	const cs = dir === "incoming" ? status.incoming : status.outgoing
	const names = [...cs.added, ...cs.modified, ...cs.removed]

	return names.map((name) => {
		const { treePath, onDisk } = mk(status.pathByName[name] ?? name)
		const sub = cs.added.includes(name) ? "A" : cs.removed.includes(name) ? "D" : "M"
		const head = buildUri(workspaceRoot, "HEAD", treePath)
		// incoming: HEAD (last synced) ↔ BRIDGE (live IDE) — what a pull would bring.
		// outgoing: HEAD (last synced) ↔ your on-disk file — what a push would send.
		const command: vscode.Command =
			dir === "incoming"
				? { command: "vscode.diff", title: "Diff", arguments: [head, buildUri(workspaceRoot, "BRIDGE", treePath), `${name} — incoming (IDE)`] }
				: { command: "vscode.diff", title: "Diff", arguments: [head, onDisk, `${name} — outgoing (yours)`] }
		return {
			kind: "item" as const,
			label: treePath,
			uri: onDisk,
			group,
			letter: sub,
			idx,
			rel: treePath,
			tooltip: `${dir} ${sub.toLowerCase()}: ${name}`,
			command,
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
