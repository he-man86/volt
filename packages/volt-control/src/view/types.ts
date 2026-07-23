export interface ChangeSet { added: string[]; removed: string[]; modified: string[] }

export interface ProjectMismatch {
	configuredAs: { platform: string; projectName: string }
	bridgeReports: { platform: string; projectName: string }
	diffFields: ReadonlyArray<"platform" | "projectName">
}

export interface StatusJson {
	initialized: boolean
	merging: { projectVersion: string; conflicts: { path: string; kind: string; reason: string }[] } | null
	incoming: ChangeSet
	outgoing: ChangeSet
	pathByName: Record<string, string>
	projectMismatch: ProjectMismatch | null
	summary: string
	/** The status skipped the IDE walk (`volt status --local`), so `incoming` was NOT computed. Empty then means
	 *  "we didn't ask", not "the IDE has nothing" — a consumer must carry the previous incoming forward rather
	 *  than replacing it, or every local save would report the IDE as having nothing for you. */
	incomingStale?: boolean
}

export function changeCount(c: ChangeSet): number {
	return c.added.length + c.modified.length + c.removed.length
}
