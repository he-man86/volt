import * as vscode from "vscode"
import { join } from "node:path"
import { startLsp } from "./lsp.js"
import { setBundledCli } from "@opencode-ai/volt-control"
import { registerCommands } from "./commands.js"
import { VoltStatus, hasVoltConfig, workspaceFolders } from "./state/status.js"
import { VoltScm } from "./views/scm.js"
import { VoltDecorations } from "./providers/decorations.js"
import { VoltContentProvider, SCHEME } from "./providers/content.js"
import { changeCount, probeVendors, isBridgeOnline } from "@opencode-ai/volt-control"

const statuses = new Map<string, VoltStatus>()
const scms = new Map<string, VoltScm>()

export async function activate(context: vscode.ExtensionContext) {
	// Use the CLI shipped inside the extension — no per-workspace Node install needed.
	setBundledCli(join(context.extensionPath, "dist", "cli.js"))

	const decorations = new VoltDecorations()

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
	statusBar.command = "volt.status"

	// Probe both bridge ports (parallel) so the Source Control welcome's init buttons enable only for a
	// vendor whose IDE is actually connected — `volt.twincatLive` / `volt.codesysLive` drive their
	// command `enablement` (visible-but-disabled until the bridge is up). Skipped once a folder is bound.
	const refreshBridgeLive = async (): Promise<void> => {
		const cfg = vscode.workspace.getConfiguration("volt.bridge")
		const unbound = statuses.size === 0 && workspaceFolders().length > 0
		const live = unbound ? await probeVendors(cfg.get<number>("twincatPort", 8555), cfg.get<number>("codesysPort", 8556)) : []
		const isLive = (v: "twincat" | "codesys"): boolean => live.some((p) => p.vendor === v && isBridgeOnline(p.state))
		void vscode.commands.executeCommand("setContext", "volt.twincatLive", isLive("twincat"))
		void vscode.commands.executeCommand("setContext", "volt.codesysLive", isLive("codesys"))
	}
	const bridgeTimer = setInterval(() => void refreshBridgeLive(), 10_000)

	// Bring a (possibly just-initialized) folder online without a reload.
	const ensureWorkspace = (folderPath: string): void => {
		if (statuses.has(folderPath)) { void statuses.get(folderPath)?.refresh(true); return }
		const folder = workspaceFolders().find((f) => f.uri.fsPath === folderPath)
		if (folder !== undefined && hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar)
		updateGlobalUi(statusBar)
		void refreshBridgeLive()
	}

	context.subscriptions.push(
		statusBar,
		{ dispose: () => clearInterval(bridgeTimer) },
		vscode.window.registerFileDecorationProvider(decorations),
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, new VoltContentProvider()),
		...registerCommands(statuses, ensureWorkspace),
	)

	for (const folder of workspaceFolders()) {
		if (hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar)
	}
	// Gate the UI immediately (before the first status lands) so the menu when-clauses resolve.
	updateGlobalUi(statusBar)
	void refreshBridgeLive()

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for (const folder of e.added) { if (hasVoltConfig(folder)) addWorkspace(folder, decorations, statusBar) }
			for (const folder of e.removed) {
				statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath)
				scms.get(folder.uri.fsPath)?.dispose(); scms.delete(folder.uri.fsPath)
			}
			updateGlobalUi(statusBar)
			void refreshBridgeLive()
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			for (const [, s] of statuses) {
				if (doc.uri.fsPath.startsWith(s.workspaceRoot) && s.isTrackedFile(doc.fileName)) s.refresh()
			}
		}),
		// Re-probe when the window regains focus, so reconnecting an IDE updates the onboarding promptly.
		vscode.window.onDidChangeWindowState((ws) => { if (ws.focused) void refreshBridgeLive() }),
	)

	const clients = await startLsp(context)
	context.subscriptions.push(...clients)
}

function addWorkspace(folder: vscode.WorkspaceFolder, decorations: VoltDecorations, statusBar: vscode.StatusBarItem): void {
	const s = new VoltStatus(folder.uri.fsPath)
	const scm = new VoltScm(folder.uri.fsPath)
	scms.set(folder.uri.fsPath, scm)

	s.onDidChange.event(() => {
		scm.update(s.cached)
		if (s.cached !== undefined) decorations.refresh(s.cached, s.workspaceRoot)
		updateGlobalUi(statusBar)
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
}

/** Drive the `volt.workspaceInitialized` context key (gates the SCM-title actions) AND the ambient
 *  status-bar indicator off the aggregate status. Health / merge / mismatch / drift all surface here,
 *  since the native SCM view has no rich status row. */
function updateGlobalUi(statusBar: vscode.StatusBarItem): void {
	let initialized = statuses.size > 0
	let merging = false
	let mismatch = false
	let incoming = 0
	let outgoing = 0
	// Aggregate bridge connection across workspaces (worst wins).
	let conn: "ok" | "offline" | "noproject" | "degraded" = "ok"
	for (const s of statuses.values()) {
		const c = s.cached
		if (c !== undefined) {
			initialized = true
			if (c.merging !== null) merging = true
			if (c.projectMismatch !== null) mismatch = true
			incoming += changeCount(c.incoming)
			outgoing += changeCount(c.outgoing)
		}
		switch (s.health.kind) {
			case "unreachable": conn = "offline"; break
			case "disconnected": if (conn === "ok") conn = "noproject"; break
			case "degraded": if (conn === "ok") conn = "degraded"; break
		}
	}

	void vscode.commands.executeCommand("setContext", "volt.workspaceInitialized", initialized)

	if (!initialized) { statusBar.hide(); return }

	// Reset the actionable bits each pass.
	statusBar.command = "volt.status"
	statusBar.backgroundColor = undefined

	if (merging) {
		statusBar.text = "$(git-merge) Volt: merge"
		statusBar.tooltip = "Merge in progress — resolve conflicts with your editor's Git tools, then Pull again"
	} else if (mismatch) {
		statusBar.text = "$(warning) Volt: project mismatch"
		statusBar.tooltip = "The IDE's project differs from the binding (likely a rename) — click to accept it and re-bind"
		statusBar.command = "volt.acceptProjectRename"
		statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
	} else if (conn === "offline") {
		statusBar.text = "$(plug) Volt: bridge offline"
		statusBar.tooltip = "No bridge on the configured port — click to start it via the connector"
		statusBar.command = "volt.startBridge"
		statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
	} else if (conn === "noproject") {
		statusBar.text = "$(circle-slash) Volt: no project"
		statusBar.tooltip = "The IDE is running but no project is loaded"
	} else if (conn === "degraded") {
		statusBar.text = "$(warning) Volt: degraded"
		statusBar.tooltip = "The IDE channel had recent errors — read-only-safe; heavy writes may retry"
	} else if (incoming > 0 || outgoing > 0) {
		statusBar.text = `$(sync) Volt ${outgoing}↑ ${incoming}↓`
		statusBar.tooltip = `${outgoing} outgoing, ${incoming} incoming — see the Volt group in Source Control`
	} else {
		statusBar.text = "$(check) Volt"
		statusBar.tooltip = "Connected and in sync with the IDE"
	}
	statusBar.show()
}

export function deactivate(): Thenable<void>[] {
	const result: Thenable<void>[] = []
	for (const [, s] of statuses) s.dispose()
	for (const [, scm] of scms) scm.dispose()
	return result
}
