import * as vscode from "vscode"
import { basename, join } from "node:path"
import { buildUri } from "../providers/content.js"
import { healthDisplay, isPouFile, readBridgePort, type StatusJson } from "@opencode-ai/volt-control"
import type { VoltStatus } from "../state/status.js"

// The dedicated Volt activity-bar area. Four native tree views over one lightweight node model:
//   IDE Sync    — incoming/outgoing drift, click-to-diff vs the last-synced baseline (was the SCM group)
//   Diagnostics — a summary + per-file counts sourced from the LSP's published diagnostics; jumps to Problems
//   Bridge      — connection health / project / port (was status-bar only)
//   Reference   — Agent + language-reference launchers (were palette-only)
// The git axis stays the editor's built-in Git; Volt owns only the IDE axis, now in its own area.

const SOURCE = "volt-lsp-iec" // the LSP tags its diagnostics with this — the precise Volt filter

interface VoltNode {
	key: string
	label: string
	description?: string
	tooltip?: string
	icon?: vscode.ThemeIcon
	command?: vscode.Command
	contextValue?: string
	resourceUri?: vscode.Uri
	collapsed?: vscode.TreeItemCollapsibleState
	children?: VoltNode[]
}

class TreeProvider implements vscode.TreeDataProvider<VoltNode> {
	private roots: VoltNode[] = []
	private readonly emitter = new vscode.EventEmitter<void>()
	readonly onDidChangeTreeData = this.emitter.event

	setRoots(nodes: VoltNode[]): void {
		this.roots = nodes
		this.emitter.fire()
	}

	getChildren(node?: VoltNode): VoltNode[] {
		return node === undefined ? this.roots : (node.children ?? [])
	}

	getTreeItem(node: VoltNode): vscode.TreeItem {
		const hasKids = node.children !== undefined && node.children.length > 0
		const collapsed = node.collapsed ?? (hasKids ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
		const item = new vscode.TreeItem(node.label, collapsed)
		item.id = node.key
		item.description = node.description
		item.tooltip = node.tooltip
		item.iconPath = node.icon
		item.command = node.command
		item.contextValue = node.contextValue
		if (node.resourceUri !== undefined) item.resourceUri = node.resourceUri
		return item
	}

	dispose(): void {
		this.emitter.dispose()
	}
}

export class VoltViews implements vscode.Disposable {
	private readonly sync = new TreeProvider()
	private readonly diagnostics = new TreeProvider()
	private readonly bridge = new TreeProvider()
	private readonly reference = new TreeProvider()
	private readonly disposables: vscode.Disposable[] = []

	constructor() {
		this.disposables.push(
			this.sync,
			this.diagnostics,
			this.bridge,
			this.reference,
			vscode.window.registerTreeDataProvider("volt.views.sync", this.sync),
			vscode.window.registerTreeDataProvider("volt.views.diagnostics", this.diagnostics),
			vscode.window.registerTreeDataProvider("volt.views.bridge", this.bridge),
			vscode.window.registerTreeDataProvider("volt.views.reference", this.reference),
			// The Problems panel is the source of truth; the summary just jumps to it (filtered to Volt).
			vscode.commands.registerCommand("volt.openProblems", () => {
				void vscode.commands.executeCommand("workbench.actions.view.problems")
				void vscode.commands.executeCommand("workbench.action.problems.focus")
			}),
			// LSP diagnostics change independently of sync status — refresh the summary on their own event.
			vscode.languages.onDidChangeDiagnostics(() => this.refreshDiagnostics()),
		)
		this.reference.setRoots(referenceNodes())
		this.refreshDiagnostics()
	}

	/** Re-render the sync + bridge views from all bound workspaces (called on any status change). */
	update(statuses: ReadonlyMap<string, VoltStatus>): void {
		this.sync.setRoots(syncRoots(statuses))
		this.bridge.setRoots(bridgeRoots(statuses))
	}

