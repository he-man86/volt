import * as vscode from "vscode"
import { buildUri } from "./providers/content.js"

export function openMergeEditor(workspaceRoot: string, path: string): void {
	const ours = buildUri(workspaceRoot, "WORKSPACE", path)
	const theirs = buildUri(workspaceRoot, "MERGE_HEAD", path)
	const base = buildUri(workspaceRoot, "ORIG_HEAD", path)
	const output = vscode.Uri.file(path)

	void vscode.commands.executeCommand("_open.mergeEditor", {
		base, input1: { uri: ours, title: "Ours" }, input2: { uri: theirs, title: "Theirs" },
		result: { uri: output, title: "Resolved" },
	})
}

export function extractUri(arg: unknown): vscode.Uri | undefined {
	if (arg instanceof vscode.Uri) return arg
	if (typeof arg === "object" && arg !== null) {
		const uri = (arg as { uri?: unknown }).uri
		if (uri instanceof vscode.Uri) return uri
		const resourceUri = (arg as { resourceUri?: unknown }).resourceUri
		if (resourceUri instanceof vscode.Uri) return resourceUri
	}
	return undefined
}

export function extractPath(arg: unknown, workspaceRoot: string): string | undefined {
	const uri = extractUri(arg)
	if (uri === undefined) return undefined
	return vscode.workspace.asRelativePath(uri, false)
}
