import * as vscode from "vscode"
import { basename, join } from "node:path"
import { buildUri } from "./content.js"
import { projectWorkspace, isPouFile, readBridgeVendor, vendorLabel, onboardingMode, type DetectedProject, type DriftItem, type ConflictItem, type WorkspaceView, type VoltStatus } from "@volt/control"

// The one place the extension turns a tracker into the shared view-model; every panel row renders from this.
function viewOf(s: VoltStatus): WorkspaceView {
	return projectWorkspace({ workspaceRoot: s.workspaceRoot, status: s.cached, health: s.health, statusError: s.statusError, vendor: readBridgeVendor(s.workspaceRoot) })
}

// The dedicated Volt activity-bar area. Four native tree views over one lightweight node model:
//   IDE Sync    — incoming/outgoing drift, click-to-diff vs the last-synced baseline (was the SCM group)
//   Diagnostics — a summary + per-file counts sourced from the LSP's published diagnostics; jumps to Problems
//   Bridge      — the WHOLE connection lifecycle: which project, initialize, connect, disconnect
//   Agent & Settings — the three launchers worth a click; everything else stays in the palette
//
// The Sync/Bridge split is the load-bearing one: **Sync answers "what changed", Bridge answers "am I attached to
// an IDE".** Init/Connect/Disconnect used to live in Sync's welcome markdown, which meant the connection state was
// described in two places and (worse) static markdown can't name the project it would bind. Every connection
// affordance now lives here as a real row, and Sync's welcomes just point down.
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
	/** Carried on a `volt:conflict` row so the take-a-side commands know which file, in which workspace, to resolve. */
	merge?: { workspaceRoot: string; relPath: string }
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
	// Kept so the Bridge view can re-render when EITHER the bound statuses OR the connector's detected-project
	// list changes (they arrive on separate events — status refresh vs the 10s bridge poll).
	private lastViews: WorkspaceView[] = []
	private detected: DetectedProject[] = []
	private connectorUp = true

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
		// Project each workspace ONCE (viewOf reads .git/volt/config.json); the sync + bridge views share it.
		const views = [...statuses.values()].map(viewOf)
		this.lastViews = views
		this.sync.setRoots(syncRoots(views))
		this.bridge.setRoots(bridgeRoots(views, this.detected, this.connectorUp))
	}

	/** The connector's detected-project list + whether the connector answered at all (unbound onboarding). Names
	 *  the projects in the Bridge view so the user sees WHICH one "Initialize" will bind, and tells "connector
	 *  down" apart from "connector up, no project open" — two states that used to look identical. */
	setDetected(projects: DetectedProject[], connectorUp: boolean): void {
		this.detected = projects
		this.connectorUp = connectorUp
		this.bridge.setRoots(bridgeRoots(this.lastViews, this.detected, this.connectorUp))
	}

	refreshDiagnostics(): void {
		this.diagnostics.setRoots(diagnosticRoots())
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose()
	}
}

// ── IDE Sync ─────────────────────────────────────────────────────────────────
// Exported for the panel smoke test (pure view-model builder).
export function syncRoots(views: WorkspaceView[]): VoltNode[] {
	// Not initialized → return nothing so the viewsWelcome (Set Up Workspace / init buttons) renders.
	if (views.length === 0) return []

	const incoming: VoltNode[] = []
	const outgoing: VoltNode[] = []
	const merges: VoltNode[] = []
	let mismatchPaused = false
	let anythingToShow = false // stays false only when EVERY bound workspace is offline → yield to the Connect welcome
	// One switch on the shared `mode` (the desktop switches on the same field) so the two frontends can't drift.
	for (const v of views) {
		switch (v.mode) {
			case "merging": // actionable IN the tree — resolve each file, then Finish
				merges.push(mergeNode(v.workspaceRoot, v.conflicts))
				anythingToShow = true
				break
			case "mismatch":
				mismatchPaused = true
				anythingToShow = true
				break
			case "offline": // stay silent so the "Disconnected — Connect" welcome renders (Bridge view carries health)
			case "uninitialized": // can't occur for a bound workspace, but the switch stays exhaustive
				break
			case "ready":
				anythingToShow = true
				incoming.push(...v.incoming.map((it) => itemNode(it, v.workspaceRoot, "incoming")))
				outgoing.push(...v.outgoing.map((it) => itemNode(it, v.workspaceRoot, "outgoing")))
				break
		}
	}
	if (!anythingToShow) return [] // all bound workspaces offline → viewsWelcome shows the Connect button
	// Merge subtree(s) render ALONGSIDE other workspaces' drift — a merge in one folder must not hide another's.
	const roots: VoltNode[] = [...merges]
	if (incoming.length > 0 || outgoing.length > 0) {
		roots.push(group("incoming", "Incoming (IDE → pull)", incoming), group("outgoing", "Outgoing (push → IDE)", outgoing))
	} else if (merges.length === 0) {
		roots.push(
			mismatchPaused
				? { key: "sync:paused", label: "IDE sync paused — resolve in the Bridge view", icon: new vscode.ThemeIcon("warning") }
				: { key: "sync:insync", label: "In sync with the IDE", icon: new vscode.ThemeIcon("check") },
		)
	}
	return roots
}

