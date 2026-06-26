import * as vscode from "vscode"
import { spawnVoltBuffer } from "@opencode-ai/volt-control"

export const SCHEME = "volt"
export type ShowRef = "HEAD" | "MERGE_HEAD" | "ORIG_HEAD" | "WORKSPACE" | "BRIDGE" | string

export function buildUri(workspaceRoot: string, ref: ShowRef, path: string): vscode.Uri {
	return vscode.Uri.from({ scheme: SCHEME, authority: workspaceRoot, path: `/${ref}/${path}` })
}

export function parseUri(uri: vscode.Uri): { workspaceRoot: string; ref: ShowRef; path: string } | undefined {
	if (uri.scheme !== SCHEME) return undefined
	const parts = uri.path.slice(1).split("/")
	if (parts.length < 2) return undefined
	return { workspaceRoot: uri.authority, ref: parts[0]!, path: parts.slice(1).join("/") }
}

export class VoltContentProvider implements vscode.TextDocumentContentProvider {
	readonly onDidChange = new vscode.EventEmitter<vscode.Uri>().event

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const parsed = parseUri(uri)
		if (parsed === undefined) return "invalid volt:// URI"

		const r = await spawnVoltBuffer(parsed.workspaceRoot, [
			"show", parsed.ref, parsed.path,
			"--workspace", parsed.workspaceRoot,
		])

		if (r.code === 2) return ""
		if (r.code !== 0) return `volt show failed: ${r.stderr || r.code}`
		return r.stdout.toString("utf-8")
	}
}
