/**
 * Wire shape of `volt status --json` output. Single source of truth.
 */
export interface ChangeSet { added: string[]; removed: string[]; modified: string[] }

export interface ConflictEntry {
	path: string
	kind: "text" | "graphical"
	reason: "both-modified" | "delete-modify" | "modify-delete" | "add-add-differ"
}

export interface ProjectMismatch {
	configuredAs: { platform: string; projectName: string; plcProjectName: string }
	bridgeReports: { platform: string; projectName: string; plcProjectName: string }
	diffFields: ReadonlyArray<"platform" | "projectName" | "plcProjectName">
}

export interface StatusJson {
	initialized: boolean
	merging: { projectVersion: string; conflicts: ConflictEntry[] } | null
	incoming: ChangeSet
	outgoing: ChangeSet
	pathByName: Record<string, string>
	snapshotProjectVersion: string | null
	bridgeProjectVersion: string
	ideDrifted: boolean
	workspaceDirty: boolean
	driftLikelySelfCaused: boolean
	nextAction: "init" | "pull" | "push" | "reconcile" | "merge-continue" | null
	summary: string
	projectMismatch: ProjectMismatch | null
}

export function changeCount(c: ChangeSet): number {
	return c.added.length + c.modified.length + c.removed.length
}

export function totalChanges(s: StatusJson | undefined): number {
	if (s === undefined) return 0
	return (s.merging?.conflicts.length ?? 0) + changeCount(s.incoming) + changeCount(s.outgoing)
}