// A merge-in-progress subtree: one row per conflicted file (click to open; take-a-side from the context menu),
// under a header whose inline buttons are Finish/Abort (contributed for `viewItem == volt:merge`).
function mergeNode(workspaceRoot: string, conflicts: ConflictItem[]): VoltNode {
	return {
		key: `merge:${workspaceRoot}`,
		label: `Merge in progress — ${conflicts.length} conflict(s)`,
		description: "resolve each, then Finish Merge",
		icon: new vscode.ThemeIcon("git-merge"),
		contextValue: "volt:merge",
		collapsed: vscode.TreeItemCollapsibleState.Expanded,
		children: conflicts.map((c) => conflictNode(workspaceRoot, c)),
	}
}

function conflictNode(workspaceRoot: string, c: ConflictItem): VoltNode {
	const onDisk = vscode.Uri.file(join(workspaceRoot, "src", c.relPath))
	const folder = c.relPath.includes("/") ? c.relPath.slice(0, c.relPath.lastIndexOf("/")) : undefined
	return {
		key: `conflict:${workspaceRoot}:${c.relPath}`,
		label: c.name,
		description: folder,
		tooltip: `merge conflict: ${c.relPath} — open to resolve, or take a whole side (IDE / mine) from the context menu`,
		resourceUri: onDisk,
		contextValue: "volt:conflict",
		icon: new vscode.ThemeIcon("warning"),
		merge: { workspaceRoot, relPath: c.relPath },
		command: { command: "vscode.open", title: "Open", arguments: [onDisk] },
	}
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

// The item's name/sub/relPath come from the shared projection; only the VS Code widget + diff command
// (the editor API) are built here.
function itemNode(it: DriftItem, workspaceRoot: string, dir: "incoming" | "outgoing"): VoltNode {
	const onDisk = vscode.Uri.file(join(workspaceRoot, "src", it.relPath))
	// incoming → HEAD ↔ BRIDGE    (your repo's last commit vs the live IDE — what a pull brings in).
	//   NOT VOLTIDE: refs/remotes/volt/ide IS the IDE modelled as a remote-tracking branch, so after any pull it
	//   already equals BRIDGE — the diff would show two identical panes. HEAD is the user's actual local repo.
	// outgoing → VOLTIDE ↔ WORKSPACE (last-synced IDE baseline vs your working file — what a push sends).
	const leftRef = dir === "incoming" ? "HEAD" : "VOLTIDE"
	const rightRef = dir === "incoming" ? "BRIDGE" : "WORKSPACE"
	const verb = dir === "incoming" ? "incoming (IDE)" : "outgoing (push)"
	return {
		key: `${dir}:${workspaceRoot}:${it.name}`,
		label: it.name,
		description: it.sub,
		resourceUri: onDisk,
		tooltip: `${verb} ${it.sub.toLowerCase()}: ${it.name}`,
		contextValue: `volt:${dir}`,
		command: {
			command: "vscode.diff",
			title: "Diff",
			arguments: [buildUri(workspaceRoot, leftRef, it.relPath), buildUri(workspaceRoot, rightRef, it.relPath), `${it.name} — ${verb}`],
		},
	}
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

// ── Bridge: the connection lifecycle, start to finish ────────────────────────
// Exported for the panel smoke test (the view-model builder is pure; only the widget layer needs the host).
export function bridgeRoots(views: WorkspaceView[], detected: DetectedProject[], connectorUp = true): VoltNode[] {
	const nodes: VoltNode[] = []
	for (const v of views) {
		const hd = v.health
		const aff = v.affordance
		// Row 1 answers the only question that matters at a glance — connected, and to WHAT. The label already
		// reads "<IDE> — <project>" when live, so state goes in the description rather than repeating the name.
		nodes.push({
			key: `bridge:${v.workspaceRoot}`,
			label: hd.label,
			description: aff.caption,
			icon: new vscode.ThemeIcon(hd.tone === "ok" ? "pass-filled" : hd.tone === "error" ? "error" : "warning"),
			tooltip: `${hd.online ? "Syncing with this IDE project." : "Not syncing — pull and push are unavailable."}\n${v.workspaceRoot}`,
		})

		// The vendor row only earns its place when the health label CAN'T name the IDE (offline, where the label is
		// an error string). Connected, a second row reading just "CODESYS" said the same word twice.
		if (aff.showVendorRow && v.vendor !== undefined)
			nodes.push({
				key: `vendor:${v.workspaceRoot}`,
				label: vendorLabel(v.vendor),
				description: "bound platform",
				icon: new vscode.ThemeIcon("plug"),
			})

		// Exactly ONE action — Connect, Disconnect, or Accept-Rename, never stacked. `affordance` decides which (a
		// mismatch OUTRANKS connect/disconnect: sync is paused until it's accepted, so offering them there answers a
		// question the user didn't ask — the shared decision both shells now render identically).
		if (aff.action === "connect")
			nodes.push({
				key: `reconnect:${v.workspaceRoot}`,
				label: "Connect to the IDE",
				description: "resume syncing",
				tooltip: "Re-point the bridge at this workspace's project and resume syncing. Needs the project open in its IDE.",
				icon: new vscode.ThemeIcon("plug"),
				command: { command: "volt.connect", title: "Connect" },
			})
		else if (aff.action === "disconnect")
			nodes.push({
				key: `disconnect:${v.workspaceRoot}`,
				label: "Disconnect from the IDE",
				description: "pause syncing",
				tooltip: "Stop syncing with the IDE. The IDE stays open and loaded — connect again here to resume.",
				icon: new vscode.ThemeIcon("debug-disconnect"),
				command: { command: "volt.disconnect", title: "Disconnect" },
			})
		else
			nodes.push({
				key: `rename:${v.workspaceRoot}`,
				label: "Accept project rename",
				description: "sync paused",
				tooltip: "The IDE's project name no longer matches this workspace's binding. Accept it to resume syncing.",
				icon: new vscode.ThemeIcon("warning"),
				command: { command: "volt.acceptProjectRename", title: "Accept Rename" },
			})
	}
	if (nodes.length > 0) return nodes

	// ── Unbound: the onboarding ladder. The STATE is decided in @volt/control (onboardingMode) so the desktop
	// answers identically; only the rows are ours. Rows, not welcome markdown, precisely so the detected project
	// can be NAMED — the whole reason this view leads the container.
	switch (onboardingMode(connectorUp, detected.length)) {
		case "no-connector":
			return [
				{
					key: "bridge:noconnector",
					label: "The Volt Connector isn't running",
					description: "start Volt",
					tooltip: "Start Volt from the Start menu. Its tray connector finds your open PLC projects and serves the bridge — they then appear here to set up.",
					icon: new vscode.ThemeIcon("circle-slash"),
				},
			]
		case "choose-project":
			// An INDENTED list: a plain header (not clickable — clicking it used to fire volt.init and pop the
			// project-picker QuickPick, which read like the command palette and confused users) with the detected
			// projects NESTED under it. Each child is a clickable row that says "click to set up" and sets ITSELF up.
			return [
				{
					key: "bridge:pick",
					label: detected.length === 1 ? "Detected project" : "Detected projects",
					icon: new vscode.ThemeIcon("list-tree"),
					collapsed: vscode.TreeItemCollapsibleState.Expanded,
					children: detected.map(detectedNode),
				},
			]
		case "no-project":
			return [
				{
					key: "bridge:none",
					label: "No PLC project detected",
					description: "open one in your IDE",
					tooltip: "Open a project in TwinCAT, or activate Volt in CODESYS from the Volt Connector (tray) — it then appears here to set up.",
					icon: new vscode.ThemeIcon("circle-slash"),
				},
			]
	}
}

function detectedNode(p: DetectedProject): VoltNode {
	const platform = p.ideVersion != null && p.ideVersion !== "" ? `${vendorLabel(p.vendor)} · ${p.ideVersion}` : vendorLabel(p.vendor)
	return {
		key: `detected:${p.id}`,
		label: p.displayName,
		// "click to set up" sits right after the name, on the row that actually does it. Fires volt.initProject with
		// THIS project, so clicking sets up exactly what you clicked — no project-picker QuickPick to re-choose it.
		description: `— click to set up · ${platform}`,
		tooltip: `Set this folder up to sync with "${p.displayName}" (${platform}).\nCreates the git workspace and pulls the project's code — the IDE is not modified.`,
		icon: new vscode.ThemeIcon("plug"),
		command: { command: "volt.initProject", title: "Set up this folder", arguments: [p] },
	}
}

// ── Agent & Settings (static launchers) ──────────────────────────────────────
function referenceNodes(): VoltNode[] {
	const item = (key: string, label: string, command: string, icon: string): VoltNode => ({
		key,
		label,
		icon: new vscode.ThemeIcon(icon),
		command: { command, title: label },
	})
	// Deliberately three. "New Agent Session" and "Open Language Reference" were dropped: the first is a variant of
	// Open Agent that the agent terminal already offers, and the second opens a scaffolded skill file most users
	// never touch. Both remain as palette commands — this view is the short list, not an index of everything.
	return [
		item("agent", "Open Agent", "volt.openAgent", "comment-discussion"),
		item("settings", "Open Settings", "volt.openSettings", "settings-gear"),
		item("config", "Open Workspace Config", "volt.openConfig", "gear"),
	]
}
