export interface ChangeSet { added: string[]; removed: string[]; modified: string[] }

export interface StatusJson {
	initialized: boolean
	merging: { projectVersion: string; conflicts: { path: string; kind: string; reason: string }[] } | null
	incoming: ChangeSet
	outgoing: ChangeSet
	pathByName: Record<string, string>
	summary: string
	/** The status skipped the IDE walk (`volt status --local`), so `incoming` was NOT computed. Empty then means
	 *  "we didn't ask", not "the IDE has nothing" — a consumer must carry the previous incoming forward rather
	 *  than replacing it, or every local save would report the IDE as having nothing for you. */
	incomingStale?: boolean
	/** Items the IDE holds that the bridge did not pull, by bare name, each with the reason it gave. They have no entry in any
	 *  change set, so nothing else here mentions them — an unreadable POU is indistinguishable from one that was
	 *  never in the project unless this is rendered. One an earlier pull read is HELD: its last-read file stays in
	 *  the workspace (an item caught mid-edit), stale, and no unforced push of it is accepted. */
	unreadable?: { name: string; reason: string }[]
	/** Folders the bridge could not ENUMERATE. Non-empty means the item view is PARTIAL: `incoming` reports no
	 *  removals, because absence proves nothing about a subtree nobody could read. The counts cannot be trusted
	 *  while this is set. */
	unwalkedFolders?: string[]
}

export function changeCount(c: ChangeSet): number {
	return c.added.length + c.modified.length + c.removed.length
}
