import * as vscode from "vscode"
import { existsSync } from "node:fs"
import { join } from "node:path"

// VoltStatus (the reactive per-workspace IDE-changes tracker) now lives in @volt/control so the
// desktop shell shares the exact same logic — the extension is just one renderer of it. Re-exported here so the
// rest of the extension keeps importing it from "./state/status.js". Only the genuinely vscode-specific helpers
// stay in the extension.
export { VoltStatus } from "@volt/control"

export function workspaceFolders(): readonly vscode.WorkspaceFolder[] {
	return vscode.workspace.workspaceFolders ?? []
}

export function hasVoltConfig(folder: vscode.WorkspaceFolder): boolean {
	return existsSync(join(folder.uri.fsPath, ".git", "volt", "config.json"))
}
