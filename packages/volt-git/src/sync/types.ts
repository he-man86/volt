/** Result shapes returned by the sync commands (rendered by bin.ts). */

export interface ChangeSet {
	added: string[];
	modified: string[];
	removed: string[];
}

export type PullResult =
	| { kind: "ok"; synced: string[]; message?: string }
	| { kind: "refused"; reason: string }
	| { kind: "conflict"; paths: string[] };

export type PushResult = { kind: "ok"; items: string[]; message?: string } | { kind: "rejected"; reason: string };

export interface StatusResult {
	bridge: { online: boolean; detail: string };
	incoming: ChangeSet;
	outgoing: ChangeSet;
	merging: { paths: string[] } | null;
	recommend: string | null;
}
