import * as vscode from "vscode"
import { join } from "node:path"
import type { StatusJson, ChangeSet } from "@volt/control"

interface Badges {
	incoming: Record<string, string>
	outgoing: Record<string, string>
	conflicts: Record<string, string>
}

export class VoltDecorations implements vscode.FileDecorationProvider {
	private readonly emitter = new vscode.EventEmitter<vscode.Uri | undefined>()
	readonly onDidChangeFileDecorations = this.emitter.event

	// Per-workspace so multiple bound folders don't clobber each other — refresh() used to REPLACE one flat map
	// from a single status, so with two bound workspaces the last to fire won and the other's badges vanished.
	// Keyed by ABSOLUTE fsPath (not workspace-relative): asRelativePath prefixes the folder name in a multi-root
	// window, so relative keys never matched there either — absolute paths match uri.fsPath directly, single or multi.
	private readonly byWorkspace = new Map<string, Badges>()

	refresh(workspaceRoot: string, status: StatusJson): void {
		this.byWorkspace.set(workspaceRoot, {
			incoming: absMap(workspaceRoot, status.incoming, status.pathByName),
			outgoing: absMap(workspaceRoot, status.outgoing, status.pathByName),
			// Conflict paths are snapshot-tree-relative (no `src/`); the tree stores them under `src/` on disk.
			conflicts: Object.fromEntries((status.merging?.conflicts ?? []).map((c) => [join(workspaceRoot, "src", c.path), c.path])),
		})
		this.emitter.fire(undefined)
	}

	/** Drop a workspace's badges when its folder is removed (or it unbinds), so they don't linger. */
	remove(workspaceRoot: string): void {
		if (this.byWorkspace.delete(workspaceRoot)) this.emitter.fire(undefined)
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		const p = uri.fsPath
		for (const { incoming, outgoing, conflicts } of this.byWorkspace.values()) {
			if (conflicts[p] !== undefined) {
				return { badge: "C", color: new vscode.ThemeColor("volt.driftConflictForeground"), tooltip: "merge conflict — resolves locally via merge editor" }
			}
			const i = incoming[p]
			const o = outgoing[p]
			if (i !== undefined || o !== undefined) {
				const letter = i !== undefined ? "i" : "o"
				const colorId = i !== undefined ? "volt.driftIncomingForeground" : "volt.driftOutgoingForeground"
				const dir = i !== undefined ? "incoming" : "outgoing"
				return { badge: letter, color: new vscode.ThemeColor(colorId), tooltip: `${dir} — ${i ?? o}. diff via \`volt show\` or the IDE Sync view` }
			}
		}
		return undefined
	}
}

/** name → ABSOLUTE fsPath map for one workspace's changeset (pathByName is `src/…`, workspace-relative). */
function absMap(workspaceRoot: string, c: ChangeSet, pathByName: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const name of [...c.added, ...c.modified, ...c.removed]) {
		const rel = pathByName[name]
		if (rel !== undefined) out[join(workspaceRoot, rel)] = name
	}
	return out
}
