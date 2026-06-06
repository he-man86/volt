/**
 * Shared types for Volt's VS Code extension. The status JSON shape
 * is the contract between `volt status --json` (CLI surface) and the
 * VS Code consumers: the per-workspace poller (`VoltWorkspace`) and
 * the activity-bar TreeView (`VoltTreeProvider`). Keeping the shape
 * in one place means adding a new field is a one-line update both
 * sides see.
 */

export interface ChangeSet {
	added: string[];
	removed: string[];
	modified: string[];
}

export interface ConflictEntry {
	path: string;
	kind: "text" | "graphical";
	reason: "both-modified" | "delete-modify" | "modify-delete" | "add-add-differ";
}

export interface StatusJson {
	initialized: boolean;
	merging: { projectVersion: string; conflicts: ConflictEntry[] } | null;
	incoming: ChangeSet;
	outgoing: ChangeSet;
	/**
	 * Item name → workspace-relative path (forward slashes). Covers
	 * every name in `incoming`, `outgoing`, and `merging.conflicts`.
	 * Use this for constructing workspace-file URIs; never guess
	 * extensions from item names.
	 */
	pathByName: Record<string, string>;
	snapshotProjectVersion: string | null;
	bridgeProjectVersion: string;
	ideDrifted: boolean;
	workspaceDirty: boolean;
	driftLikelySelfCaused: boolean;
	nextAction: "init" | "pull" | "push" | "reconcile" | "merge-continue" | null;
	summary: string;
}

export function changeCount(c: ChangeSet): number {
	return c.added.length + c.modified.length + c.removed.length;
}

export function totalChanges(s: StatusJson | undefined): number {
	if (s === undefined) return 0;
	const m = s.merging?.conflicts.length ?? 0;
	return m + changeCount(s.incoming) + changeCount(s.outgoing);
}
