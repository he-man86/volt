import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { bindingFile } from "@volt/control"

// The genuinely VS Code-specific workspace helpers. `VoltStatus` (the reactive tracker) lives in
// @volt/control and is imported from there directly — the extension is just one renderer of it.

export function workspaceFolders(): readonly vscode.WorkspaceFolder[] {
	return vscode.workspace.workspaceFolders ?? []
}

export function hasVoltConfig(folder: vscode.WorkspaceFolder): boolean {
	const file = bindingFile(folder.uri.fsPath)
	return file !== undefined && existsSync(file)
}
