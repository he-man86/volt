/** Result + status shapes. status/log match the consumer contracts in @volt/control
 *  (StatusJson, LogEntry) so the desktop panel + vscode parse volt-git output unchanged. */

export interface ChangeSet {
	added: string[];
	removed: string[];
	modified: string[];
}

export type PullResult =
	| { kind: "ok"; synced: string[]; message?: string; status?: StatusJson }
	| { kind: "refused"; reason: string }
	// conflict carries the post-merge (merging) status — pull already fetched everything needed to build it, so
	// the UI adopts it directly instead of a follow-up `volt status` (/refs) round-trip.
	| { kind: "conflict"; paths: string[]; status?: StatusJson };

export type PushResult = { kind: "ok"; items: string[]; message?: string; status?: StatusJson } | { kind: "rejected"; reason: string };

export interface ProjectMismatch {
	configuredAs: { platform: string; projectName: string };
	bridgeReports: { platform: string; projectName: string };
	diffFields: Array<"platform" | "projectName">;
}

/** The contract volt-control's StatusJson declares — emitted by `status --json`. */
export interface StatusJson {
	initialized: boolean;
	merging: { projectVersion: string; conflicts: Array<{ path: string; kind: string; reason: string }> } | null;
	incoming: ChangeSet;
	outgoing: ChangeSet;
	pathByName: Record<string, string>;
	projectMismatch: ProjectMismatch | null;
	summary: string;
}

/** Internal: StatusJson + the extras the text renderer uses. */
export interface StatusData extends StatusJson {
	online: boolean;
	detail: string;
	recommend: string | null;
}

/** The contract volt-control's LogEntry declares — emitted by `log --json` (a JSON array). */
export interface LogEntry {
	sha: string;
	date: string;
	summary: string;
	paths: string[];
}
