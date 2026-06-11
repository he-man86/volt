import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { startLsp } from "./lsp.js"
import { registerCommands } from "./commands.js"
import { VoltStatus, hasVoltConfig, workspaceFolders } from "./state/status.js"
import { VoltScmTree } from "./views/scm.js"
import { VoltHistoryTree } from "./views/history.js"
import { VoltDecorations } from "./providers/decorations.js"
import { VoltContentProvider, SCHEME } from "./providers/content.js"
import { openMergeEditor, extractPath, extractUri } from "./merge.js"

const statuses = new Map<string, VoltStatus>()

export async function activate(context: vscode.ExtensionContext) {
	const scmTree = new VoltScmTree()
	const decorations = new VoltDecorations()

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider("volt.scm", scmTree),
		vscode.window.registerTreeDataProvider("volt.history", new VoltHistoryTree("")),
		vscode.window.registerFileDecorationProvider(decorations),
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, new VoltContentProvider()),
		...registerCommands(statuses),
	)

	for (const folder of workspaceFolders()) {
		if (hasVoltConfig(folder)) addWorkspace(folder, scmTree, decorations)
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders((e) => {
			for (const folder of e.added) { if (hasVoltConfig(folder)) addWorkspace(folder, scmTree, decorations) }
			for (const folder of e.removed) { statuses.get(folder.uri.fsPath)?.dispose(); statuses.delete(folder.uri.fsPath) }
		}),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			for (const [, s] of statuses) {
				if (doc.uri.fsPath.startsWith(s.workspaceRoot) && s.isTrackedFile(doc.fileName)) s.refresh()
			}
		}),
		vscode.commands.registerCommand("volt.openMergeEditor", (arg: unknown) => {
			const uri = extractUri(arg)
		const ws = uri !== undefined ? (vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? "") : ""
			const path = extractPath(arg, ws) ?? ""
			if (path.length === 0) return
			openMergeEditor(ws, path)
		}),
	)

	const clients = await startLsp(context)
	context.subscriptions.push(...clients)
}

function addWorkspace(folder: vscode.WorkspaceFolder, scmTree: VoltScmTree, decorations: VoltDecorations): void {
	const s = new VoltStatus(folder.uri.fsPath)
	const historyTree = new VoltHistoryTree(folder.uri.fsPath)
	vscode.window.registerTreeDataProvider("volt.history", historyTree)

	s.onDidChange.event(() => {
		scmTree.setSources([...statuses.values()].map((st) => ({
			status: st.cached, health: st.health, error: st.statusError, refCount: 0,
		})))
		if (s.cached !== undefined) decorations.refresh(s.cached, s.workspaceRoot)
	})
	statuses.set(folder.uri.fsPath, s)
	void s.start()
}

export function deactivate(): Thenable<void>[] {
	const result: Thenable<void>[] = []
	for (const [, s] of statuses) s.dispose()
	return result
}
