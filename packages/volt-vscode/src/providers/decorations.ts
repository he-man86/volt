import * as vscode from "vscode"
import type { StatusJson, ChangeSet } from "../types.js"

export class VoltDecorations implements vscode.FileDecorationProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri | undefined>()
	readonly onDidChangeFileDecorations = this.emitter.event

	private incoming: Record<string, string> = {}
	private outgoing: Record<string, string> = {}
	private conflicts: Record<string, string> = {}
	private workspaceRoot = ""

	refresh(status: StatusJson, workspaceRoot: string): void {
		this.workspaceRoot = workspaceRoot
		this.incoming = fileMap(status.incoming, status.pathByName)
		this.outgoing = fileMap(status.outgoing, status.pathByName)
		const mergePaths = status.merging?.conflicts ?? []
		this.conflicts = Object.fromEntries(mergePaths.map((c) => [c.path, c.path]))
		this.emitter.fire(undefined)
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		const rel = vscode.workspace.asRelativePath(uri, false)
		if (this.conflicts[rel] !== undefined) {
			return { badge: "C", color: new vscode.ThemeColor("volt.driftConflictForeground"), tooltip: "merge conflict — resolves locally via merge editor" }
		}
		const i = this.incoming[rel]
		const o = this.outgoing[rel]
		if (i !== undefined || o !== undefined) {
			const letter = i !== undefined ? "i" : "o"
			const colorId = i !== undefined ? "volt.driftIncomingForeground" : "volt.driftOutgoingForeground"
			const dir = i !== undefined ? "incoming" : "outgoing"
			return { badge: letter, color: new vscode.ThemeColor(colorId), tooltip: `${dir} — ${i ?? o}. diff via \`volt show\` or the SCM view` }
		}
		return undefined
	}
}

function fileMap(c: ChangeSet, pathByName: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const name of [...c.added, ...c.modified, ...c.removed]) {
		const path = pathByName[name]
		if (path !== undefined) out[path] = name
	}
	return out
}
