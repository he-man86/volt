import * as vscode from "vscode"
import { join } from "node:path"
import { buildUri } from "../providers/content.js"
import { changeCount, type StatusJson } from "@opencode-ai/volt-control"

// One native SourceControl per Volt workspace, rendered beside Git in the Source Control view.
// Volt owns only the IDE axis git can't see: two resource groups diffed against the last-synced
// baseline (refs/remotes/volt/ide) — incoming = baseline ↔ live IDE (what a pull brings),
// outgoing = baseline ↔ working file (what a push sends). Health / merge / mismatch state lives in
// the status bar (the SCM view has no rich status row); the git axis stays the editor's built-in Git.
export class VoltScm implements vscode.Disposable {
	private readonly scm: vscode.SourceControl
	private readonly incoming: vscode.SourceControlResourceGroup
	private readonly outgoing: vscode.SourceControlResourceGroup

	constructor(readonly workspaceRoot: string) {
		this.scm = vscode.scm.createSourceControl("volt", "Volt — IDE Sync", vscode.Uri.file(workspaceRoot))
		this.scm.inputBox.visible = false // no commit message — Volt syncs to the IDE, not into git
		this.incoming = this.scm.createResourceGroup("incoming", "Incoming (IDE → pull)")
		this.outgoing = this.scm.createResourceGroup("outgoing", "Outgoing (push → IDE)")
		this.incoming.hideWhenEmpty = true
		this.outgoing.hideWhenEmpty = true
	}

	update(status: StatusJson | undefined): void {
		// While merging or on a project mismatch the IDE axis is paused — clear the groups and let
		// the status bar explain (resolve a merge with the editor's Git tools, then Pull again).
		if (status === undefined || status.projectMismatch !== null || status.merging !== null) {
			this.incoming.resourceStates = []
			this.outgoing.resourceStates = []
			this.scm.count = 0
			return
		}
		this.incoming.resourceStates = renderStates(status, this.workspaceRoot, "incoming")
		this.outgoing.resourceStates = renderStates(status, this.workspaceRoot, "outgoing")
		this.scm.count = changeCount(status.incoming) + changeCount(status.outgoing)
	}

	dispose(): void {
		this.scm.dispose()
	}
}

function renderStates(
	status: StatusJson,
	workspaceRoot: string,
	dir: "incoming" | "outgoing",
): vscode.SourceControlResourceState[] {
	const cs = dir === "incoming" ? status.incoming : status.outgoing
	const names = [...cs.added, ...cs.modified, ...cs.removed]

	return names.map((name) => {
		// pathByName gives `src/…`; src is the workspace tree root, so the on-disk path drops it.
		const rawPath = status.pathByName[name] ?? name
		const treePath = rawPath.startsWith("src/") ? rawPath.slice(4) : rawPath
		const onDisk = vscode.Uri.file(join(workspaceRoot, "src", treePath))
		const sub = cs.added.includes(name) ? "A" : cs.removed.includes(name) ? "D" : "M"
		// Both diff against the last-synced baseline (VOLTIDE = refs/remotes/volt/ide):
		//   incoming → baseline ↔ BRIDGE    (the live IDE — what a pull brings in)
		//   outgoing → baseline ↔ WORKSPACE (your live working file — reflects uncommitted edits)
		const rightSide = buildUri(workspaceRoot, dir === "incoming" ? "BRIDGE" : "WORKSPACE", treePath)
		const verb = dir === "incoming" ? "incoming (IDE)" : "outgoing (push)"
		const command: vscode.Command = {
			command: "vscode.diff",
			title: "Diff",
			arguments: [buildUri(workspaceRoot, "VOLTIDE", treePath), rightSide, `${name} — ${verb}`],
		}
		return {
			resourceUri: onDisk,
			command,
			contextValue: `volt:${dir}`,
			decorations: { tooltip: `${verb} ${sub.toLowerCase()}: ${name}`, strikeThrough: sub === "D" },
		}
	})
}
