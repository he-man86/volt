import * as vscode from "vscode"
import { startLsp } from "./lsp.js"
import { registerCommands } from "./commands.js"
import { VoltStatus, hasVoltConfig, workspaceFolders } from "./state/status.js"
import { VoltScmTree } from "./views/scm.js"
import { VoltHistoryTree } from "./views/history.js"
import { VoltDecorations } from "./providers/decorations.js"
import { VoltContentProvider, SCHEME } from "./providers/content.js"
import { changeCount } from "./types.js"

const statuses = new Map<string, VoltStatus>()

export async function activate(context: vscode.ExtensionContext) {
	const scmTree = new VoltScmTree()
	const decorations = new VoltDecorations()

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
	statusBar.command = "volt.status"

	context.subscriptions.push(
		statusBar,
		vscode.window.registerTreeDataProvider("volt.scm", scmTree),
		vscode.window.registerTreeDataProvider("volt.history", new VoltHistoryTree("")),
		vscode.window.registerFileDecorationProvider(decorations),
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, new VoltContentProvider()),
		...registerCommands(statuses),
	)

	for (const folder of workspaceFolders()) {
		if (hasVoltConfig(folder)) addWorkspace(folder, scmTree, decorations, statusBar)
	}
	// Gate the UI immediately (before the first status lands) so the welcome
	// view vs. the SCM toolbar resolve correctly.
	updateGlobalUi(statusBar)

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for (const folder of e.added) { if (hasVoltConfig(folder)) addWorkspace(folder, scmTree, decorations, statusBar) }
			for (const folder of e.removed) { statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath) }
			updateGlobalUi(statusBar)
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			for (const [, s] of statuses) {
				if (doc.uri.fsPath.startsWith(s.workspaceRoot) && s.isTrackedFile(doc.fileName)) s.refresh()
			}
		}),
	)

	const clients = await startLsp(context)
	context.subscriptions.push(...clients)
}

function addWorkspace(
	folder: vscode.WorkspaceFolder,
	scmTree: VoltScmTree,
	decorations: VoltDecorations,
	statusBar: vscode.StatusBarItem,
): void {
	const s = new VoltStatus(folder.uri.fsPath)
	const historyTree = new VoltHistoryTree(folder.uri.fsPath)
	vscode.window.registerTreeDataProvider("volt.history", historyTree)

	s.onDidChange.event(() => {
		scmTree.setSources([...statuses.values()].map((st) => ({
			status: st.cached, health: st.health, error: st.statusError, refCount: 0,
		})))
		if (s.cached !== undefined) decorations.refresh(s.cached, s.workspaceRoot)
		updateGlobalUi(statusBar)
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
}

/** Drive the two when-clause context keys AND the ambient status-bar indicator
 *  off the aggregate status. Without these setContext calls the pull/push
 *  toolbar buttons, the welcome view, and the merge continue/abort actions never
 *  appear (their `when` clauses are permanently false). */
function updateGlobalUi(statusBar: vscode.StatusBarItem): void {
	let initialized = statuses.size > 0
	let merging = false
	let incoming = 0
	let outgoing = 0
	for (const s of statuses.values()) {
		const c = s.cached
		if (c !== undefined) {
			initialized = true
			if (c.merging !== null) merging = true
			incoming += changeCount(c.incoming)
			outgoing += changeCount(c.outgoing)
		}
	}

	void vscode.commands.executeCommand("setContext", "volt.workspaceInitialized", initialized)
	void vscode.commands.executeCommand("setContext", "volt.merging", merging)

	if (!initialized) { statusBar.hide(); return }
	if (merging) {
		statusBar.text = "$(git-merge) Volt: merge"
		statusBar.tooltip = "Merge in progress — resolve conflicts, then run Volt: Continue Merge"
	} else if (incoming > 0 || outgoing > 0) {
		statusBar.text = `$(sync) Volt ${outgoing}↑ ${incoming}↓`
		statusBar.tooltip = `${outgoing} outgoing, ${incoming} incoming — open the Volt view`
	} else {
		statusBar.text = "$(check) Volt"
		statusBar.tooltip = "In sync with the IDE"
	}
	statusBar.show()
}

export function deactivate(): Thenable<void>[] {
	const result: Thenable<void>[] = []
	for (const [, s] of statuses) s.dispose()
	return result
}
