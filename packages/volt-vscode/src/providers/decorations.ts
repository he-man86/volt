import * as vscode from "vscode"
import type { StatusJson, ChangeSet } from "../types.js"
import { readExtensionAccess } from "../state/health.js"

export class VoltDecorations implements vscode.FileDecorationProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri | undefined>()
	readonly onDidChangeFileDecorations = this.emitter.event

	private incoming: Record<string, string> = {}
	private outgoing: Record<string, string> = {}
	private conflicts: Record<string, string> = {}
	private readOnlyExts = new Set<string>()
	private workspaceRoot = ""

	refresh(status: StatusJson, workspaceRoot: string): void {
		this.workspaceRoot = workspaceRoot
		this.incoming = fileMap(status.incoming, status.pathByName)
		this.outgoing = fileMap(status.outgoing, status.pathByName)
		// Conflict paths are snapshot-tree-relative (no `src/`), but provideFileDecoration
		// compares against asRelativePath(uri) which IS `src/`-prefixed — key them the
		// same way (incoming/outgoing already match via the src/-prefixed pathByName).
		const mergePaths = status.merging?.conflicts ?? []
		this.conflicts = Object.fromEntries(mergePaths.map((c) => [`src/${c.path}`, c.path]))
		// Read-only extensions: graphical (FBD/LD/SFC/CFC) + config kinds the AI
		// reads but can't push (push refuses body changes on them).
		const access = readExtensionAccess(workspaceRoot)
		this.readOnlyExts = new Set(Object.entries(access).filter(([, a]) => a === "r").map(([ext]) => ext.toLowerCase()))
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
		// Read-only graphical/config file (only within the tracked src/ tree).
		if (rel.startsWith("src/")) {
			const dot = rel.lastIndexOf(".")
			const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : ""
			if (ext !== "" && this.readOnlyExts.has(ext)) {
				return {
					badge: "RO",
					color: new vscode.ThemeColor("disabledForeground"),
					tooltip: "Read-only in Volt — the AI reads this file; edits won't push to the IDE (author logic in Structured Text instead).",
				}
			}
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
