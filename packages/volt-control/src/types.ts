export interface ChangeSet { added: string[]; removed: string[]; modified: string[] }

export interface ProjectMismatch {
	configuredAs: { platform: string; projectName: string; plcProjectName: string }
	bridgeReports: { platform: string; projectName: string; plcProjectName: string }
	diffFields: ReadonlyArray<"platform" | "projectName" | "plcProjectName">
}

export interface StatusJson {
	initialized: boolean
	merging: { projectVersion: string; conflicts: { path: string; kind: string; reason: string }[] } | null
	incoming: ChangeSet
	outgoing: ChangeSet
	pathByName: Record<string, string>
	projectMismatch: ProjectMismatch | null
	summary: string
}

export function changeCount(c: ChangeSet): number {
	return c.added.length + c.modified.length + c.removed.length
}