	refreshDiagnostics(): void {
		this.diagnostics.setRoots(diagnosticRoots())
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose()
	}
}

// ── IDE Sync ─────────────────────────────────────────────────────────────────
function syncRoots(statuses: ReadonlyMap<string, VoltStatus>): VoltNode[] {
	// Not initialized → return nothing so the viewsWelcome (Set Up Workspace / init buttons) renders.
	if (statuses.size === 0) return []

	const incoming: VoltNode[] = []
	const outgoing: VoltNode[] = []
	let paused = false
	for (const s of statuses.values()) {
		const st = s.cached
		if (st === undefined) continue
		// While merging or on a project mismatch the IDE axis is paused — the bridge view explains why.
		if (st.projectMismatch !== null || st.merging !== null) { paused = true; continue }
		incoming.push(...itemNodes(st, s.workspaceRoot, "incoming"))
		outgoing.push(...itemNodes(st, s.workspaceRoot, "outgoing"))
	}
	if (incoming.length === 0 && outgoing.length === 0) {
		return paused
			? [{ key: "sync:paused", label: "IDE sync paused — resolve in the Bridge view", icon: new vscode.ThemeIcon("warning") }]
			: [{ key: "sync:insync", label: "In sync with the IDE", icon: new vscode.ThemeIcon("check") }]
	}
	return [
		group("incoming", "Incoming (IDE → pull)", incoming),
		group("outgoing", "Outgoing (push → IDE)", outgoing),
	]
}

function group(dir: string, label: string, children: VoltNode[]): VoltNode {
	return {
		key: `group:${dir}`,
		label,
		description: String(children.length),
		children,
		collapsed: children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
	}
}

function itemNodes(status: StatusJson, workspaceRoot: string, dir: "incoming" | "outgoing"): VoltNode[] {
	const cs = dir === "incoming" ? status.incoming : status.outgoing
	const names = [...cs.added, ...cs.modified, ...cs.removed]
	return names.map((name) => {
		// pathByName gives `src/…`; src is the tree root, so the on-disk path drops it.
		const rawPath = status.pathByName[name] ?? name
		const treePath = rawPath.startsWith("src/") ? rawPath.slice(4) : rawPath
		const onDisk = vscode.Uri.file(join(workspaceRoot, "src", treePath))
		const sub = cs.added.includes(name) ? "A" : cs.removed.includes(name) ? "D" : "M"
		// Both diff against the last-synced baseline (VOLTIDE = refs/remotes/volt/ide):
		//   incoming → VOLTIDE ↔ BRIDGE    (the live IDE — what a pull brings in)
		//   outgoing → VOLTIDE ↔ WORKSPACE (your working file — reflects uncommitted edits)
		const rightRef = dir === "incoming" ? "BRIDGE" : "WORKSPACE"
		const verb = dir === "incoming" ? "incoming (IDE)" : "outgoing (push)"
		return {
			key: `${dir}:${workspaceRoot}:${name}`,
			label: name,
			description: sub,
			resourceUri: onDisk,
			tooltip: `${verb} ${sub.toLowerCase()}: ${name}`,
			contextValue: `volt:${dir}`,
			command: {
				command: "vscode.diff",
				title: "Diff",
				arguments: [buildUri(workspaceRoot, "VOLTIDE", treePath), buildUri(workspaceRoot, rightRef, treePath), `${name} — ${verb}`],
			},
		}
	})
}

// ── Diagnostics summary (jumps to the native Problems panel) ──────────────────
function diagnosticRoots(): VoltNode[] {
	let errors = 0
	let warnings = 0
	const perFile: { uri: vscode.Uri; e: number; w: number }[] = []

	for (const [uri, diags] of vscode.languages.getDiagnostics()) {
		if (!isPouFile(uri.fsPath)) continue
		let e = 0
		let w = 0
		for (const d of diags) {
			if (d.source !== undefined && d.source !== SOURCE) continue
			if (d.severity === vscode.DiagnosticSeverity.Error) e++
			else if (d.severity === vscode.DiagnosticSeverity.Warning) w++
		}
		if (e + w === 0) continue
		errors += e
		warnings += w
		perFile.push({ uri, e, w })
	}

	const openProblems: vscode.Command = { command: "volt.openProblems", title: "Open Problems" }
	if (errors + warnings === 0) {
		return [{ key: "diag:none", label: "No problems", icon: new vscode.ThemeIcon("check"), command: openProblems }]
	}

	return [
		{
			key: "diag:summary",
			label: `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`,
			icon: new vscode.ThemeIcon(errors > 0 ? "error" : "warning"),
			tooltip: "Open the Problems panel",
			command: openProblems,
			collapsed: vscode.TreeItemCollapsibleState.Expanded,
			children: perFile.map(({ uri, e, w }) => ({
				key: `diag:${uri.fsPath}`,
				label: basename(uri.fsPath),
				description: [e > 0 ? `${e}⛔` : "", w > 0 ? `${w}⚠` : ""].filter(Boolean).join(" "),
				resourceUri: uri,
				command: { command: "vscode.open", title: "Open", arguments: [uri] },
			})),
		},
	]
}

// ── Bridge status ─────────────────────────────────────────────────────────────
function bridgeRoots(statuses: ReadonlyMap<string, VoltStatus>): VoltNode[] {
	const nodes: VoltNode[] = []
	for (const s of statuses.values()) {
		const hd = healthDisplay(s.health)
		const icon = hd.tone === "ok" ? "pass" : hd.tone === "error" ? "error" : "warning"
		nodes.push({ key: `bridge:${s.workspaceRoot}`, label: hd.label, icon: new vscode.ThemeIcon(icon), tooltip: s.workspaceRoot })

		const port = readBridgePort(s.workspaceRoot)
		if (port !== undefined) nodes.push({ key: `port:${s.workspaceRoot}`, label: `Port ${port}`, icon: new vscode.ThemeIcon("plug") })

		if (!hd.online)
			nodes.push({ key: `start:${s.workspaceRoot}`, label: "Start bridge", icon: new vscode.ThemeIcon("debug-start"), command: { command: "volt.startBridge", title: "Start Bridge" } })
		if (s.cached?.projectMismatch != null)
			nodes.push({ key: `rename:${s.workspaceRoot}`, label: "Accept project rename", icon: new vscode.ThemeIcon("warning"), command: { command: "volt.acceptProjectRename", title: "Accept Rename" } })
	}
	return nodes.length > 0 ? nodes : [{ key: "bridge:none", label: "No workspace bound", icon: new vscode.ThemeIcon("circle-slash") }]
}

// ── Reference & Agent (static launchers) ─────────────────────────────────────
function referenceNodes(): VoltNode[] {
	const item = (key: string, label: string, command: string, icon: string): VoltNode => ({
		key,
		label,
		icon: new vscode.ThemeIcon(icon),
		command: { command, title: label },
	})
	return [
		item("agent", "Open Agent", "volt.openAgent", "comment-discussion"),
		item("newSession", "New Agent Session", "volt.newAgentSession", "add"),
		item("reference", "Open Language Reference", "volt.openReference", "book"),
		item("settings", "Open Settings", "volt.openSettings", "settings-gear"),
		item("config", "Open Workspace Config", "volt.openConfig", "gear"),
	]
}
